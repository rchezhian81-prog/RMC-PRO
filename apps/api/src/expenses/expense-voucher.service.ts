import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { TenantDbService } from '../core/database/tenant-db.service';
import {
  ExpenseHead,
  ExpenseVoucher,
  ExpenseVoucherLine,
  Plant,
  Site,
  Vehicle,
} from '../core/database/entities';
import { NumberingService } from '../sales/numbering.service';
import { AuditService, AUDIT_ACTIONS } from '../audit/audit.service';
import { allocationSummary, categorySummary } from './expenses.util';

const notFound = () => new NotFoundException({ code: 'RECORD_NOT_FOUND', message: 'Expense voucher not found' });
const badReq = (message: string) => new BadRequestException({ code: 'VALIDATION_ERROR', message });
const num = (v: unknown): number => Number(v ?? 0) || 0;
const round2 = (v: number): number => Math.round((Number(v) || 0) * 100) / 100;
const todayIso = (): string => new Date().toISOString().slice(0, 10);

const ALLOCATION_TYPES = new Set(['plant', 'vehicle', 'site', 'general']);

/**
 * Expense vouchers (Plan D4). A voucher is one payment split into allocated
 * lines; each line is charged to a cost object (plant / vehicle / site / general)
 * whose label is resolved authoritatively on save. Posting commits the spend and
 * is audited; an allocation report rolls posted lines up by cost object and head.
 */
@Injectable()
export class ExpenseVoucherService {
  constructor(
    private readonly db: TenantDbService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
  ) {}

  list(tenantId: string, status?: string) {
    return this.db.runInTenant(tenantId, (m) =>
      m.getRepository(ExpenseVoucher).find({ where: status ? { status } : {}, order: { createdAt: 'DESC' } }),
    );
  }

  private async loadFull(m: EntityManager, id: string) {
    const voucher = await m.getRepository(ExpenseVoucher).findOne({ where: { id } });
    if (!voucher) throw notFound();
    const lines = await m.getRepository(ExpenseVoucherLine).find({ where: { expenseVoucherId: id }, order: { createdAt: 'ASC' } });
    return { ...voucher, lines };
  }

  get(tenantId: string, id: string) {
    return this.db.runInTenant(tenantId, (m) => this.loadFull(m, id));
  }

  /** Resolve the display label for a cost object from its master. */
  private async resolveAllocationLabel(m: EntityManager, type: string, id: string | null): Promise<string | null> {
    if (!id || type === 'general') return null;
    if (type === 'plant') return (await m.getRepository(Plant).findOne({ where: { id } }))?.plantName ?? null;
    if (type === 'vehicle') return (await m.getRepository(Vehicle).findOne({ where: { id } }))?.vehicleNo ?? null;
    if (type === 'site') return (await m.getRepository(Site).findOne({ where: { id } }))?.siteName ?? null;
    return null;
  }

  create(tenantId: string, dto: Record<string, unknown>) {
    const lines = Array.isArray(dto.lines) ? (dto.lines as Record<string, unknown>[]) : [];
    if (!lines.length) throw badReq('At least one line is required');

    return this.db.runInTenant(tenantId, async (m) => {
      const voucherNo = await this.numbering.next(m, tenantId, 'expense_voucher', 'EXP-');
      const voucherRepo = m.getRepository(ExpenseVoucher);
      const voucher = await voucherRepo.save(
        voucherRepo.create({
          tenantId, voucherNo,
          voucherDate: (dto.voucherDate as string) ?? todayIso(),
          payee: (dto.payee as string) ?? null,
          paymentMode: (dto.paymentMode as string) ?? null,
          plantId: (dto.plantId as string) ?? null,
          narration: (dto.narration as string) ?? null,
          status: 'draft', remarks: (dto.remarks as string) ?? null,
        }),
      );

      const lineRepo = m.getRepository(ExpenseVoucherLine);
      const headRepo = m.getRepository(ExpenseHead);
      let total = 0;
      for (const line of lines) {
        const amount = num(line.amount);
        if (amount <= 0) throw badReq('Each line needs an amount greater than zero');
        const allocationType = String(line.allocationType ?? 'general');
        if (!ALLOCATION_TYPES.has(allocationType)) throw badReq('allocationType must be plant, vehicle, site or general');
        const allocationId = (line.allocationId as string) || null;

        const expenseHeadId = (line.expenseHeadId as string) || null;
        let expenseHeadLabel: string | null = (line.expenseHeadLabel as string) ?? null;
        if (expenseHeadId) {
          const head = await headRepo.findOne({ where: { id: expenseHeadId } });
          if (!head) throw badReq('Expense head not found');
          expenseHeadLabel = head.headName;
        }
        if (!expenseHeadLabel) throw badReq('Each line needs an expense head');

        const allocationLabel =
          (await this.resolveAllocationLabel(m, allocationType, allocationId)) ?? ((line.allocationLabel as string) || null);

        await lineRepo.save(
          lineRepo.create({
            tenantId, expenseVoucherId: voucher.id, expenseHeadId, expenseHeadLabel,
            description: (line.description as string) ?? null,
            amount: String(round2(amount)),
            allocationType, allocationId, allocationLabel,
          }),
        );
        total = round2(total + amount);
      }

      await voucherRepo.update(voucher.id, { totalAmount: String(total) });
      return this.loadFull(m, voucher.id);
    });
  }

