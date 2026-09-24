import { listLimit } from '../common/list-limit.util';
import { assertSalesRefs } from './sales-refs.util';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

type Row = Record<string, unknown>;
import { TenantDbService } from '../core/database/tenant-db.service';
import { RateContract, RateContractItem } from '../core/database/entities';
import { nullifyEmpty } from '../common/sanitize';
import { AuditService, AUDIT_ACTIONS } from '../audit/audit.service';
import { NumberingService } from './numbering.service';

const notFound = () => new NotFoundException({ code: 'RECORD_NOT_FOUND', message: 'Not found' });
const badReq = (message: string) => new BadRequestException({ code: 'VALIDATION_ERROR', message });
/** Reject a validity window whose end precedes its start (ISO dates compare lexically). */
const assertWindow = (from: unknown, to: unknown): void => {
  if (from && to && String(to) < String(from)) throw badReq('Valid-to date cannot be before valid-from');
};

const ITEM_FIELDS = [
  'gradeId',
  'gradeLabel',
  'ratePerM3',
  'transportCharge',
  'pumpCharge',
  'waitingCharge',
  'gstApplicable',
  'gstRate',
  'remarks',
] as const;

/** Rate contracts: header, grade-wise items, approval flow (Doc 6.1 R2). */
@Injectable()
export class RateContractsService {
  constructor(
    private readonly db: TenantDbService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
  ) {}

