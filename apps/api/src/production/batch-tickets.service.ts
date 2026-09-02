import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { In, type EntityManager } from 'typeorm';
import { TenantDbService } from '../core/database/tenant-db.service';
import {
  BatchQueueEntry,
  BatchTicket,
  BatchTicketMaterial,
  ConcreteGrade,
  Material,
  MixDesign,
  MixDesignMaterial,
  User,
} from '../core/database/entities';
import { NumberingService } from '../sales/numbering.service';
import { StockService } from './stock.service';
import { applyMoistureCorrection, type MoistureInput } from './moisture-correction.util';

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
    // Resolve the batching operator to a name — the ticket stores only the UUID,
    // so nothing surfaced who ran the batch (accountability for the mix).
    const operator = ticket.operatorUserId
      ? await m.getRepository(User).findOne({ where: { id: ticket.operatorUserId } })
      : null;
    return { ...ticket, materials, operatorName: operator?.name ?? null };
  }

  get(tenantId: string, id: string) {
    return this.db.runInTenant(tenantId, (m) => this.loadFull(m, id));
  }

  /** Latest approved, active mix design for a grade (approved-mix validation). */
  private async resolveApprovedMix(
    m: EntityManager,
    gradeId: string | null,
    explicitId?: string | null,
    gradeLabel?: string | null,
  ) {
    const repo = m.getRepository(MixDesign);
    if (explicitId) {
      return repo.findOne({ where: { id: explicitId } });
    }
    // Resilience: a queue entry may carry a grade label but a null gradeId (e.g.
    // an older plan line). Resolve the grade by its code/name so batching still
    // finds the approved mix instead of dead-ending.
    let gid = gradeId;
    if (!gid && gradeLabel) {
      const grade = await m
        .getRepository(ConcreteGrade)
        .findOne({ where: [{ gradeCode: gradeLabel }, { gradeName: gradeLabel }] });
      gid = grade?.id ?? null;
    }
    if (!gid) return null;
    // A grade can carry several approved active mix designs (distinct mix codes).
    // Resolve deterministically — highest version, then most recently created —
    // so the current standard recipe wins instead of an arbitrary row.
    return repo.findOne({
      where: { gradeId: gid, approvalStatus: 'approved', isActiveVersion: true },
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
      // Cap the batch at the queued line's remaining quantity. Over-batching
      // flows challan → invoice → credit exposure, so a mis-key would bill and
      // expose more than the ordered value the credit gate was assessed against.
      if (batchQty > remaining + 0.001) {
        throw badReq(`Batch quantity ${batchQty} m³ exceeds the ${remaining} m³ remaining on this queued line.`);
      }

      const mix = await this.resolveApprovedMix(m, queue.gradeId, dto.mixDesignId as string, queue.gradeLabel);
      if (!mix) throw badReq('No approved mix design available for this grade');
      if (mix.approvalStatus !== 'approved') throw badReq('Selected mix design is not approved');
      // An explicitly-chosen mix must be for the queued grade — otherwise an M25
      // line could be batched with an M40 recipe while the ticket/QC/challan still
      // read "M25" (a silent wrong-recipe pour). The auto-resolve path already
      // filters by grade; this covers the explicit-id branch.
      if (dto.mixDesignId && queue.gradeId && mix.gradeId && mix.gradeId !== queue.gradeId) {
        throw badReq('The selected mix design is for a different grade than the queued line.');
      }

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

      // Snapshot scaled SSD targets, then correct aggregate weights + mix water
      // for moisture using each material's batching props. Actual defaults to the
      // corrected (moist) target until the operator edits.
      const matIds = [...new Set(mixMaterials.map((mm) => mm.materialId).filter((x): x is string => !!x))];
      const propRows = matIds.length ? await m.getRepository(Material).find({ where: { id: In(matIds) } }) : [];
      const props = new Map(propRows.map((p) => [p.id, p]));
      const inputs: MoistureInput[] = mixMaterials.map((mm) => {
        const p = mm.materialId ? props.get(mm.materialId) : undefined;
        return {
          materialType: p?.materialType ?? null,
          targetSsd: num(mm.targetQuantity) * batchQty,
          absorptionPct: num(p?.waterAbsorptionPct),
          moisturePct: num(p?.defaultMoisturePct),
        };
      });
      const { results } = applyMoistureCorrection(inputs);

      const matRepo = m.getRepository(BatchTicketMaterial);
      for (let i = 0; i < mixMaterials.length; i++) {
        const mm = mixMaterials[i]!;
        const inp = inputs[i]!;
        const res = results[i]!;
        await matRepo.save(
          matRepo.create({
            tenantId, batchTicketId: ticket.id, materialId: mm.materialId, materialLabel: mm.materialLabel,
            targetQuantity: String(inp.targetSsd), actualQuantity: String(res.correctedTarget),
            varianceQuantity: '0', variancePercentage: '0', uom: mm.uom,
            tolerancePercentage: mm.tolerancePercentage, withinTolerance: true,
            materialType: inp.materialType,
            waterAbsorptionPct: inp.absorptionPct ? String(inp.absorptionPct) : null,
            measuredMoisturePct: inp.moisturePct ? String(inp.moisturePct) : null,
            correctedTargetQuantity: String(res.correctedTarget),
            freeWaterQuantity: String(res.freeWater),
          }),
        );
      }

      await m.getRepository(BatchQueueEntry).update(queue.id, { queueStatus: 'batching', mixDesignId: mix.id });
      return this.loadFull(m, ticket.id);
    });
  }

  /**
   * Record actual consumed quantities and/or per-aggregate measured moisture
   * (draft only). Any moisture change re-corrects the whole batch (mix water
   * depends on every aggregate), and variance is scored against the corrected
   * target. A row whose moisture changed but whose actual was not supplied is
   * re-seeded to its new corrected target.
   */
  updateActuals(tenantId: string, ticketId: string, dto: Record<string, unknown>) {
    return this.db.runInTenant(tenantId, async (m) => {
      const ticket = await m.getRepository(BatchTicket).findOne({ where: { id: ticketId } });
      if (!ticket) throw notFound();
      if (ticket.status !== 'draft') throw badReq('Only a draft ticket can be edited');
      const repo = m.getRepository(BatchTicketMaterial);
      const mats = await repo.find({ where: { batchTicketId: ticketId }, order: { createdAt: 'ASC' } });

      const rows = Array.isArray(dto.materials) ? (dto.materials as Record<string, unknown>[]) : [];
      const byId = new Map(rows.map((r) => [String(r.id ?? ''), r]));
      const has = (v: unknown): boolean => v !== undefined && v !== null && v !== '';

      const inputs: MoistureInput[] = mats.map((mat) => {
        const r = byId.get(mat.id);
        const moisture = r && has(r.measuredMoisturePct) ? num(r.measuredMoisturePct) : num(mat.measuredMoisturePct);
        return {
          materialType: mat.materialType,
          targetSsd: num(mat.targetQuantity),
          absorptionPct: num(mat.waterAbsorptionPct),
          moisturePct: moisture,
        };
      });
      const { results } = applyMoistureCorrection(inputs);

      for (let i = 0; i < mats.length; i++) {
        const mat = mats[i]!;
        const inp = inputs[i]!;
        const res = results[i]!;
        const r = byId.get(mat.id);
        const moistureChanged = r ? has(r.measuredMoisturePct) : false;
        const actual = r && has(r.actualQuantity)
          ? num(r.actualQuantity)
          : moistureChanged
            ? res.correctedTarget
            : num(mat.actualQuantity);
        const v = this.variance(res.correctedTarget, actual, num(mat.tolerancePercentage));
        await repo.update(mat.id, {
          measuredMoisturePct: inp.moisturePct ? String(inp.moisturePct) : null,
          correctedTargetQuantity: String(res.correctedTarget),
          freeWaterQuantity: String(res.freeWater),
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
      // Lock the ticket: two concurrent confirms would otherwise both read
      // status='draft', both consume stock, and both flip to confirmed —
      // double-consuming inventory (and both passing the stock-availability gate).
      const ticket = await ticketRepo.findOne({ where: { id: ticketId }, lock: { mode: 'pessimistic_write' } });
      if (!ticket) throw notFound();
      if (ticket.status !== 'draft') throw badReq(`Ticket already ${ticket.status}`);

      const matRepo = m.getRepository(BatchTicketMaterial);
      const materials = await matRepo.find({ where: { batchTicketId: ticketId } });
      if (!materials.length) throw badReq('Batch ticket has no materials');

      // Recompute variance against tolerance.
      const breaches: Array<{ material: string; variancePercentage: number; tolerance: number }> = [];
      for (const mat of materials) {
        const basis = num(mat.correctedTargetQuantity ?? mat.targetQuantity);
        const v = this.variance(basis, num(mat.actualQuantity), num(mat.tolerancePercentage));
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

      // Stock-availability gate (mirrors the manual-adjustment control): batching
      // must not silently drive raw-material stock negative — the manual path
      // requires approval for that, and this is the far more common consumption.
      // Pre-check each material at the ticket's plant; block a shortfall unless
      // the operator overrides (physical stock present but not yet booked).
      if (dto.allowNegativeStock !== true) {
        const plantId = await this.stock.resolvePlant(m, ticket.plantId);
        const required = new Map<string, number>();
        for (const mat of materials) {
          const actual = num(mat.actualQuantity);
          if (!mat.materialId || actual <= 0) continue;
          required.set(mat.materialId, (required.get(mat.materialId) ?? 0) + actual);
        }
        const shortfalls: Array<{ material: string; available: number; required: number }> = [];
        for (const [materialId, need] of required) {
          const available = await this.stock.balanceOf(m, plantId, materialId);
          if (available - need < -0.0005) {
            const label = materials.find((x) => x.materialId === materialId)?.materialLabel ?? materialId;
            shortfalls.push({ material: label, available, required: need });
          }
        }
        if (shortfalls.length) {
          throw badReq('Insufficient stock to batch this ticket. Adjust stock first, or override to allow negative stock.', shortfalls);
        }
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
