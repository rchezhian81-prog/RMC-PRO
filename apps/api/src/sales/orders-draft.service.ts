import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { TenantDbService } from '../core/database/tenant-db.service';
import {
  Company,
  Customer,
  Order,
  OrderItem,
  Quotation,
  QuotationItem,
  RateContract,
  RateContractItem,
} from '../core/database/entities';
import { nullifyEmpty } from '../common/sanitize';
import { attachCustomerName } from '../common/attach-customer-name';
import { NumberingService } from './numbering.service';
import { summariseGst, isInterstateSupply, type QuoteLine } from '../billing/tax.util';

const notFound = () => new NotFoundException({ code: 'RECORD_NOT_FOUND', message: 'Not found' });
const badReq = (message: string) => new BadRequestException({ code: 'VALIDATION_ERROR', message });

const num = (v: unknown): number => Number(v ?? 0) || 0;

/**
 * Order DRAFT handoff (Design Doc 6 §9.1, Doc 6.1 R1) — Sprint 4 scope boundary.
 * This service ONLY creates draft orders from an approved quotation or rate
 * contract. It never confirms an order, runs a credit check, plans production,
 * dispatches, batches or bills — those belong to later sprints. Every order it
 * writes stays in order_status = 'draft'.
 */
@Injectable()
export class OrdersDraftService {
  constructor(
    private readonly db: TenantDbService,
    private readonly numbering: NumberingService,
  ) {}

