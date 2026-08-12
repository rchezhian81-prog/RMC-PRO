import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantDbService } from '../core/database/tenant-db.service';
import { ExpenseGroup, ExpenseHead } from '../core/database/entities';

const badReq = (message: string) => new BadRequestException({ code: 'VALIDATION_ERROR', message });

/** Expense group master (Plan D4) — the top-level expense category list. */
@Injectable()
export class ExpenseGroupService {
  constructor(private readonly db: TenantDbService) {}

  list(tenantId: string) {
    return this.db.runInTenant(tenantId, (m) =>
      m.getRepository(ExpenseGroup).find({ order: { groupName: 'ASC' } }),
    );
  }

  get(tenantId: string, id: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const g = await m.getRepository(ExpenseGroup).findOne({ where: { id } });
      if (!g) throw new NotFoundException({ code: 'RECORD_NOT_FOUND', message: 'Expense group not found' });
      return g;
    });
  }

  create(tenantId: string, dto: Record<string, unknown>) {
    const groupCode = String(dto.groupCode ?? '').trim();
    const groupName = String(dto.groupName ?? '').trim();
    if (!groupCode) throw badReq('groupCode required');
    if (!groupName) throw badReq('groupName required');
    return this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(ExpenseGroup);
      return repo.save(
        repo.create({ tenantId, groupCode, groupName, status: (dto.status as string) ?? 'active', remarks: (dto.remarks as string) ?? null }),
      );
    });
  }

  update(tenantId: string, id: string, dto: Record<string, unknown>) {
    return this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(ExpenseGroup);
      const g = await repo.findOne({ where: { id } });
      if (!g) throw new NotFoundException({ code: 'RECORD_NOT_FOUND', message: 'Expense group not found' });
      await repo.update(id, {
        groupName: dto.groupName === undefined ? g.groupName : String(dto.groupName).trim(),
        status: dto.status === undefined ? g.status : String(dto.status),
        remarks: dto.remarks === undefined ? g.remarks : ((dto.remarks as string) ?? null),
      });
      return repo.findOne({ where: { id } });
    });
  }
}

/** Expense head master (Plan D4) — individual expense types under a group. */
@Injectable()
export class ExpenseHeadService {
  constructor(private readonly db: TenantDbService) {}

  list(tenantId: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const heads = await m.getRepository(ExpenseHead).find({ order: { headName: 'ASC' } });
      const groups = await m.getRepository(ExpenseGroup).find();
      const groupName = new Map(groups.map((g) => [g.id, g.groupName]));
      return heads.map((h) => ({ ...h, groupLabel: h.groupId ? groupName.get(h.groupId) ?? null : null }));
    });
  }

  get(tenantId: string, id: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const h = await m.getRepository(ExpenseHead).findOne({ where: { id } });
      if (!h) throw new NotFoundException({ code: 'RECORD_NOT_FOUND', message: 'Expense head not found' });
      return h;
    });
  }

  create(tenantId: string, dto: Record<string, unknown>) {
    const headCode = String(dto.headCode ?? '').trim();
    const headName = String(dto.headName ?? '').trim();
    if (!headCode) throw badReq('headCode required');
    if (!headName) throw badReq('headName required');
    return this.db.runInTenant(tenantId, async (m) => {
      const groupId = (dto.groupId as string) || null;
      if (groupId) {
        const group = await m.getRepository(ExpenseGroup).findOne({ where: { id: groupId } });
        if (!group) throw badReq('Expense group not found');
      }
      const repo = m.getRepository(ExpenseHead);
      return repo.save(
        repo.create({
          tenantId, headCode, headName, groupId,
          defaultCostType: (dto.defaultCostType as string) ?? null,
          status: (dto.status as string) ?? 'active',
        }),
      );
    });
  }

  update(tenantId: string, id: string, dto: Record<string, unknown>) {
    return this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(ExpenseHead);
      const h = await repo.findOne({ where: { id } });
      if (!h) throw new NotFoundException({ code: 'RECORD_NOT_FOUND', message: 'Expense head not found' });
      const groupId = dto.groupId === undefined ? h.groupId : ((dto.groupId as string) || null);
      if (groupId && groupId !== h.groupId) {
        const group = await m.getRepository(ExpenseGroup).findOne({ where: { id: groupId } });
        if (!group) throw badReq('Expense group not found');
      }
      await repo.update(id, {
        headName: dto.headName === undefined ? h.headName : String(dto.headName).trim(),
        groupId,
        defaultCostType: dto.defaultCostType === undefined ? h.defaultCostType : ((dto.defaultCostType as string) ?? null),
        status: dto.status === undefined ? h.status : String(dto.status),
      });
      return repo.findOne({ where: { id } });
    });
  }
}
