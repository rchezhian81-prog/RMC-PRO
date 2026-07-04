import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { TenantDbService } from '../core/database/tenant-db.service';
import {
  BatchQueueEntry,
  BatchTicket,
  BatchTicketMaterial,
  MixDesign,
  MixDesignMaterial,
} from '../core/database/entities';
import { NumberingService } from '../sales/numbering.service';
import { StockService } from './stock.service';

const notFound = () => new NotFoundException({ code: 'RECORD_NOT_FOUND', message: 'Batch ticket not found' });
const badReq = (message: string, extra?: unknown) =>
  new BadRequestException({ code: 'VALIDATION_ERROR', message, ...(extra ? { details: extra } : {}) });
const num = (v: unknown): number => Number(v ?? 0) || 0;

/**
 * Manual batch ticket (Design Doc 6 §10.4/§10.5). Enforces an APPROVED mix
 * design, snapshots material targets scaled to the batch size, records actuals,
 * checks variance against per-material tolerance, and on confirm reduces
 * inventory from actual consumption. No dispatch/challan/QC here.
 */
@Injectable()
export class BatchTicketsService {
  constructor(
    private readonly db: TenantDbService,
    private readonly numbering: NumberingService,
    private readonly stock: StockService,
  ) {}

  list(tenantId: string, status?: string) {
    return this.db.runInTenant(tenantId, (m) =>
      m.getRepository(BatchTicket).find({
        where: status ? { status } : {},
        order: { createdAt: 'DESC' },
      }),
    );
  }

  private async loadFull(m: EntityManager, id: string) {
    const ticket = await m.getRepository(BatchTicket).findOne({ where: { id } });
    if (!ticket) throw notFound();
    const materials = await m
      .getRepository(BatchTicketMaterial)
      .find({ where: { batchTicketId: id }, order: { createdAt: 'ASC' } });
    return { ...ticket, materials };
  }

  get(tenantId: string, id: string) {
    return this.db.runInTenant(tenantId, (m) => this.loadFull(m, id));
  }

  /** Latest approved, active mix design for a grade (approved-mix validation). */
  private resolveApprovedMix(m: EntityManager, gradeId: string | null, explicitId?: string | null) {
    const repo = m.getRepository(MixDesign);
    if (explicitId) {
      return repo.findOne({ where: { id: explicitId } });
    }
    if (!gradeId) return Promise.resolve(null);
    // A grade can carry several approved active mix designs (distinct mix codes).
    // Resolve deterministically — highest version, then most recently created —
    // so the current standard recipe wins instead of an arbitrary row.
    return repo.findOne({
      where: { gradeId, approvalStatus: 'approved', isActiveVersion: true },
      order: { versionNo: 'DESC', createdAt: 'DESC' },
    });
  }