  /** Post a draft voucher — commits the spend to the books. Audited. */
  async post(tenantId: string, id: string, userId: string) {
    const { result, voucherNo, total } = await this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(ExpenseVoucher);
      const voucher = await repo.findOne({ where: { id } });
      if (!voucher) throw notFound();
      if (voucher.status !== 'draft') throw badReq(`Voucher already ${voucher.status}`);
      const lines = await m.getRepository(ExpenseVoucherLine).find({ where: { expenseVoucherId: id } });
      if (!lines.length) throw badReq('Cannot post a voucher with no lines');
      await repo.update(id, { status: 'posted' });
      return { result: await this.loadFull(m, id), voucherNo: voucher.voucherNo, total: voucher.totalAmount };
    });
    await this.audit.record({
      tenantId, actorUserId: userId, action: AUDIT_ACTIONS.EXPENSE_VOUCHER_POST,
      entityType: 'expense_voucher', entityId: id, entityLabel: voucherNo,
      summary: `Posted expense voucher ${voucherNo} (₹${total})`,
      details: { totalAmount: total },
    });
    return result;
  }

  /** Cancel a draft voucher (a posted one is committed to the books). */
  cancel(tenantId: string, id: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(ExpenseVoucher);
      const voucher = await repo.findOne({ where: { id } });
      if (!voucher) throw notFound();
      if (voucher.status === 'cancelled') throw badReq('Voucher already cancelled');
      if (voucher.status === 'posted') throw badReq('Cannot cancel a posted voucher');
      await repo.update(id, { status: 'cancelled' });
      return this.loadFull(m, id);
    });
  }

  /**
   * Cost-allocation report over POSTED vouchers: spend rolled up by cost object
   * and by expense head, optionally filtered by date range and booking plant.
   */
  allocationReport(tenantId: string, filters: { from?: string; to?: string; plantId?: string } = {}) {
    return this.db.runInTenant(tenantId, async (m) => {
      const params: unknown[] = [];
      const where: string[] = [`v.status = 'posted'`];
      if (filters.from) { params.push(filters.from); where.push(`v.voucher_date >= $${params.length}`); }
      if (filters.to) { params.push(filters.to); where.push(`v.voucher_date <= $${params.length}`); }
      if (filters.plantId) { params.push(filters.plantId); where.push(`v.plant_id = $${params.length}`); }

      const rows: Array<{ allocationType: string; allocationLabel: string | null; expenseHeadLabel: string | null; amount: string }> =
        await m.query(
          `SELECT l.allocation_type AS "allocationType",
                  l.allocation_label AS "allocationLabel",
                  l.expense_head_label AS "expenseHeadLabel",
                  l.amount AS amount
             FROM expense_voucher_lines l
             JOIN expense_vouchers v ON v.id = l.expense_voucher_id
            WHERE ${where.join(' AND ')}`,
          params,
        );

      return {
        byCostObject: allocationSummary(rows),
        byHead: categorySummary(rows, (r) => r.expenseHeadLabel),
      };
    });
  }
}
