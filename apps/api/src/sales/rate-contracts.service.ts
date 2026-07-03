import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { TenantDbService } from '../core/database/tenant-db.service';
import { RateContract, RateContractItem } from '../core/database/entities';
import { nullifyEmpty } from '../common/sanitize';
import { NumberingService } from './numbering.service';

const notFound = () => new NotFoundException({ code: 'RECORD_NOT_FOUND', message: 'Not found' });
const badReq = (message: string) => new BadRequestException({ code: 'VALIDATION_ERROR', message });

const ITEM_FIELDS = [
  'gradeId',
  'gradeLabel',
  'ratePerM3',
  'transportCharge',
  'pumpCharge',
  'waitingCharge',
  'gstApplicable',
  'remarks',
] as const;

/** Rate contracts: header, grade-wise items, approval flow (Doc 6.1 R2). */
@Injectable()
export class RateContractsService {
  constructor(
    private readonly db: TenantDbService,
    private readonly numbering: NumberingService,
  ) {}

  list(tenantId: string) {
    return this.db.runInTenant(tenantId, (m) =>
      m.getRepository(RateContract).find({ order: { createdAt: 'DESC' } }),
    );
  }

  private async loadFull(m: EntityManager, id: string) {
    const contract = await m.getRepository(RateContract).findOne({ where: { id } });
    if (!contract) throw notFound();
    const items = await m
      .getRepository(RateContractItem)
      .find({ where: { rateContractId: id }, order: { createdAt: 'ASC' } });
    return { ...contract, items };
  }

  get(tenantId: string, id: string) {
    return this.db.runInTenant(tenantId, (m) => this.loadFull(m, id));
  }

  private pickItem(raw: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const f of ITEM_FIELDS) if (raw[f] !== undefined) out[f] = raw[f] === '' ? null : raw[f];
    return out;
  }

  create(tenantId: string, dto: Record<string, unknown>) {
    return this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(RateContract);
      const rateContractNo = await this.numbering.next(m, tenantId, 'rate_contract', 'RC-');
      const rest = nullifyEmpty(dto);
      for (const k of ['id', 'tenantId', 'rateContractNo', 'approvalStatus', 'items']) delete rest[k];
      const contract = await repo.save(
        repo.create({
          ...rest,
          tenantId,
          rateContractNo,
          approvalStatus: 'draft',
        } as Record<string, unknown>),
      );
      if (Array.isArray(dto.items)) {
        const itemRepo = m.getRepository(RateContractItem);
        for (const raw of dto.items as Record<string, unknown>[]) {
          await itemRepo.save(
            itemRepo.create({ ...this.pickItem(raw), tenantId, rateContractId: contract.id }),
          );
        }
      }
      return this.loadFull(m, contract.id);
    });
  }

  update(tenantId: string, id: string, dto: Record<string, unknown>) {
    return this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(RateContract);
      const contract = await repo.findOne({ where: { id } });
      if (!contract) throw notFound();
      if (contract.approvalStatus === 'approved') {
        throw badReq('Approved rate contract is locked');
      }
      const rest = nullifyEmpty(dto);
      for (const k of ['id', 'tenantId', 'rateContractNo', 'approvalStatus', 'items']) delete rest[k];
      await repo.update(id, rest as Record<string, unknown>);
      return this.loadFull(m, id);
    });
  }

  addItem(tenantId: string, rateContractId: string, dto: Record<string, unknown>) {
    return this.db.runInTenant(tenantId, async (m) => {
      const contract = await m.getRepository(RateContract).findOne({ where: { id: rateContractId } });
      if (!contract) throw notFound();
      const repo = m.getRepository(RateContractItem);
      await repo.save(repo.create({ ...this.pickItem(dto), tenantId, rateContractId }));
      return this.loadFull(m, rateContractId);
    });
  }

  updateItem(tenantId: string, rateContractId: string, itemId: string, dto: Record<string, unknown>) {
    return this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(RateContractItem);
      const item = await repo.findOne({ where: { id: itemId, rateContractId } });
      if (!item) throw notFound();
      await repo.update(itemId, this.pickItem(dto));
      return this.loadFull(m, rateContractId);
    });
  }

  deleteItem(tenantId: string, rateContractId: string, itemId: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(RateContractItem);
      const item = await repo.findOne({ where: { id: itemId, rateContractId } });
      if (!item) throw notFound();
      await repo.delete(itemId);
      return this.loadFull(m, rateContractId);
    });
  }

  private transition(tenantId: string, id: string, from: string[], to: string, patch: Record<string, unknown> = {}) {
    return this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(RateContract);
      const contract = await repo.findOne({ where: { id } });
      if (!contract) throw notFound();
      if (!from.includes(contract.approvalStatus)) {
        throw badReq(`Cannot move from ${contract.approvalStatus} to ${to}`);
      }
      await repo.update(id, { approvalStatus: to, ...patch });
      return this.loadFull(m, id);
    });
  }

  submit(tenantId: string, id: string) {
    return this.transition(tenantId, id, ['draft', 'rejected'], 'submitted');
  }

  approve(tenantId: string, id: string) {
    return this.transition(tenantId, id, ['submitted'], 'approved');
  }

  reject(tenantId: string, id: string, reason?: string) {
    return this.transition(tenantId, id, ['submitted'], 'rejected', { remarks: reason ?? null });
  }
}
