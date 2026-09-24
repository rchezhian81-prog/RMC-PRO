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
import { listLimit } from '../common/list-limit.util';

const notFound = () => new NotFoundException({ code: 'RECORD_NOT_FOUND', message: 'Batch ticket not found' });
const badReq = (message: string, extra?: unknown) =>
  new BadRequestException({ code: 'VALIDATION_ERROR', message, ...(extra ? { details: extra } : {}) });
const num = (v: unknown): number => Number(v ?? 0) || 0;
const round3 = (v: number): number => Math.round(v * 1000) / 1000;

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

  /**
   * The ticket list with what a plant manager reads it by: the order and
   * customer behind each batch, who ran it, and how accurate it was (how many
   * materials were weighed, how many missed their tolerance, the worst miss).
   * Three batched lookups for the whole page.
   */
  list(tenantId: string, status?: string, limit?: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const rows = await m.getRepository(BatchTicket).find({
        where: status ? { status } : {},
        order: { createdAt: 'DESC' },
        take: listLimit(limit),
      });
      const ids = (pick: (r: BatchTicket) => string | null) => [...new Set(rows.map(pick).filter((v): v is string => !!v))];
      const orderIds = ids((r) => r.orderId);
      const userIds = ids((r) => r.operatorUserId);
      const ticketIds = rows.map((r) => r.id);
      const orders: Array<{ id: string; orderNo: string; customerName: string | null }> = orderIds.length
        ? await m.query(
            `SELECT o.id, o.order_no AS "orderNo", c.customer_name AS "customerName"
               FROM orders o LEFT JOIN customers c ON c.id = o.customer_id
              WHERE o.id = ANY($1)`,
            [orderIds],
          )
        : [];
      const users: Array<{ id: string; name: string }> = userIds.length
        ? await m.query(`SELECT id, name FROM users WHERE id = ANY($1)`, [userIds])
        : [];
      const stats: Array<{ batchTicketId: string; materials: number; weighed: number; breaches: number; worstPct: number }> = ticketIds.length
        ? await m.query(
            `SELECT batch_ticket_id AS "batchTicketId",
                    COUNT(*)::int AS "materials",
                    COUNT(*) FILTER (WHERE actual_quantity > 0)::int AS "weighed",
                    COUNT(*) FILTER (WHERE NOT within_tolerance)::int AS "breaches",
                    COALESCE(MAX(ABS(variance_percentage)) FILTER (WHERE actual_quantity > 0), 0)::float AS "worstPct"
               FROM batch_ticket_materials WHERE batch_ticket_id = ANY($1) GROUP BY batch_ticket_id`,
            [ticketIds],
          )
        : [];
      const order = new Map(orders.map((o) => [o.id, o]));
      const userName = new Map(users.map((u) => [u.id, u.name]));
      const stat = new Map(stats.map((s) => [s.batchTicketId, s]));
      return rows.map((r) => {
        const o = r.orderId ? order.get(r.orderId) : undefined;
        const s = stat.get(r.id);
        return {
          ...r,
          orderNo: o?.orderNo ?? null,
          customerName: o?.customerName ?? null,
          operatorName: r.operatorUserId ? userName.get(r.operatorUserId) ?? null : null,
          materials: s?.materials ?? 0,
          weighed: s?.weighed ?? 0,
          breaches: s?.breaches ?? 0,
          worstPct: s?.worstPct ?? 0,
        };
      });
    });
  }

  /**
   * One ticket with everything the batching screen reads around it: the
   * order, customer and site it was mixed for and the queue line it came off
   * (planned against produced), the recipe (mix code and version, w/c ratio,
   * slump range, cement), who ran it and on which plant, the controller the
   * actuals came from, the stock balance each material was left at once the
   * batch was confirmed, and what happened to the concrete afterwards: the
   * dispatches and challans that carried it and the QC tests taken from it.
   */
  private async loadFull(m: EntityManager, id: string) {
    const ticket = await m.getRepository(BatchTicket).findOne({ where: { id } });
    if (!ticket) throw notFound();
    const rawMaterials = await m
      .getRepository(BatchTicketMaterial)
      .find({ where: { batchTicketId: id }, order: { createdAt: 'ASC' } });
    // Resolve the batching operator to a name — the ticket stores only the UUID,
    // so nothing surfaced who ran the batch (accountability for the mix).
    const operator = ticket.operatorUserId
      ? await m.getRepository(User).findOne({ where: { id: ticket.operatorUserId } })
      : null;
    const one = async <T,>(sql: string, params: unknown[]): Promise<T | null> => {
      const rows: T[] = await m.query(sql, params);
      return rows[0] ?? null;
    };
    const [order, plant, mix, queue, controller, dispatches, challans, qc, stock] = await Promise.all([
      ticket.orderId
        ? one<{ orderNo: string; customerId: string | null; customerName: string | null; siteName: string | null }>(
            `SELECT o.order_no AS "orderNo", o.customer_id AS "customerId", c.customer_name AS "customerName", s.site_name AS "siteName"
               FROM orders o LEFT JOIN customers c ON c.id = o.customer_id LEFT JOIN sites s ON s.id = o.site_id
              WHERE o.id = $1`,
            [ticket.orderId],
          )
        : null,
      ticket.plantId ? one<{ plantName: string }>(`SELECT plant_name AS "plantName" FROM plants WHERE id = $1`, [ticket.plantId]) : null,
      ticket.mixDesignId
        ? one<{ mixCode: string; mixVersion: number; waterCementRatio: string | null; slumpMin: number | null; slumpMax: number | null; cementType: string | null; pumpable: boolean }>(
            `SELECT mix_code AS "mixCode", version_no AS "mixVersion", water_cement_ratio AS "waterCementRatio", slump_min AS "slumpMin",
                    slump_max AS "slumpMax", cement_type AS "cementType", pumpable FROM mix_designs WHERE id = $1`,
            [ticket.mixDesignId],
          )
        : null,
      ticket.batchQueueId
        ? one<{ queuePlannedM3: string; queueProducedM3: string; queueStatus: string }>(
            `SELECT planned_quantity_m3 AS "queuePlannedM3", produced_quantity_m3 AS "queueProducedM3", queue_status AS "queueStatus"
               FROM batch_queue WHERE id = $1`,
            [ticket.batchQueueId],
          )
        : null,
      ticket.controllerId ? one<{ controllerName: string }>(`SELECT name AS "controllerName" FROM batching_controllers WHERE id = $1`, [ticket.controllerId]) : null,
      m.query(
        `SELECT d.id, d.dispatch_no AS "dispatchNo", d.dispatch_status AS "dispatchStatus", d.quantity_m3 AS "quantityM3",
                d.dispatch_time AS "dispatchTime", v.vehicle_no AS "vehicleNo"
           FROM dispatches d LEFT JOIN vehicles v ON v.id = d.vehicle_id
          WHERE d.batch_ticket_id = $1 ORDER BY d.created_at ASC`,
        [id],
      ) as Promise<Array<{ id: string; dispatchNo: string; dispatchStatus: string; quantityM3: string; dispatchTime: Date | null; vehicleNo: string | null }>>,
      m.query(
        `SELECT id, challan_no AS "challanNo", challan_status AS "challanStatus", quantity_m3 AS "quantityM3"
           FROM delivery_challans WHERE batch_ticket_id = $1 ORDER BY created_at ASC`,
        [id],
      ) as Promise<Array<{ id: string; challanNo: string; challanStatus: string; quantityM3: string }>>,
      one<{ slumpTests: number; slumpFailed: number; cubeSets: number; cubesRejected: number }>(
        `SELECT (SELECT COUNT(*)::int FROM qc_slump_tests WHERE batch_ticket_id = $1) AS "slumpTests",
                (SELECT COUNT(*)::int FROM qc_slump_tests WHERE batch_ticket_id = $1 AND NOT passed) AS "slumpFailed",
                (SELECT COUNT(*)::int FROM qc_cube_sets WHERE batch_ticket_id = $1) AS "cubeSets",
                (SELECT COUNT(*)::int FROM qc_cube_sets WHERE batch_ticket_id = $1 AND acceptance_status = 'rejected') AS "cubesRejected"`,
        [id],
      ),
      m.query(
        `SELECT material_id AS "materialId", balance_after AS "balanceAfter"
           FROM stock_transactions WHERE reference_type = 'batch_ticket' AND reference_id = $1`,
        [id],
      ) as Promise<Array<{ materialId: string; balanceAfter: string }>>,
    ]);
    const balanceAfter = new Map(stock.map((s) => [s.materialId, s.balanceAfter]));
    const materials = rawMaterials.map((mat) => ({
      ...mat,
      balanceAfter: mat.materialId ? balanceAfter.get(mat.materialId) ?? null : null,
    }));
    return {
      ...ticket,
      materials,
      operatorName: operator?.name ?? null,
      orderNo: order?.orderNo ?? null,
      customerId: order?.customerId ?? null,
      customerName: order?.customerName ?? null,
      siteName: order?.siteName ?? null,
      plantName: plant?.plantName ?? null,
      mixCode: mix?.mixCode ?? null,
      mixVersion: mix?.mixVersion ?? null,
      waterCementRatio: mix?.waterCementRatio ?? null,
      slumpMin: mix?.slumpMin ?? null,
      slumpMax: mix?.slumpMax ?? null,
      cementType: mix?.cementType ?? null,
      pumpable: mix?.pumpable ?? null,
      queuePlannedM3: queue?.queuePlannedM3 ?? null,
      queueProducedM3: queue?.queueProducedM3 ?? null,
      queueStatus: queue?.queueStatus ?? null,
      controllerName: controller?.controllerName ?? null,
      dispatches,
      challans,
      slumpTests: qc?.slumpTests ?? 0,
      slumpFailed: qc?.slumpFailed ?? 0,
      cubeSets: qc?.cubeSets ?? 0,
      cubesRejected: qc?.cubesRejected ?? 0,
    };
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
      if (queue.orderId) {
        const [o] = await m.query(`SELECT order_status FROM orders WHERE id = $1`, [queue.orderId]);
        if (o?.order_status === 'cancelled') throw badReq('The order behind this queue line is cancelled — nothing to batch');
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

      // A negative actual would, on an override confirm, consume negative
      // material — a phantom stock increase. Moisture drives the free-water
      // correction, so a value outside 0–100% corrupts the whole batch's water.
      for (const r of rows) {
        if (has(r.actualQuantity) && num(r.actualQuantity) < 0) throw badReq('Actual quantity cannot be negative.');
        if (has(r.measuredMoisturePct)) {
          const mp = num(r.measuredMoisturePct);
          if (mp < 0 || mp > 100) throw badReq('Measured moisture % must be between 0 and 100.');
        }
      }

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

      // Re-apply the queue cap under lock. createFromQueue checks remaining =
      // planned − produced when a ticket is DRAFTED, but two drafts against the
      // same remaining both pass and both confirm, taking the line past planned —
      // over-production against the plan/order. Lock the queue row (ticket →
      // queue → stock balances, the only order any path takes) so confirms on a
      // line serialize, and refuse if this ticket would overshoot. The locked
      // row is reused to advance the queue below.
      const queueRepo = m.getRepository(BatchQueueEntry);
      const queue = ticket.batchQueueId
        ? await queueRepo.findOne({ where: { id: ticket.batchQueueId }, lock: { mode: 'pessimistic_write' } })
        : null;
      if (queue) {
        const planned = num(queue.plannedQuantityM3);
        const produced = num(queue.producedQuantityM3);
        const qty = num(ticket.batchQuantityM3);
        if (planned > 0 && produced + qty > planned + 0.001) {
          throw badReq(
            `Confirming ${qty} m³ would take this queue line to ${round3(produced + qty)} m³ against ${planned} m³ planned (${round3(Math.max(planned - produced, 0))} m³ remaining).`,
          );
        }
      }

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
        // Lock each material's balance (stable, sorted order → no deadlock between
        // two confirms) so the availability check and the consumption below are
        // serialized against a concurrent confirm consuming the same raw material.
        // Without this, two different tickets each pass the gate against the same
        // reading and together drive stock negative past the approval it requires.
        for (const materialId of [...required.keys()].sort()) {
          await this.stock.lockBalance(m, plantId, materialId);
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

      // Advance the queue (row locked above).
      if (queue) {
        const produced = num(queue.producedQuantityM3) + num(ticket.batchQuantityM3);
        const done = produced >= num(queue.plannedQuantityM3);
        await queueRepo.update(queue.id, {
          producedQuantityM3: String(produced),
          queueStatus: done ? 'completed' : 'batching',
        });
      }

      return this.loadFull(m, ticketId);
    });
  }

  cancel(tenantId: string, ticketId: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(BatchTicket);
      const ticket = await repo.findOne({ where: { id: ticketId }, lock: { mode: 'pessimistic_write' } });
      if (!ticket) throw notFound();
      if (ticket.status !== 'draft') throw badReq(`Only a draft ticket can be cancelled — this one is ${ticket.status}`);
      await repo.update(ticketId, { status: 'cancelled' });
      // Recompute the queue line instead of hard-resetting it to 'waiting':
      // cancelling one draft must not un-complete a line that confirmed tickets
      // already finished (the batcher would re-plan concrete already produced).
      // A terminal line is left alone; otherwise it stays 'batching' while it
      // has produced volume or other live tickets, and falls back to 'waiting'
      // only when nothing is left on it.
      if (ticket.batchQueueId) {
        const queueRepo = m.getRepository(BatchQueueEntry);
        const queue = await queueRepo.findOne({ where: { id: ticket.batchQueueId }, lock: { mode: 'pessimistic_write' } });
        if (queue && !['completed', 'cancelled'].includes(queue.queueStatus)) {
          const [live] = await m.query(
            `SELECT count(*)::int AS n FROM batch_tickets WHERE batch_queue_id = $1 AND status IN ('draft', 'confirmed') AND id <> $2`,
            [queue.id, ticketId],
          );
          const active = num(queue.producedQuantityM3) > 0 || num(live?.n) > 0;
          await queueRepo.update(queue.id, { queueStatus: active ? 'batching' : 'waiting' });
        }
      }
      return this.loadFull(m, ticketId);
    });
  }
}