  /** Create a manual batch ticket from a queued load. */
  createFromQueue(tenantId: string, queueId: string, dto: Record<string, unknown>, userId: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const queue = await m.getRepository(BatchQueueEntry).findOne({ where: { id: queueId } });
      if (!queue) throw badReq('Queue entry not found');
      if (queue.queueStatus === 'completed' || queue.queueStatus === 'cancelled') {
        throw badReq(`Queue entry is ${queue.queueStatus}`);
      }

      const remaining = num(queue.plannedQuantityM3) - num(queue.producedQuantityM3);
      const batchQty = dto.batchQuantityM3 !== undefined ? num(dto.batchQuantityM3) : remaining;
      if (batchQty <= 0) throw badReq('Batch quantity must be greater than zero');

      const mix = await this.resolveApprovedMix(m, queue.gradeId, dto.mixDesignId as string);
      if (!mix) throw badReq('No approved mix design available for this grade');
      if (mix.approvalStatus !== 'approved') throw badReq('Selected mix design is not approved');

      const mixMaterials = await m
        .getRepository(MixDesignMaterial)
        .find({ where: { mixDesignId: mix.id }, order: { sequenceNo: 'ASC' } });
      if (!mixMaterials.length) throw badReq('Mix design has no materials');

      const ticketNo = await this.numbering.next(m, tenantId, 'batch_ticket', 'BATCH-');
      const ticketRepo = m.getRepository(BatchTicket);
      const ticket = await ticketRepo.save(
        ticketRepo.create({
          tenantId, plantId: queue.plantId, batchTicketNo: ticketNo, orderId: queue.orderId,
          batchQueueId: queue.id, gradeId: queue.gradeId, gradeLabel: queue.gradeLabel,
          mixDesignId: mix.id, batchQuantityM3: String(batchQty), batchStartTime: new Date(),
          operatorUserId: userId, sourceType: 'manual', status: 'draft', varianceExceeded: false,
        }),
      );

      // Snapshot scaled targets; actual defaults to target until the operator edits.
      const matRepo = m.getRepository(BatchTicketMaterial);
      for (const mm of mixMaterials) {
        const target = num(mm.targetQuantity) * batchQty;
        await matRepo.save(
          matRepo.create({
            tenantId, batchTicketId: ticket.id, materialId: mm.materialId, materialLabel: mm.materialLabel,
            targetQuantity: String(target), actualQuantity: String(target),
            varianceQuantity: '0', variancePercentage: '0', uom: mm.uom,
            tolerancePercentage: mm.tolerancePercentage, withinTolerance: true,
          }),
        );
      }

      await m.getRepository(BatchQueueEntry).update(queue.id, { queueStatus: 'batching', mixDesignId: mix.id });
      return this.loadFull(m, ticket.id);
    });
  }

  /** Record actual consumed quantities (draft only) and recompute variance. */
  updateActuals(tenantId: string, ticketId: string, dto: Record<string, unknown>) {
    return this.db.runInTenant(tenantId, async (m) => {
      const ticket = await m.getRepository(BatchTicket).findOne({ where: { id: ticketId } });
      if (!ticket) throw notFound();
      if (ticket.status !== 'draft') throw badReq('Only a draft ticket can be edited');
      const rows = Array.isArray(dto.materials) ? (dto.materials as Record<string, unknown>[]) : [];
      const repo = m.getRepository(BatchTicketMaterial);
      for (const r of rows) {
        const id = String(r.id ?? '');
        const mat = await repo.findOne({ where: { id, batchTicketId: ticketId } });
        if (!mat) continue;
        const actual = num(r.actualQuantity);
        const v = this.variance(num(mat.targetQuantity), actual, num(mat.tolerancePercentage));
        await repo.update(id, {
          actualQuantity: String(actual),
          varianceQuantity: String(v.varianceQuantity),
          variancePercentage: String(v.variancePercentage),
          withinTolerance: v.withinTolerance,
        });
      }
      return this.loadFull(m, ticketId);
    });
  }

  private variance(target: number, actual: number, tolerance: number) {
    const varianceQuantity = actual - target;
    const variancePercentage = target !== 0 ? (varianceQuantity / target) * 100 : actual !== 0 ? 100 : 0;
    return {
      varianceQuantity: Number(varianceQuantity.toFixed(3)),
      variancePercentage: Number(variancePercentage.toFixed(2)),
      withinTolerance: Math.abs(variancePercentage) <= tolerance,
    };
  }

  /**
   * Confirm the batch: recompute variance, block if any material breaches
   * tolerance unless overrideVariance=true, then reduce inventory and advance
   * the queue.
   */
  confirm(tenantId: string, ticketId: string, dto: Record<string, unknown>, userId: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const ticketRepo = m.getRepository(BatchTicket);
      const ticket = await ticketRepo.findOne({ where: { id: ticketId } });
      if (!ticket) throw notFound();
      if (ticket.status !== 'draft') throw badReq(`Ticket already ${ticket.status}`);

      const matRepo = m.getRepository(BatchTicketMaterial);
      const materials = await matRepo.find({ where: { batchTicketId: ticketId } });
      if (!materials.length) throw badReq('Batch ticket has no materials');

      // Recompute variance against tolerance.
      const breaches: Array<{ material: string; variancePercentage: number; tolerance: number }> = [];
      for (const mat of materials) {
        const v = this.variance(num(mat.targetQuantity), num(mat.actualQuantity), num(mat.tolerancePercentage));
        await matRepo.update(mat.id, {
          varianceQuantity: String(v.varianceQuantity),
          variancePercentage: String(v.variancePercentage),
          withinTolerance: v.withinTolerance,
        });
        if (!v.withinTolerance) {
          breaches.push({
            material: mat.materialLabel ?? mat.materialId ?? 'material',
            variancePercentage: v.variancePercentage,
            tolerance: num(mat.tolerancePercentage),
          });
        }
      }

      const override = dto.overrideVariance === true;
      if (breaches.length && !override) {
        throw badReq('Material variance exceeds tolerance', breaches);
      }

      // Reduce inventory from actual consumption.
      for (const mat of materials) {
        const actual = num(mat.actualQuantity);
        if (!mat.materialId || actual <= 0) continue;
        await this.stock.consumeWithin(
          m, tenantId, ticket.plantId, mat.materialId, mat.materialLabel, mat.uom, actual, ticket.id, userId,
        );
      }

      await ticketRepo.update(ticketId, {
        status: 'confirmed', batchEndTime: new Date(), varianceExceeded: breaches.length > 0,
      });

      // Advance the queue.
      if (ticket.batchQueueId) {
        const queueRepo = m.getRepository(BatchQueueEntry);
        const queue = await queueRepo.findOne({ where: { id: ticket.batchQueueId } });
        if (queue) {
          const produced = num(queue.producedQuantityM3) + num(ticket.batchQuantityM3);
          const done = produced >= num(queue.plannedQuantityM3);
          await queueRepo.update(queue.id, {
            producedQuantityM3: String(produced),
            queueStatus: done ? 'completed' : 'batching',
          });
        }
      }

      return this.loadFull(m, ticketId);
    });
  }

  cancel(tenantId: string, ticketId: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(BatchTicket);
      const ticket = await repo.findOne({ where: { id: ticketId } });
      if (!ticket) throw notFound();
      if (ticket.status === 'confirmed') throw badReq('Confirmed ticket cannot be cancelled');
      await repo.update(ticketId, { status: 'cancelled' });
      if (ticket.batchQueueId) {
        await m.getRepository(BatchQueueEntry).update(ticket.batchQueueId, { queueStatus: 'waiting' });
      }
      return this.loadFull(m, ticketId);
    });
  }
}
