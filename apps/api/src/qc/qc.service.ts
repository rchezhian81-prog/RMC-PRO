import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { TenantDbService } from '../core/database/tenant-db.service';
import { ConcreteGrade, QcCubeResult, QcCubeSet, QcSlumpTest } from '../core/database/entities';
import { NumberingService } from '../sales/numbering.service';
import { assessCubeSet } from './acceptance.util';

const notFound = (what = 'Record') => new NotFoundException({ code: 'RECORD_NOT_FOUND', message: `${what} not found` });
const badReq = (message: string) => new BadRequestException({ code: 'VALIDATION_ERROR', message });
const num = (v: unknown): number => Number(v ?? 0) || 0;
const str = (v: unknown): string | null => (v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim());

/** Characteristic strength from a grade code, e.g. "M25" → 25. */
export function fckFromGradeCode(code?: string | null): number {
  if (!code) return 0;
  const match = /(\d+(?:\.\d+)?)/.exec(String(code));
  return match ? Number(match[1]) : 0;
}

/**
 * QC / Lab (Plan A3). Slump tests on fresh concrete and cube-strength sets whose
 * 28-day results are assessed against the grade's characteristic strength
 * (IS 456 acceptance). Every query runs inside the caller's RLS context.
 */
@Injectable()
export class QcService {
  constructor(
    private readonly db: TenantDbService,
    private readonly numbering: NumberingService,
  ) {}

  // ---- slump tests ----

  listSlump(tenantId: string) {
    return this.db.runInTenant(tenantId, (m) =>
      m.getRepository(QcSlumpTest).find({ order: { testedAt: 'DESC' } }),
    );
  }