  /**
   * What the list screen needs beside each contract: the customer and site
   * by name, how many grades it prices (with the labels and the rate range),
   * and how many orders have been booked against it with their volume. Three
   * grouped queries over the listed ids, not one per contract.
   */
  list(tenantId: string, limit?: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const contracts = await m.getRepository(RateContract).find({ order: { createdAt: 'DESC' }, take: listLimit(limit) });
      if (!contracts.length) return contracts;
      const ids = contracts.map((c) => c.id);
      const [names, items, orders] = await Promise.all([
        this.names(m, contracts),
        m.query(
          `SELECT i.rate_contract_id AS "rateContractId", COUNT(*)::int AS "itemCount",
                  STRING_AGG(i.grade_label, ', ' ORDER BY i.rate_per_m3) AS "gradeLabels",
                  MIN(i.rate_per_m3)::float AS "minRate", MAX(i.rate_per_m3)::float AS "maxRate"
             FROM rate_contract_items i WHERE i.rate_contract_id = ANY($1::uuid[]) GROUP BY i.rate_contract_id`,
          [ids],
        ) as Promise<Array<{ rateContractId: string; itemCount: number; gradeLabels: string | null; minRate: number; maxRate: number }>>,
        this.orderStats(m, ids),
      ]);
      const it = new Map(items.map((i) => [i.rateContractId, i]));
      return contracts.map((c) => ({
        ...c,
        ...names(c),
        itemCount: it.get(c.id)?.itemCount ?? 0,
        gradeLabels: it.get(c.id)?.gradeLabels ?? null,
        minRate: it.get(c.id)?.minRate ?? null,
        maxRate: it.get(c.id)?.maxRate ?? null,
        ...(orders.get(c.id) ?? { orderCount: 0, orderedM3: 0, orderValue: 0 }),
      }));
    });
  }

  /** Customer and site names for a set of contracts, as a lookup. */
  private async names(m: EntityManager, contracts: RateContract[]) {
    const customerIds = [...new Set(contracts.map((c) => c.customerId).filter((v): v is string => !!v))];
    const siteIds = [...new Set(contracts.map((c) => c.siteId).filter((v): v is string => !!v))];
    const [customers, sites] = await Promise.all([
      customerIds.length ? (m.query(`SELECT id, customer_name AS name FROM customers WHERE id = ANY($1::uuid[])`, [customerIds]) as Promise<Array<{ id: string; name: string }>>) : [],
      siteIds.length ? (m.query(`SELECT id, site_name AS name FROM sites WHERE id = ANY($1::uuid[])`, [siteIds]) as Promise<Array<{ id: string; name: string }>>) : [],
    ]);
    const cn = new Map(customers.map((c) => [c.id, c.name]));
    const sn = new Map(sites.map((s) => [s.id, s.name]));
    return (c: RateContract) => ({
      customerName: c.customerId ? cn.get(c.customerId) ?? null : null,
      siteName: c.siteId ? sn.get(c.siteId) ?? null : null,
    });
  }

  /** Orders booked against each contract (draft to completed, not cancelled): count, m³ and value. */
  private async orderStats(m: EntityManager, ids: string[]) {
    const rows: Array<{ rateContractId: string; orderCount: number; orderedM3: number; orderValue: number }> = await m.query(
      `SELECT o.rate_contract_id AS "rateContractId", COUNT(*)::int AS "orderCount",
              COALESCE(SUM(oi.m3), 0)::float AS "orderedM3", COALESCE(SUM(o.estimated_order_value), 0)::float AS "orderValue"
         FROM orders o
         LEFT JOIN LATERAL (SELECT SUM(quantity_m3) AS m3 FROM order_items WHERE order_id = o.id) oi ON TRUE
        WHERE o.rate_contract_id = ANY($1::uuid[]) AND o.order_status <> 'cancelled'
        GROUP BY o.rate_contract_id`,
      [ids],
    );
    return new Map(rows.map((r) => [r.rateContractId, { orderCount: r.orderCount, orderedM3: r.orderedM3, orderValue: r.orderValue }]));
  }

  private async loadFull(m: EntityManager, id: string) {
    const contract = await m.getRepository(RateContract).findOne({ where: { id } });
    if (!contract) throw notFound();
    const [items, names, stats, orders] = await Promise.all([
      m.getRepository(RateContractItem).find({ where: { rateContractId: id }, order: { createdAt: 'ASC' } }),
      this.names(m, [contract]),
      this.orderStats(m, [id]),
      m.query(
        `SELECT o.id, o.order_no AS "orderNo", o.order_date::text AS "orderDate", o.order_status AS "orderStatus",
                o.estimated_order_value::float AS "estimatedOrderValue",
                COALESCE((SELECT SUM(quantity_m3) FROM order_items WHERE order_id = o.id), 0)::float AS "quantityM3",
                (SELECT STRING_AGG(DISTINCT grade_label, ', ') FROM order_items WHERE order_id = o.id) AS "gradeLabels"
           FROM orders o WHERE o.rate_contract_id = $1 ORDER BY o.created_at DESC LIMIT 50`,
        [id],
      ) as Promise<Row[]>,
    ]);
    return { ...contract, ...names(contract), ...(stats.get(id) ?? { orderCount: 0, orderedM3: 0, orderValue: 0 }), items, orders };
  }

  get(tenantId: string, id: string) {
    return this.db.runInTenant(tenantId, (m) => this.loadFull(m, id));
  }

  private pickItem(raw: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const f of ITEM_FIELDS) if (raw[f] !== undefined) out[f] = raw[f] === '' ? null : raw[f];
    // Reject negative rates/charges — meaningless and understates order value.
    for (const f of ['ratePerM3', 'transportCharge', 'pumpCharge', 'waitingCharge', 'gstRate'] as const) {
      if (out[f] != null && Number(out[f]) < 0) throw badReq(`${f} cannot be negative`);
    }
    return out;
  }

  create(tenantId: string, dto: Record<string, unknown>) {
    return this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(RateContract);
      const rateContractNo = await this.numbering.next(m, tenantId, 'rate_contract', 'RC-');
      const rest = nullifyEmpty(dto);
      for (const k of ['id', 'tenantId', 'rateContractNo', 'approvalStatus', 'items']) delete rest[k];
      assertWindow(rest.validFrom, rest.validTo);
      await assertSalesRefs(m, rest);
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
      assertWindow(rest.validFrom ?? contract.validFrom, rest.validTo ?? contract.validTo);
      await assertSalesRefs(m, rest, contract.customerId);
      await repo.update(id, rest as Record<string, unknown>);
      return this.loadFull(m, id);
    });
  }

  addItem(tenantId: string, rateContractId: string, dto: Record<string, unknown>) {
    return this.db.runInTenant(tenantId, async (m) => {
      const contract = await m.getRepository(RateContract).findOne({ where: { id: rateContractId } });
      if (!contract) throw notFound();
      // Items are the priced content of the contract: once approved they are as
      // locked as the header (every from-rate-contract order prices from them).
      if (contract.approvalStatus === 'approved') throw badReq('Approved rate contract is locked');
      const repo = m.getRepository(RateContractItem);
      await repo.save(repo.create({ ...this.pickItem(dto), tenantId, rateContractId }));
      return this.loadFull(m, rateContractId);
    });
  }

  updateItem(tenantId: string, rateContractId: string, itemId: string, dto: Record<string, unknown>) {
    return this.db.runInTenant(tenantId, async (m) => {
      const contract = await m.getRepository(RateContract).findOne({ where: { id: rateContractId } });
      if (!contract) throw notFound();
      if (contract.approvalStatus === 'approved') throw badReq('Approved rate contract is locked');
      const repo = m.getRepository(RateContractItem);
      const item = await repo.findOne({ where: { id: itemId, rateContractId } });
      if (!item) throw notFound();
      await repo.update(itemId, this.pickItem(dto));
      return this.loadFull(m, rateContractId);
    });
  }

  deleteItem(tenantId: string, rateContractId: string, itemId: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const contract = await m.getRepository(RateContract).findOne({ where: { id: rateContractId } });
      if (!contract) throw notFound();
      if (contract.approvalStatus === 'approved') throw badReq('Approved rate contract is locked');
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

  async approve(tenantId: string, id: string, userId: string) {
    const full = await this.transition(tenantId, id, ['submitted'], 'approved');
    await this.audit.record({
      tenantId,
      actorUserId: userId,
      action: AUDIT_ACTIONS.RATE_CONTRACT_APPROVE,
      entityType: 'rate_contract',
      entityId: id,
      entityLabel: full.rateContractNo,
      summary: `Approved rate contract ${full.rateContractNo}`,
    });
    return full;
  }

  async reject(tenantId: string, id: string, userId: string, reason?: string) {
    const full = await this.transition(tenantId, id, ['submitted'], 'rejected', { remarks: reason ?? null });
    await this.audit.record({
      tenantId,
      actorUserId: userId,
      action: AUDIT_ACTIONS.RATE_CONTRACT_REJECT,
      entityType: 'rate_contract',
      entityId: id,
      entityLabel: full.rateContractNo,
      summary: `Rejected rate contract ${full.rateContractNo}${reason ? ` — ${reason}` : ''}`,
      details: { reason: reason ?? null },
    });
    return full;
  }
}
