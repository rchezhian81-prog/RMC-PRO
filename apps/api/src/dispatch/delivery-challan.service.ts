import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { TenantDbService } from '../core/database/tenant-db.service';
import {
  Company,
  Customer,
  DeliveryChallan,
  DeliveryStatusHistory,
  Dispatch,
  Driver,
  Invoice,
  InvoiceChallan,
  Site,
  Vehicle,
} from '../core/database/entities';
import { NumberingService } from '../sales/numbering.service';
import { WhatsAppService } from '../sales/whatsapp.service';
import type { ChallanPdfData } from '../sales/pdf.service';
import { recordDeliveryHistory } from './delivery-history.util';

const notFound = () => new NotFoundException({ code: 'RECORD_NOT_FOUND', message: 'Challan not found' });
const badReq = (message: string) => new BadRequestException({ code: 'VALIDATION_ERROR', message });

/**
 * Delivery challan (DEV-PLAN B10). Generated from a dispatch with reserved
 * numbering, moved draft → issued → delivered, printed as PDF and shared over
 * WhatsApp. Invoicing (invoice_status) is a later sprint — challans stay
 * not_invoiced here.
 */
@Injectable()
export class DeliveryChallanService {
  constructor(
    private readonly db: TenantDbService,
    private readonly numbering: NumberingService,
    private readonly whatsapp: WhatsAppService,
  ) {}

  list(tenantId: string, status?: string) {
    return this.db.runInTenant(tenantId, (m) =>
      m.getRepository(DeliveryChallan).find({
        where: status ? { challanStatus: status } : {},
        order: { createdAt: 'DESC' },
      }),
    );
  }

  private async loadFull(m: EntityManager, id: string) {
    const challan = await m.getRepository(DeliveryChallan).findOne({ where: { id } });
    if (!challan) throw notFound();
    const history = await m
      .getRepository(DeliveryStatusHistory)
      .find({ where: { challanId: id }, order: { createdAt: 'ASC' } });
    return { ...challan, history };
  }

  get(tenantId: string, id: string) {
    return this.db.runInTenant(tenantId, (m) => this.loadFull(m, id));
  }