  /** Cube-set register — sets over a period (cast date) with target vs 28-day
   *  mean strength and acceptance, plus accepted/rejected counts. */
  cubeRegister(tenantId: string, from?: string, to?: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const all = await m.getRepository(QcCubeSet).find({ order: { castDate: 'DESC' } });
      const rows = all.filter((s) => (!from || (s.castDate ?? '') >= from) && (!to || (s.castDate ?? '') <= to));
      const accepted = rows.filter((s) => s.acceptanceStatus === 'accepted').length;
      const rejected = rows.filter((s) => s.acceptanceStatus === 'rejected').length;
      return { rows, count: rows.length, accepted, rejected };
    });
  }

  /** Slump register — tests over a period (test date) with measured vs target
   *  range and pass/fail counts. */
  slumpRegister(tenantId: string, from?: string, to?: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const all = await m.getRepository(QcSlumpTest).find({ order: { testedAt: 'DESC' } });
      const rows = all.filter((s) => {
        const d = String(s.testedAt ?? '').slice(0, 10);
        return (!from || d >= from) && (!to || d <= to);
      });
      const passed = rows.filter((s) => s.passed).length;
      return { rows, count: rows.length, passed, failed: rows.length - passed };
    });
  }

  getSlump(tenantId: string, id: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const row = await m.getRepository(QcSlumpTest).findOne({ where: { id } });
      if (!row) throw notFound('Slump test');
      return row;
    });
  }

  createSlump(tenantId: string, dto: Record<string, unknown>, userId: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const measured = num(dto.measuredSlumpMm);
      if (measured <= 0) throw badReq('Measured slump (mm) is required');
      const min = dto.targetMinMm !== undefined && dto.targetMinMm !== null && dto.targetMinMm !== '' ? num(dto.targetMinMm) : null;
      const max = dto.targetMaxMm !== undefined && dto.targetMaxMm !== null && dto.targetMaxMm !== '' ? num(dto.targetMaxMm) : null;
      const passed = (min === null || measured >= min) && (max === null || measured <= max);
      const repo = m.getRepository(QcSlumpTest);
      const row = await repo.save(
        repo.create({
          tenantId,
          plantId: str(dto.plantId), batchTicketId: str(dto.batchTicketId),
          gradeId: str(dto.gradeId), gradeLabel: str(dto.gradeLabel), sampleRef: str(dto.sampleRef),
          measuredSlumpMm: measured, targetMinMm: min, targetMaxMm: max, passed,
          testedBy: userId, remarks: str(dto.remarks),
        }),
      );
      return row;
    });
  }

  // ---- cube sets ----

  listCubeSets(tenantId: string, status?: string) {
    return this.db.runInTenant(tenantId, (m) =>
      m.getRepository(QcCubeSet).find({ where: status ? { status } : {}, order: { castDate: 'DESC', createdAt: 'DESC' } }),
    );
  }

  private async loadSet(m: EntityManager, id: string) {
    const set = await m.getRepository(QcCubeSet).findOne({ where: { id } });
    if (!set) throw notFound('Cube set');
    const results = await m
      .getRepository(QcCubeResult)
      .find({ where: { cubeSetId: id }, order: { testAgeDays: 'ASC', specimenNo: 'ASC' } });
    return { ...set, results };
  }

  getCubeSet(tenantId: string, id: string) {
    return this.db.runInTenant(tenantId, (m) => this.loadSet(m, id));
  }

  createCubeSet(tenantId: string, dto: Record<string, unknown>) {
    return this.db.runInTenant(tenantId, async (m) => {
      const castDate = str(dto.castDate);
      if (!castDate) throw badReq('Cast date is required');

      let fck = num(dto.targetStrengthMpa);
      let gradeLabel = str(dto.gradeLabel);
      const gradeId = str(dto.gradeId);
      if (!fck && gradeId) {
        const grade = await m.getRepository(ConcreteGrade).findOne({ where: { id: gradeId } });
        fck = fckFromGradeCode(grade?.gradeCode);
        gradeLabel = gradeLabel ?? grade?.gradeName ?? grade?.gradeCode ?? null;
      }
      if (!(fck > 0)) throw badReq('Target strength (fck) is required — set it directly or pick a grade like M25');

      const setNo = await this.numbering.next(m, tenantId, 'qc_cube_set', 'CUBE-');
      const repo = m.getRepository(QcCubeSet);
      const set = await repo.save(
        repo.create({
          tenantId, setNo,
          plantId: str(dto.plantId), batchTicketId: str(dto.batchTicketId), mixDesignId: str(dto.mixDesignId),
          gradeId, gradeLabel,
          castDate, specimenCount: dto.specimenCount ? num(dto.specimenCount) : 3,
          cubeSizeMm: dto.cubeSizeMm ? num(dto.cubeSizeMm) : 150,
          targetStrengthMpa: String(fck), samplingRef: str(dto.samplingRef), status: 'open',
          remarks: str(dto.remarks),
        }),
      );
      return this.loadSet(m, set.id);
    });
  }

  /** Record cube crushing results and re-assess the set against fck (IS 456). */
  recordCubeResults(tenantId: string, setId: string, dto: Record<string, unknown>) {
    return this.db.runInTenant(tenantId, async (m) => {
      const setRepo = m.getRepository(QcCubeSet);
      const set = await setRepo.findOne({ where: { id: setId } });
      if (!set) throw notFound('Cube set');
      const rows = Array.isArray(dto.results) ? (dto.results as Record<string, unknown>[]) : [];
      if (!rows.length) throw badReq('No cube results supplied');

      const fck = num(set.targetStrengthMpa);
      const tolerance = fck >= 20 ? 3 : 4;
      const individualFloor = fck - tolerance;
      const resRepo = m.getRepository(QcCubeResult);
      for (const r of rows) {
        const strength = num(r.compressiveStrengthMpa);
        if (strength <= 0) throw badReq('Each result needs a compressive strength (N/mm²)');
        const age = num(r.testAgeDays) || 28;
        await resRepo.save(
          resRepo.create({
            tenantId, cubeSetId: setId, testAgeDays: age, specimenNo: num(r.specimenNo) || 0,
            testedOn: str(r.testedOn), loadKn: str(r.loadKn), compressiveStrengthMpa: String(strength),
            passed: age >= 28 ? strength >= individualFloor : null, remarks: str(r.remarks),
          }),
        );
      }

      // Re-assess from all 28-day results, if any are in yet.
      const all = await resRepo.find({ where: { cubeSetId: setId } });
      const at28 = all.filter((x) => num(x.testAgeDays) >= 28).map((x) => num(x.compressiveStrengthMpa));
      if (at28.length) {
        const verdict = assessCubeSet(at28, fck);
        await setRepo.update(setId, {
          meanStrengthMpa: verdict ? String(verdict.mean) : null,
          acceptanceStatus: verdict?.accepted ? 'accepted' : 'rejected',
          status: verdict?.accepted ? 'accepted' : 'rejected',
        });
      } else {
        await setRepo.update(setId, { status: 'tested' });
      }
      return this.loadSet(m, setId);
    });
  }
}