  list(tenantId: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const drafts = await m.getRepository(Order).find({ where: { orderStatus: 'draft' }, order: { createdAt: 'DESC' } });
      return attachCustomerName(m, drafts);
    });
  }

  private async loadFull(m: EntityManager, id: string) {
    const order = await m.getRepository(Order).findOne({ where: { id } });
    if (!order) throw notFound();
    const items = await m
      .getRepository(OrderItem)
      .find({ where: { orderId: id }, order: { createdAt: 'ASC' } });
    return { ...order, items };
  }

  get(tenantId: string, id: string) {
    return this.db.runInTenant(tenantId, (m) => this.loadFull(m, id));
  }

  private lineValue(quantity: number, rate: number, transport: number, pump: number, waiting: number): number {
    return quantity * rate + transport + pump + waiting;
  }

  /**
   * GST-inclusive order value for credit exposure — the same tax logic quotations
   * use (freight is part of the taxable base), so order value, outstanding and
   * credit-hold all reconcile with the eventual invoice. Inter/intra-state is
   * the buyer's state vs the seller company's state.
   */
  private async gstInclusiveTotal(m: EntityManager, customerId: string | null, lines: QuoteLine[]): Promise<number> {
    const company = (await m.getRepository(Company).find({ take: 1 }))[0];
    const customer = customerId
      ? await m.getRepository(Customer).findOne({ where: { id: customerId } })
      : null;
    return summariseGst(lines, isInterstateSupply(company?.state, customer?.state)).total;
  }

  /** Convert an APPROVED quotation into a draft order (handoff only). */
  fromQuotation(tenantId: string, quotationId: string, rawDto: Record<string, unknown>) {
    const dto = nullifyEmpty(rawDto);
    return this.db.runInTenant(tenantId, async (m) => {
      const quotation = await m.getRepository(Quotation).findOne({ where: { id: quotationId } });
      if (!quotation) throw notFound();
      if (quotation.approvalStatus !== 'approved') {
        throw badReq('Only an approved quotation can be converted to an order draft');
      }
      const items = await m
        .getRepository(QuotationItem)
        .find({ where: { quotationId }, order: { createdAt: 'ASC' } });
      if (!items.length) throw badReq('Quotation has no items to convert');

      const orderNo = await this.numbering.next(m, tenantId, 'order', 'ORD-');
      const orderRepo = m.getRepository(Order);
      const order = await orderRepo.save(
        orderRepo.create({
          tenantId,
          orderNo,
          customerId: quotation.customerId,
          siteId: quotation.siteId,
          plantId: (dto.plantId as string) ?? null,
          quotationId,
          orderDate: (dto.orderDate as string) ?? null,
          requiredDatetime: (dto.requiredDatetime as Date) ?? null,
          pricingSource: 'quotation',
          creditStatus: 'not_checked',
          orderStatus: 'draft',
          specialInstructions: (dto.specialInstructions as string) ?? null,
        }),
      );

      const itemRepo = m.getRepository(OrderItem);
      let total = 0;
      const gstLines: QuoteLine[] = [];
      for (const it of items) {
        const qty = num(it.estimatedQuantity);
        total += this.lineValue(
          qty,
          num(it.ratePerM3),
          num(it.transportCharge),
          num(it.pumpCharge),
          num(it.waitingCharge),
        );
        gstLines.push({
          quantity: qty, rate: num(it.ratePerM3),
          transport: num(it.transportCharge), pump: num(it.pumpCharge), waiting: num(it.waitingCharge),
          gstRate: it.gstRate != null ? num(it.gstRate) : 18, gstApplicable: it.gstApplicable,
        });
        await itemRepo.save(
          itemRepo.create({
            tenantId,
            orderId: order.id,
            gradeId: it.gradeId,
            gradeLabel: it.gradeLabel,
            quantityM3: String(qty),
            ratePerM3: it.ratePerM3,
            transportCharge: it.transportCharge,
            pumpCharge: it.pumpCharge,
            waitingCharge: it.waitingCharge,
            gstRate: it.gstApplicable === false ? '0' : (it.gstRate ?? '18'),
            lineStatus: 'draft',
          }),
        );
      }
      const inclGst = await this.gstInclusiveTotal(m, quotation.customerId, gstLines);
      await orderRepo.update(order.id, {
        estimatedOrderValue: total.toFixed(2),
        estimatedOrderValueInclGst: inclGst.toFixed(2),
      });
      return this.loadFull(m, order.id);
    });
  }

  /**
   * Convert an APPROVED rate contract into a draft order. Rate contracts hold no
   * quantities, so callers pass quantities per grade via dto.lines
   * ([{ gradeId?, gradeLabel?, quantityM3 }]); grades are matched to contract
   * items to pull the agreed rate + charges.
   */
  fromRateContract(tenantId: string, rateContractId: string, rawDto: Record<string, unknown>) {
    const dto = nullifyEmpty(rawDto);
    return this.db.runInTenant(tenantId, async (m) => {
      const contract = await m.getRepository(RateContract).findOne({ where: { id: rateContractId } });
      if (!contract) throw notFound();
      if (contract.approvalStatus !== 'approved') {
        throw badReq('Only an approved rate contract can be converted to an order draft');
      }
      const contractItems = await m
        .getRepository(RateContractItem)
        .find({ where: { rateContractId }, order: { createdAt: 'ASC' } });
      if (!contractItems.length) throw badReq('Rate contract has no items');

      const lines = Array.isArray(dto.lines) ? (dto.lines as Record<string, unknown>[]) : [];
      if (!lines.length) throw badReq('Provide lines[] with quantities to convert');

      const orderNo = await this.numbering.next(m, tenantId, 'order', 'ORD-');
      const orderRepo = m.getRepository(Order);
      const order = await orderRepo.save(
        orderRepo.create({
          tenantId,
          orderNo,
          customerId: contract.customerId,
          siteId: contract.siteId,
          plantId: (dto.plantId as string) ?? null,
          rateContractId,
          orderDate: (dto.orderDate as string) ?? null,
          requiredDatetime: (dto.requiredDatetime as Date) ?? null,
          pricingSource: 'rate_contract',
          creditStatus: 'not_checked',
          orderStatus: 'draft',
          specialInstructions: (dto.specialInstructions as string) ?? null,
        }),
      );

      const itemRepo = m.getRepository(OrderItem);
      let total = 0;
      const gstLines: QuoteLine[] = [];
      for (const line of lines) {
        const match =
          contractItems.find((c) => line.gradeId && c.gradeId === line.gradeId) ??
          contractItems.find((c) => line.gradeLabel && c.gradeLabel === line.gradeLabel) ??
          contractItems[0];
        if (!match) throw badReq('No matching rate contract item for line');
        const qty = num(line.quantityM3);
        total += this.lineValue(
          qty,
          num(match.ratePerM3),
          num(match.transportCharge),
          num(match.pumpCharge),
          num(match.waitingCharge),
        );
        gstLines.push({
          quantity: qty, rate: num(match.ratePerM3),
          transport: num(match.transportCharge), pump: num(match.pumpCharge), waiting: num(match.waitingCharge),
          gstRate: match.gstRate != null ? num(match.gstRate) : 18, gstApplicable: match.gstApplicable,
        });
        await itemRepo.save(
          itemRepo.create({
            tenantId,
            orderId: order.id,
            gradeId: match.gradeId,
            gradeLabel: match.gradeLabel ?? (line.gradeLabel as string) ?? null,
            quantityM3: String(qty),
            ratePerM3: match.ratePerM3,
            transportCharge: match.transportCharge,
            pumpCharge: match.pumpCharge,
            waitingCharge: match.waitingCharge,
            gstRate: match.gstApplicable === false ? '0' : (match.gstRate ?? '18'),
            lineStatus: 'draft',
          }),
        );
      }
      // Set the GST-inclusive value too (mirrors fromQuotation) — it is the
      // amount the credit check counts, so omitting it here would undercount a
      // rate-contract order's exposure by the whole GST component.
      const inclGst = await this.gstInclusiveTotal(m, contract.customerId, gstLines);
      await orderRepo.update(order.id, {
        estimatedOrderValue: total.toFixed(2),
        estimatedOrderValueInclGst: inclGst.toFixed(2),
      });
      return this.loadFull(m, order.id);
    });
  }
}
