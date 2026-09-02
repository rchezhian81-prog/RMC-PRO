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
      // An inverted range (min > max) makes every value fail — reject it so a
      // typo doesn't silently mislabel good concrete as out-of-slump.
      if (min !== null && max !== null && min > max) throw badReq('Target min slump cannot exceed target max slump.');
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
      // Once a set has a final verdict, appending more results and re-assessing
      // could flip a rejected set toward acceptance — the verdict is a record.
      if (set.acceptanceStatus === 'accepted' || set.acceptanceStatus === 'rejected') {
        throw badReq(`This cube set is already ${set.acceptanceStatus} — its result is final`);
      }
      const rows = Array.isArray(dto.results) ? (dto.results as Record<string, unknown>[]) : [];
      if (!rows.length) throw badReq('No cube results supplied');

      const fck = num(set.targetStrengthMpa);
      const tolerance = fck >= 20 ? 3 : 4;
      const individualFloor = fck - tolerance;
      const resRepo = m.getRepository(QcCubeResult);

      // Protect the IS 456 verdict from being computed on the wrong sample. The
      // acceptance mean is taken over the cast specimens (default 3), so:
      //  - the number of 28-day results may not exceed the set's specimen count
      //    (more crushed cubes than were cast would judge the batch on cubes
      //    that never existed, and let the sample be padded toward acceptance);
      //  - a numbered specimen may not be recorded twice at the same age (one
      //    cube double-keyed would be counted twice in the mean).
      const existing = await resRepo.find({ where: { cubeSetId: setId } });
      const specimenCap = num(set.specimenCount);
      const at28Age = (v: unknown) => (num(v) || 28) >= 28;
      if (specimenCap > 0) {
        const existing28 = existing.filter((x) => num(x.testAgeDays) >= 28).length;
        const incoming28 = rows.filter((r) => at28Age(r.testAgeDays)).length;
        if (existing28 + incoming28 > specimenCap) {
          throw badReq(
            `This set was cast with ${specimenCap} specimen(s) — cannot record ${existing28 + incoming28} result(s) at 28-day.`,
          );
        }
      }
      const seen = new Set(existing.map((x) => `${num(x.specimenNo)}@${num(x.testAgeDays) || 28}`));
      for (const r of rows) {
        const sn = num(r.specimenNo) || 0;
        if (sn <= 0) continue; // an unnumbered specimen can't be de-duplicated
        const key = `${sn}@${num(r.testAgeDays) || 28}`;
        if (seen.has(key)) throw badReq(`Specimen ${sn} at ${num(r.testAgeDays) || 28}-day is already recorded for this set.`);
        seen.add(key);
      }

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

      // Assess ONLY once the full 28-day sample is in. IS 456 acceptance is a
      // verdict on the whole set (default 3 specimens); assessing on a partial
      // sample would both judge on incomplete evidence AND lock the set (the
      // guard above), so the remaining cubes could never be recorded.
      const all = await resRepo.find({ where: { cubeSetId: setId } });
      const at28 = all.filter((x) => num(x.testAgeDays) >= 28).map((x) => num(x.compressiveStrengthMpa));
      const specimens = num(set.specimenCount) > 0 ? num(set.specimenCount) : at28.length;
      if (at28.length > 0 && at28.length >= specimens) {
        const verdict = assessCubeSet(at28, fck);
        await setRepo.update(setId, {
          meanStrengthMpa: verdict ? String(verdict.mean) : null,
          acceptanceStatus: verdict?.accepted ? 'accepted' : 'rejected',
          status: verdict?.accepted ? 'accepted' : 'rejected',
        });
      } else {
        // Results recorded but the sample is not yet complete — stay open so the
        // remaining specimens can still be entered; no final verdict, no lock.
        await setRepo.update(setId, { status: 'tested' });
      }
      return this.loadSet(m, setId);
    });
  }
}