  /** Generate a challan from a dispatch (one active challan per dispatch). */
  createFromDispatch(tenantId: string, dispatchId: string, dto: Record<string, unknown>, userId: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const dispatch = await m.getRepository(Dispatch).findOne({ where: { id: dispatchId } });
      if (!dispatch) throw badReq('Dispatch not found');
      if (['cancelled', 'rejected'].includes(dispatch.dispatchStatus)) {
        throw badReq(`Dispatch is ${dispatch.dispatchStatus}`);
      }
      const existing = await m
        .getRepository(DeliveryChallan)
        .findOne({ where: { dispatchId } });
      if (existing && existing.challanStatus !== 'cancelled') {
        throw badReq('A challan already exists for this dispatch');
      }

      const challanNo = await this.numbering.next(m, tenantId, 'delivery_challan', 'DC-');
      const repo = m.getRepository(DeliveryChallan);
      const challan = await repo.save(
        repo.create({
          tenantId, challanNo, plantId: dispatch.plantId, dispatchId,
          orderId: dispatch.orderId, batchTicketId: dispatch.batchTicketId,
          customerId: dispatch.customerId, siteId: dispatch.siteId,
          vehicleId: dispatch.vehicleId, driverId: dispatch.driverId,
          gradeId: dispatch.gradeId, gradeLabel: dispatch.gradeLabel,
          quantityM3: dispatch.quantityM3, slump: (dto.slump as string) ?? null,
          dispatchTime: dispatch.dispatchTime ?? new Date(),
          invoiceStatus: 'not_invoiced', challanStatus: 'draft',
        }),
      );
      await recordDeliveryHistory(m, tenantId, { challanId: challan.id }, null, 'draft', userId, 'Challan generated');
      return this.loadFull(m, challan.id);
    });
  }

  private transition(tenantId: string, id: string, from: string[], to: string, userId: string, patch: Record<string, unknown> = {}) {
    return this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(DeliveryChallan);
      const challan = await repo.findOne({ where: { id } });
      if (!challan) throw notFound();
      if (!from.includes(challan.challanStatus)) {
        throw badReq(`Cannot move challan from ${challan.challanStatus} to ${to}`);
      }
      await repo.update(id, { challanStatus: to, ...patch });
      await recordDeliveryHistory(m, tenantId, { challanId: id }, challan.challanStatus, to, userId, (patch.note as string) ?? null);
      return this.loadFull(m, id);
    });
  }

  issue(tenantId: string, id: string, userId: string) {
    return this.transition(tenantId, id, ['draft'], 'issued', userId);
  }

  markDelivered(tenantId: string, id: string, dto: Record<string, unknown>, userId: string) {
    return this.transition(tenantId, id, ['issued'], 'delivered', userId, {
      receiverName: (dto.receiverName as string) ?? null,
      returnQuantityM3: dto.returnQuantityM3 !== undefined ? String(dto.returnQuantityM3) : '0',
    });
  }

  cancel(tenantId: string, id: string, userId: string, reason?: string) {
    return this.transition(tenantId, id, ['draft', 'issued'], 'cancelled', userId, { note: reason ?? null });
  }

  async pdfData(tenantId: string, id: string): Promise<{ data: ChallanPdfData; challan: DeliveryChallan }> {
    return this.db.runInTenant(tenantId, async (m) => {
      const challan = await m.getRepository(DeliveryChallan).findOne({ where: { id } });
      if (!challan) throw notFound();
      const company = (await m.getRepository(Company).find({ take: 1 }))[0];
      const customer = challan.customerId ? await m.getRepository(Customer).findOne({ where: { id: challan.customerId } }) : null;
      const site = challan.siteId ? await m.getRepository(Site).findOne({ where: { id: challan.siteId } }) : null;
      const vehicle = challan.vehicleId ? await m.getRepository(Vehicle).findOne({ where: { id: challan.vehicleId } }) : null;
      const driver = challan.driverId ? await m.getRepository(Driver).findOne({ where: { id: challan.driverId } }) : null;
      // If this challan has been invoiced and that invoice has an e-way bill,
      // carry the EWB number onto the dispatch document (runbook 02 §6).
      const link = await m.getRepository(InvoiceChallan).findOne({ where: { challanId: id } });
      const invoice = link ? await m.getRepository(Invoice).findOne({ where: { id: link.invoiceId } }) : null;
      const eway = invoice && invoice.ewayStatus === 'generated' ? invoice : null;
      const data: ChallanPdfData = {
        companyName: company?.companyName ?? 'Company',
        companyGstin: company?.gstin ?? null,
        companyState: company?.state ?? null,
        challanNo: challan.challanNo,
        challanStatus: challan.challanStatus,
        dispatchTime: challan.dispatchTime ? challan.dispatchTime.toISOString().slice(0, 16).replace('T', ' ') : null,
        customerName: customer?.customerName ?? 'Customer',
        siteName: site?.siteName ?? null,
        vehicleNo: vehicle?.vehicleNo ?? null,
        driverName: driver?.driverName ?? null,
        gradeLabel: challan.gradeLabel ?? '',
        quantityM3: challan.quantityM3,
        slump: challan.slump ?? null,
        receiverName: challan.receiverName ?? null,
        ewayBillNo: eway?.ewayBillNo ?? null,
        ewayValidUntil: eway?.ewayValidUntil
          ? new Date(eway.ewayValidUntil).toISOString().replace('T', ' ').slice(0, 16)
          : null,
      };
      return { data, challan };
    });
  }

  async share(tenantId: string, id: string, dto: Record<string, unknown>) {
    return this.db.runInTenant(tenantId, async (m) => {
      const challan = await m.getRepository(DeliveryChallan).findOne({ where: { id } });
      if (!challan) throw notFound();
      const customer = challan.customerId ? await m.getRepository(Customer).findOne({ where: { id: challan.customerId } }) : null;
      const mobile = (dto.mobile as string) ?? customer?.mobile ?? null;
      const message =
        (dto.message as string) ??
        `Delivery challan ${challan.challanNo}: ${challan.gradeLabel ?? ''} ${challan.quantityM3} m³. Status: ${challan.challanStatus}.`;
      return this.whatsapp.logWithin(m, tenantId, {
        recipientMobile: mobile, moduleKey: 'dispatch', eventKey: 'challan_share',
        referenceType: 'delivery_challan', referenceId: id, message,
      });
    });
  }
}
