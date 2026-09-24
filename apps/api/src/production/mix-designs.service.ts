import { resolveOptionalRef } from '../common/resolve-ref';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { TenantDbService } from '../core/database/tenant-db.service';
import { ConcreteGrade, Material, MixDesign, MixDesignMaterial } from '../core/database/entities';
import { AuditService, AUDIT_ACTIONS } from '../audit/audit.service';
import { nullifyEmpty } from '../common/sanitize';

const notFound = () => new NotFoundException({ code: 'RECORD_NOT_FOUND', message: 'Mix design not found' });
const badReq = (message: string) => new BadRequestException({ code: 'VALIDATION_ERROR', message });

const MAT_FIELDS = ['materialId', 'materialLabel', 'targetQuantity', 'uom', 'tolerancePercentage', 'sequenceNo'] as const;

/** Mix design master + approval (Design Doc 6 §7.7/§7.8). */
@Injectable()
export class MixDesignsService {
  constructor(
    private readonly db: TenantDbService,
    private readonly audit: AuditService,
  ) {}

  /**
   * The design list with what the plant reads it by: the grade code, how
   * many materials the recipe has, how many batches have used it and when
   * the last one was. Two batched lookups for the whole page.
   */
  list(tenantId: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const rows = await m.getRepository(MixDesign).find({ order: { mixCode: 'ASC', versionNo: 'DESC' } });
      const ids = rows.map((r) => r.id);
      const gradeIds = [...new Set(rows.map((r) => r.gradeId).filter((v): v is string => !!v))];
      const grades: Array<{ id: string; gradeCode: string }> = gradeIds.length
        ? await m.query(`SELECT id, grade_code AS "gradeCode" FROM concrete_grades WHERE id = ANY($1)`, [gradeIds])
        : [];
      const stats: Array<{ mixDesignId: string; materialCount: number; batchCount: number; lastBatchedAt: Date | null }> = ids.length
        ? await m.query(
            `SELECT d.id AS "mixDesignId",
                    (SELECT COUNT(*)::int FROM mix_design_materials mm WHERE mm.mix_design_id = d.id) AS "materialCount",
                    (SELECT COUNT(*)::int FROM batch_tickets t WHERE t.mix_design_id = d.id AND t.status <> 'cancelled') AS "batchCount",
                    (SELECT MAX(t.batch_start_time) FROM batch_tickets t WHERE t.mix_design_id = d.id AND t.status <> 'cancelled') AS "lastBatchedAt"
               FROM mix_designs d WHERE d.id = ANY($1)`,
            [ids],
          )
        : [];
      const gradeCode = new Map(grades.map((g) => [g.id, g.gradeCode]));
      const stat = new Map(stats.map((s) => [s.mixDesignId, s]));
      return rows.map((r) => {
        const s = stat.get(r.id);
        return {
          ...r,
          gradeCode: r.gradeId ? gradeCode.get(r.gradeId) ?? null : null,
          materialCount: s?.materialCount ?? 0,
          batchCount: s?.batchCount ?? 0,
          lastBatchedAt: s?.lastBatchedAt ?? null,
        };
      });
    });
  }

  /** One design with its recipe, the grade code, and how often it has been batched. */
  private async loadFull(m: EntityManager, id: string) {
    const design = await m.getRepository(MixDesign).findOne({ where: { id } });
    if (!design) throw notFound();
    const materials = await m
      .getRepository(MixDesignMaterial)
      .find({ where: { mixDesignId: id }, order: { sequenceNo: 'ASC', createdAt: 'ASC' } });
    const [grade, usage] = await Promise.all([
      design.gradeId
        ? (m.query(`SELECT grade_code AS "gradeCode", grade_name AS "gradeName" FROM concrete_grades WHERE id = $1`, [design.gradeId]) as Promise<Array<{ gradeCode: string; gradeName: string }>>)
        : Promise.resolve([] as Array<{ gradeCode: string; gradeName: string }>),
      m.query(
        `SELECT COUNT(*)::int AS "batchCount", MAX(batch_start_time) AS "lastBatchedAt"
           FROM batch_tickets WHERE mix_design_id = $1 AND status <> 'cancelled'`,
        [id],
      ) as Promise<Array<{ batchCount: number; lastBatchedAt: Date | null }>>,
    ]);
    return {
      ...design,
      materials,
      gradeCode: grade[0]?.gradeCode ?? null,
      gradeName: grade[0]?.gradeName ?? null,
      batchCount: usage[0]?.batchCount ?? 0,
      lastBatchedAt: usage[0]?.lastBatchedAt ?? null,
    };
  }

  get(tenantId: string, id: string) {
    return this.db.runInTenant(tenantId, (m) => this.loadFull(m, id));
  }

  private pickMaterial(raw: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const f of MAT_FIELDS) if (raw[f] !== undefined) out[f] = raw[f] === '' ? null : raw[f];
    return out;
  }

  create(tenantId: string, dto: Record<string, unknown>) {
    if (!String(dto.mixCode ?? '').trim()) throw badReq('mixCode required');
    return this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(MixDesign);
      const rest = nullifyEmpty(dto);
      for (const k of ['id', 'tenantId', 'approvalStatus', 'approvedBy', 'approvedAt', 'materials']) delete rest[k];
      // Grade and material ids resolve inside the tenant (FK checks bypass RLS): a
      // foreign materialId made every batch of this recipe decrement a ghost
      // balance while the real stock stayed overstated.
      await resolveOptionalRef(m, ConcreteGrade, rest.gradeId, 'Grade');
      const design = await repo.save(repo.create({ ...rest, tenantId, approvalStatus: 'draft' } as Record<string, unknown>));
      if (Array.isArray(dto.materials)) {
        const matRepo = m.getRepository(MixDesignMaterial);
        for (const raw of dto.materials as Record<string, unknown>[]) {
          await resolveOptionalRef(m, Material, raw.materialId, 'Material');
          await matRepo.save(matRepo.create({ ...this.pickMaterial(raw), tenantId, mixDesignId: design.id }));
        }
      }
      return this.loadFull(m, design.id);
    });
  }

  update(tenantId: string, id: string, dto: Record<string, unknown>) {
    return this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(MixDesign);
      const design = await repo.findOne({ where: { id } });
      if (!design) throw notFound();
      if (design.approvalStatus === 'approved') throw badReq('Approved mix design is locked');
      const rest = nullifyEmpty(dto);
      for (const k of ['id', 'tenantId', 'approvalStatus', 'approvedBy', 'approvedAt', 'materials']) delete rest[k];
      if ('gradeId' in rest) await resolveOptionalRef(m, ConcreteGrade, rest.gradeId, 'Grade');
      await repo.update(id, rest as Record<string, unknown>);
      return this.loadFull(m, id);
    });
  }

  addMaterial(tenantId: string, id: string, dto: Record<string, unknown>) {
    return this.db.runInTenant(tenantId, async (m) => {
      const design = await m.getRepository(MixDesign).findOne({ where: { id } });
      if (!design) throw notFound();
      if (design.approvalStatus === 'approved') throw badReq('Approved mix design is locked');
      await resolveOptionalRef(m, Material, dto.materialId, 'Material');
      const repo = m.getRepository(MixDesignMaterial);
      await repo.save(repo.create({ ...this.pickMaterial(dto), tenantId, mixDesignId: id }));
      return this.loadFull(m, id);
    });
  }

  deleteMaterial(tenantId: string, id: string, materialRowId: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      // Same lock as update/addMaterial: an approved recipe is a record — pulling
      // a material out of it silently changed what every future batch of that
      // grade weighs out, with no new version and no re-approval.
      const design = await m.getRepository(MixDesign).findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!design) throw notFound();
      if (design.approvalStatus === 'approved') throw badReq('Approved mix design is locked');
      const repo = m.getRepository(MixDesignMaterial);
      const row = await repo.findOne({ where: { id: materialRowId, mixDesignId: id } });
      if (!row) throw notFound();
      await repo.delete(materialRowId);
      return this.loadFull(m, id);
    });
  }

  async approve(tenantId: string, id: string, userId: string) {
    const { result, label } = await this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(MixDesign);
      const design = await repo.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!design) throw notFound();
      const rows = await m.getRepository(MixDesignMaterial).find({ where: { mixDesignId: id } });
      if (!rows.length) throw badReq('Add at least one material before approving');
      // Completeness: no zero/blank target quantities — a recipe with a zero
      // target scales to a meaningless mix at batching.
      if (rows.some((r) => !(Number(r.targetQuantity) > 0))) {
        throw badReq('Every mix material needs a target quantity greater than zero before approving.');
      }
      // Supersede: this becomes the single ACTIVE approved version for its grade,
      // so the batch resolver (approved + is_active_version) picks it
      // deterministically instead of choosing arbitrarily among several active
      // versions. Any prior active version for the grade is deactivated first.
      if (design.gradeId) {
        await repo.update({ gradeId: design.gradeId }, { isActiveVersion: false });
      }
      await repo.update(id, { approvalStatus: 'approved', approvedBy: userId, approvedAt: new Date(), isActiveVersion: true });
      return { result: await this.loadFull(m, id), label: `${design.mixCode} v${design.versionNo}` };
    });
    await this.audit.record({
      tenantId,
      actorUserId: userId,
      action: AUDIT_ACTIONS.MIX_DESIGN_APPROVE,
      entityType: 'mix_design',
      entityId: id,
      entityLabel: label,
      summary: `Approved mix design ${label}`,
    });
    return result;
  }

  async reject(tenantId: string, id: string, userId: string) {
    const { result, label } = await this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(MixDesign);
      const design = await repo.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!design) throw notFound();
      // Reject decides a PENDING approval. An approved design is the active
      // recipe for its grade: flipping it to rejected in place left the grade
      // with no approved version mid-production (and re-used the approvedBy/At
      // stamps for the rejection). Supersede it with a new version instead.
      if (design.approvalStatus === 'approved') {
        throw badReq('An approved mix design cannot be rejected — create and approve a new version to supersede it');
      }
      if (design.approvalStatus === 'rejected') throw badReq('Mix design is already rejected');
      await repo.update(id, { approvalStatus: 'rejected', approvedBy: userId, approvedAt: new Date() });
      return { result: await this.loadFull(m, id), label: `${design.mixCode} v${design.versionNo}` };
    });
    await this.audit.record({
      tenantId,
      actorUserId: userId,
      action: AUDIT_ACTIONS.MIX_DESIGN_REJECT,
      entityType: 'mix_design',
      entityId: id,
      entityLabel: label,
      summary: `Rejected mix design ${label}`,
    });
    return result;
  }
}
