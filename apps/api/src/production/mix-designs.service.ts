import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { TenantDbService } from '../core/database/tenant-db.service';
import { MixDesign, MixDesignMaterial } from '../core/database/entities';
import { nullifyEmpty } from '../common/sanitize';

const notFound = () => new NotFoundException({ code: 'RECORD_NOT_FOUND', message: 'Mix design not found' });
const badReq = (message: string) => new BadRequestException({ code: 'VALIDATION_ERROR', message });

const MAT_FIELDS = ['materialId', 'materialLabel', 'targetQuantity', 'uom', 'tolerancePercentage', 'sequenceNo'] as const;

/** Mix design master + approval (Design Doc 6 §7.7/§7.8). */
@Injectable()
export class MixDesignsService {
  constructor(private readonly db: TenantDbService) {}

  list(tenantId: string) {
    return this.db.runInTenant(tenantId, (m) =>
      m.getRepository(MixDesign).find({ order: { mixCode: 'ASC', versionNo: 'DESC' } }),
    );
  }

  private async loadFull(m: EntityManager, id: string) {
    const design = await m.getRepository(MixDesign).findOne({ where: { id } });
    if (!design) throw notFound();
    const materials = await m
      .getRepository(MixDesignMaterial)
      .find({ where: { mixDesignId: id }, order: { sequenceNo: 'ASC', createdAt: 'ASC' } });
    return { ...design, materials };
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
      const design = await repo.save(repo.create({ ...rest, tenantId, approvalStatus: 'draft' } as Record<string, unknown>));
      if (Array.isArray(dto.materials)) {
        const matRepo = m.getRepository(MixDesignMaterial);
        for (const raw of dto.materials as Record<string, unknown>[]) {
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
      await repo.update(id, rest as Record<string, unknown>);
      return this.loadFull(m, id);
    });
  }

  addMaterial(tenantId: string, id: string, dto: Record<string, unknown>) {
    return this.db.runInTenant(tenantId, async (m) => {
      const design = await m.getRepository(MixDesign).findOne({ where: { id } });
      if (!design) throw notFound();
      if (design.approvalStatus === 'approved') throw badReq('Approved mix design is locked');
      const repo = m.getRepository(MixDesignMaterial);
      await repo.save(repo.create({ ...this.pickMaterial(dto), tenantId, mixDesignId: id }));
      return this.loadFull(m, id);
    });
  }

  deleteMaterial(tenantId: string, id: string, materialRowId: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(MixDesignMaterial);
      const row = await repo.findOne({ where: { id: materialRowId, mixDesignId: id } });
      if (!row) throw notFound();
      await repo.delete(materialRowId);
      return this.loadFull(m, id);
    });
  }

  approve(tenantId: string, id: string, userId: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(MixDesign);
      const design = await repo.findOne({ where: { id } });
      if (!design) throw notFound();
      const materials = await m.getRepository(MixDesignMaterial).count({ where: { mixDesignId: id } });
      if (!materials) throw badReq('Add at least one material before approving');
      await repo.update(id, { approvalStatus: 'approved', approvedBy: userId, approvedAt: new Date() });
      return this.loadFull(m, id);
    });
  }

  reject(tenantId: string, id: string, userId: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(MixDesign);
      const design = await repo.findOne({ where: { id } });
      if (!design) throw notFound();
      await repo.update(id, { approvalStatus: 'rejected', approvedBy: userId, approvedAt: new Date() });
      return this.loadFull(m, id);
    });
  }
}
