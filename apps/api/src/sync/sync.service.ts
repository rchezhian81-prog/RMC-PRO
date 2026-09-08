import { BadRequestException, HttpException, Injectable, NotFoundException } from '@nestjs/common';
import type { EntityManager, ObjectLiteral, Repository, SelectQueryBuilder } from 'typeorm';
import { TenantDbService } from '../core/database/tenant-db.service';
import { In } from 'typeorm';
import {
  BatchTicket,
  BatchTicketMaterial,
  ConcreteGrade,
  Customer,
  DeliveryChallan,
  Device,
  LocalNumberReservation,
  Material,
  MixDesign,
  MixDesignMaterial,
  Order,
  OrderItem,
  Plant,
  Site,
  StockBalance,
  SyncConflict,
} from '../core/database/entities';
import { resolveOptionalRef } from '../common/resolve-ref';
import { NumberingService } from '../sales/numbering.service';
import { StockService } from '../production/stock.service';
import { applyMoistureCorrection, type MoistureInput } from '../production/moisture-correction.util';
import {
  assertDispatchLive,
  assertNotInvoiced,
  canTransition,
  deliverChallan,
  isChallanStatus,
  type ChallanStatus,
} from '../dispatch/challan-transition.util';
import { recordDeliveryHistory } from '../dispatch/delivery-history.util';

const notFound = (msg = 'Not found') => new NotFoundException({ code: 'RECORD_NOT_FOUND', message: msg });
const badReq = (message: string) => new BadRequestException({ code: 'VALIDATION_ERROR', message });
const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null);

/**
 * Rows delivered per entity per pull page. Kept small in tests
 * (`SYNC_PULL_LIMIT`) so pagination is exercised without seeding thousands of
 * rows. When a page is full the response sets `hasMore`, and the device keeps
 * pulling until it is drained.
 */
const PULL_LIMIT = Math.max(1, Number(process.env.SYNC_PULL_LIMIT ?? 500));

/** The entities a device pulls, in the response order. */
const PULL_ENTITIES = ['orders', 'customers', 'deliveryChallans', 'stockBalances'] as const;

/**
 * Records accepted in one push. The whole batch runs in ONE transaction (one
 * savepoint per record inside it), so an unbounded batch from a device that
 * was offline for a week held a write transaction open for as long as it took
 * to apply every document — blocking the numbering locks the online plant
 * needs — on a request body of unbounded size. The plant app sends 100 at a
 * time; this refuses anything materially larger with an actionable message.
 */
const PUSH_LIMIT = Math.max(1, Number(process.env.SYNC_PUSH_LIMIT ?? 200));
type PullEntity = (typeof PULL_ENTITIES)[number];

/**
 * A keyset position: the last (updated_at, id) delivered for one entity. Using
 * the id as a tiebreaker on top of updated_at makes the cursor a TOTAL order, so
 * rows that share a millisecond can never be skipped or infinitely re-sent — the
 * failure mode a plain "updated_at > since" cursor has when many rows are
 * updated in one statement.
 */
interface KeysetCursor {
  ts: string;
  id: string;
}
const ZERO_CURSOR: KeysetCursor = { ts: new Date(0).toISOString(), id: '00000000-0000-0000-0000-000000000000' };
type PullCursors = Record<PullEntity, KeysetCursor>;

const allEntities = (c: KeysetCursor): PullCursors =>
  PULL_ENTITIES.reduce((acc, k) => ((acc[k] = c), acc), {} as PullCursors);

/**
 * Decode the incoming `since` token. Accepts a v2 opaque token (base64 JSON of
 * per-entity cursors), a legacy ISO timestamp (older clients and the bootstrap
 * token), or nothing (first sync). A legacy timestamp starts every entity just
 * before that instant with the zero id, so rows AT that instant are re-included
 * — safe, because the device upserts by id.
 */
function decodeSince(since: string | undefined): PullCursors {
  if (!since) return allEntities(ZERO_CURSOR);
  try {
    const obj = JSON.parse(Buffer.from(since, 'base64').toString('utf8')) as {
      v?: number;
      c?: Partial<Record<PullEntity, KeysetCursor>>;
    };
    if (obj?.v === 2 && obj.c) {
      return PULL_ENTITIES.reduce((acc, k) => ((acc[k] = obj.c?.[k] ?? ZERO_CURSOR), acc), {} as PullCursors);
    }
  } catch {
    /* not a v2 token — fall through to the legacy timestamp path */
  }
  const ts = new Date(since);
  return allEntities(Number.isNaN(ts.getTime()) ? ZERO_CURSOR : { ts: ts.toISOString(), id: ZERO_CURSOR.id });
}

const encodeCursors = (c: PullCursors): string =>
  Buffer.from(JSON.stringify({ v: 2, c }), 'utf8').toString('base64');

export interface PushRecord {
  entityName: string;
  localId: string;
  operation: 'create' | 'update';
  payload: Record<string, unknown>;
  cloudId?: string;
  baseUpdatedAt?: string;
}
export interface PushResult {
  localId: string;
  status: 'applied' | 'conflict';
  cloudId?: string;
  conflictId?: string;
  reason?: string;
}

/**
 * A push element the server can process without crashing: a real object that
 * names its entity and carries a local id. entityName is required because it is
 * written NOT NULL onto any conflict row; the rest is coerced defensively by
 * applyPush. Anything else is reported as a per-record malformed outcome.
 */
/**
 * Is the pushed payload the SAME document as the existing row, on the identity
 * fields present in the payload? Absent fields are not compared (a retry may
 * carry a subset), numerics compare by value ("6.000" == 6), blanks as null.
 * Lifecycle fields (status, receiver) are deliberately not identity.
 */
function sameDocument(existing: Record<string, unknown>, p: Record<string, unknown>, fields: string[]): boolean {
  const norm = (v: unknown): string | null => {
    if (v === undefined || v === null || v === '') return null;
    if (typeof v === 'number') return String(v);
    const s = String(v).trim();
    return /^-?\d+(\.\d+)?$/.test(s) ? String(Number(s)) : s;
  };
  return fields.every((f) => p[f] === undefined || norm(p[f]) === norm(existing[f]));
}

function isValidPushRecord(r: unknown): r is PushRecord {
  if (!r || typeof r !== 'object') return false;
  const o = r as Record<string, unknown>;
  return typeof o.entityName === 'string' && o.entityName.trim() !== '' && typeof o.localId === 'string';
}

/**
 * Offline sync (DEV-PLAN B14, Doc 8). Device registration, bootstrap snapshot,
 * cloud-issued number reservations, push (offline creates + optimistic-
 * concurrency conflict detection), pull (cloud changes since a token), and
 * conflict resolution. The plant app holds the local sync_queue in SQLite.
 */
@Injectable()
export class SyncService {
  constructor(
    private readonly db: TenantDbService,
    private readonly numbering: NumberingService,
    private readonly stock: StockService,
  ) {}

  // ---- Devices ----------------------------------------------------------
  registerDevice(tenantId: string, dto: Record<string, unknown>, userId: string) {
    const identifier = String(dto.deviceIdentifier ?? '').trim();
    const name = String(dto.deviceName ?? '').trim();
    if (!identifier || !name) throw badReq('deviceIdentifier and deviceName are required');
    return this.db.runInTenant(tenantId, async (m) => {
      // The device's plant is stamped on every challan it pushes, so it must
      // resolve inside the tenant: FK checks bypass RLS, and another tenant's
      // plant id would have been accepted and then written onto real documents.
      await resolveOptionalRef(m, Plant, dto.plantId, 'Plant');
      const repo = m.getRepository(Device);
      const existing = await repo.findOne({ where: { deviceIdentifier: identifier } });
      if (existing) {
        // Re-registering must not un-revoke: a deactivated device could
        // otherwise walk straight back in by registering its identifier again,
        // which is exactly what an operator revokes it to prevent. Reactivation
        // is a deliberate administrative action.
        if (existing.status !== 'active') {
          throw badReq(`Device ${existing.deviceName} is ${existing.status}. Reactivate it from Devices & Sync before registering again.`);
        }
        await repo.update(existing.id, { deviceName: name, lastSeenAt: new Date() });
        return repo.findOne({ where: { id: existing.id } });
      }
      return repo.save(
        repo.create({
          tenantId, deviceIdentifier: identifier, deviceName: name,
          deviceType: (dto.deviceType as string) ?? 'standalone_plant_app',
          plantId: (dto.plantId as string) ?? null, registeredBy: userId,
          lastSeenAt: new Date(), status: 'active',
        }),
      );
    });
  }

  listDevices(tenantId: string) {
    return this.db.runInTenant(tenantId, (m) => m.getRepository(Device).find({ order: { createdAt: 'DESC' } }));
  }

  /** Revoke (or restore) a device. Its documents and number blocks are kept. */
  setDeviceStatus(tenantId: string, id: string, status: 'active' | 'inactive') {
    return this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(Device);
      const device = await repo.findOne({ where: { id } });
      if (!device) throw notFound('Device not found');
      await repo.update(id, { status });
      return repo.findOne({ where: { id } });
    });
  }

  /**
   * Every device-plane call resolves its device HERE. `status` was written at
   * registration and never read again, so a lost or decommissioned tablet kept
   * bootstrapping the whole master data and pushing documents for as long as its
   * token lived — there was no way to revoke it at all. (pull did not even look
   * the device up: an unknown id quietly "succeeded" and updated nothing.)
   */
  private async activeDevice(m: EntityManager, deviceId: string): Promise<Device> {
    const device = await m.getRepository(Device).findOne({ where: { id: deviceId } });
    if (!device) throw notFound('Device not found');
    if (device.status !== 'active') {
      throw badReq(`Device ${device.deviceName} is ${device.status} — reactivate it before syncing`);
    }
    return device;
  }

  // ---- Bootstrap --------------------------------------------------------
  bootstrap(tenantId: string, deviceId: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const device = await this.activeDevice(m, deviceId);
      const token = new Date();
      await m.getRepository(Device).update(deviceId, { lastSeenAt: token, lastSyncToken: token });
      // Snapshot ALL customers and confirmed orders — no row cap. The token below
      // is the bootstrap instant, so the follow-up pull delivers only changes AFTER
      // it; a 500-row cap therefore permanently lost the customers/orders beyond it
      // (their updated_at < token, so the keyset pull skipped them too) on any
      // tenant with >500 of either. The other reference tables were already returned
      // in full — these now match. Ordered for a deterministic response.
      //
      // Scoped to the device's own plant (see plantScope). A tablet at one plant
      // used to receive the WHOLE tenant: every customer, every confirmed order
      // and, on pull, every challan and stock balance of every other plant. One
      // lost tablet handed over the group's entire order book. A device with no
      // plant recorded keeps the tenant-wide view, so nothing in flight breaks.
      const plantId = device.plantId;
      const orderWhere = plantId
        ? 'o.order_status = $1 AND (o.plant_id = $2 OR o.plant_id IS NULL)'
        : 'o.order_status = $1';
      const orderParams = plantId ? ['confirmed', plantId] : ['confirmed'];
      const [customers, orders, grades, materials, mixDesigns, plants] = await Promise.all([
        // The customers this plant can actually deliver to: the ones on the
        // orders above. Without a plant the whole master is returned, as before.
        plantId
          ? m.query(
              `SELECT c.* FROM customers c WHERE EXISTS (
                 SELECT 1 FROM orders o WHERE o.customer_id = c.id AND ${orderWhere}
               ) ORDER BY c.created_at ASC`,
              orderParams,
            )
          : m.getRepository(Customer).find({ order: { createdAt: 'ASC' } }),
        m.query(`SELECT o.* FROM orders o WHERE ${orderWhere} ORDER BY o.created_at ASC`, orderParams),
        m.query(`SELECT * FROM concrete_grades ORDER BY grade_code`),
        m.query(`SELECT * FROM materials ORDER BY material_code`),
        m.query(`SELECT * FROM mix_designs WHERE approval_status = 'approved'`),
        m.query(`SELECT * FROM plants ORDER BY plant_code`),
      ]);
      return {
        // Token is the bootstrap instant; the device stores it and the follow-up
        // pull delivers only what changed AFTER it, and it is correct because the
        // snapshot above is complete. (The plant app no longer reads this as a
        // clock — pull replaces it with the opaque keyset cursor.)
        syncToken: token.toISOString(),
        reference: { customers, orders, grades, materials, mixDesigns, plants },
        counts: {
          customers: customers.length, orders: orders.length, grades: grades.length,
          materials: materials.length, mixDesigns: mixDesigns.length, plants: plants.length,
        },
      };
    });
  }

  // ---- Number reservations ---------------------------------------------
  /**
   * Reserve a contiguous block of document numbers (Plan F2). A `deviceId`
   * reserves for an offline device (the original path); omitting it is an online
   * reservation. An explicit `plantId` draws from that plant's series, otherwise
   * the tenant-wide series (unchanged for offline devices). The allocation +
   * FY roll-over run through the shared NumberingService.
   */
  reserveNumbers(tenantId: string, dto: Record<string, unknown>) {
    const deviceId = dto.deviceId ? String(dto.deviceId) : null;
    const documentType = String(dto.documentType ?? '');
    const count = Math.max(1, Math.min(1000, Number(dto.count ?? 0) || 0));
    const requestedPlantId = (dto.plantId as string) || null;
    if (!documentType) throw badReq('documentType is required');
    return this.db.runInTenant(tenantId, async (m) => {
      let reservationPlantId = requestedPlantId;
      if (deviceId) {
        const device = await this.activeDevice(m, deviceId);
        if (!reservationPlantId) reservationPlantId = device.plantId;
      }

      // Series scoping uses an EXPLICIT plantId only — an offline device without
      // one keeps drawing from the tenant-wide series, exactly as before.
      const block = await this.numbering.reserve(m, tenantId, documentType, count, { plantId: requestedPlantId });

      const repo = m.getRepository(LocalNumberReservation);
      const reservation = await repo.save(
        repo.create({
          tenantId, deviceId, plantId: reservationPlantId, documentType,
          prefix: block.prefix, paddingLength: block.paddingLength,
          numberFrom: block.numberFrom, numberTo: block.numberTo, usedCount: 0, status: 'active',
        }),
      );
      return {
        ...reservation,
        // The suffix (which carries the FY token after a roll-over) is part of
        // the number: the device must format prefix + padded number + suffix
        // exactly as the server would, or its challans collide with last FY's.
        suffix: block.suffix,
        financialYear: block.financialYear,
        sampleFrom: block.numbers[0],
        sampleTo: block.numbers[block.numbers.length - 1],
      };
    });
  }

  listReservations(tenantId: string, deviceId?: string) {
    return this.db.runInTenant(tenantId, (m) =>
      m.getRepository(LocalNumberReservation).find({ where: deviceId ? { deviceId } : {}, order: { createdAt: 'DESC' } }),
    );
  }

  // ---- Push (offline → cloud) ------------------------------------------
  push(tenantId: string, deviceId: string, records: PushRecord[], userId: string | null = null) {
    if (!Array.isArray(records)) throw badReq('records[] required');
    if (records.length > PUSH_LIMIT) {
      throw badReq(`Too many records in one push (${records.length}); send at most ${PUSH_LIMIT} per batch.`);
    }
    return this.db.runInTenant(tenantId, async (m) => {
      const device = await this.activeDevice(m, deviceId);
      const results: PushResult[] = [];
      for (const r of records) {
        // A malformed element (null, a non-object, or one missing entityName /
        // localId) would otherwise null-deref or push a null entity_name into
        // sync_conflicts — a 500 that fails the whole batch. Report it as a
        // per-record outcome so one bad row can't take down a device's sync.
        if (!isValidPushRecord(r)) {
          const localId = r && typeof r === 'object' && typeof (r as { localId?: unknown }).localId === 'string'
            ? (r as { localId: string }).localId
            : '';
          results.push({ localId, status: 'conflict', reason: 'malformed_record' });
          continue;
        }
        // Isolate each record in a savepoint. Without it one poisoned record
        // (a malformed uuid, a duplicate, an FK miss) aborted the WHOLE batch
        // with a 500, and the device retried the identical batch forever. Now
        // just that record rolls back and is reported as a conflict; the rest of
        // the batch — and the device's queue — keeps moving.
        await m.query('SAVEPOINT sync_record');
        try {
          results.push(await this.applyPush(m, tenantId, device, r, userId));
          await m.query('RELEASE SAVEPOINT sync_record');
        } catch (e) {
          await m.query('ROLLBACK TO SAVEPOINT sync_record');
          const code = (e as { code?: string })?.code;
          const detail = e instanceof HttpException
            ? ((e.getResponse() as { message?: string })?.message ?? e.message)
            : (code ?? (e as Error)?.message ?? 'error');
          results.push(await this.recordConflict(m, tenantId, device, r, null, `apply_failed: ${detail}`.slice(0, 200)));
        }
      }
      await m.getRepository(Device).update(deviceId, { lastSeenAt: new Date() });
      return { results, applied: results.filter((x) => x.status === 'applied').length, conflicts: results.filter((x) => x.status === 'conflict').length };
    });
  }

  /**
   * The grade id behind a device's grade LABEL — from the order's own lines
   * first (that is the line the invoice will bill), else the grade master by
   * code or name. Null when nothing matches; the label is still stored.
   */
  private async resolveGradeId(m: EntityManager, order: Order | null, gradeLabel: string | null): Promise<string | null> {
    if (!gradeLabel) return order ? null : null;
    if (order) {
      const items = await m.getRepository(OrderItem).find({ where: { orderId: order.id } });
      const line = items.find((i) => i.gradeLabel === gradeLabel);
      if (line?.gradeId) return line.gradeId;
    }
    const grade = await m
      .getRepository(ConcreteGrade)
      .findOne({ where: [{ gradeCode: gradeLabel }, { gradeName: gradeLabel }] });
    return grade?.id ?? null;
  }

  /**
   * The recipe an offline batch was made to: the current approved, active mix
   * for the grade behind the label. Deterministic (highest version, then most
   * recent), the same selection the online batching screen makes.
   */
  private async resolveApprovedMix(m: EntityManager, gradeLabel: string | null): Promise<MixDesign | null> {
    const gradeId = await this.resolveGradeId(m, null, gradeLabel);
    if (!gradeId) return null;
    return m.getRepository(MixDesign).findOne({
      where: { gradeId, approvalStatus: 'approved', isActiveVersion: true },
      order: { versionNo: 'DESC', createdAt: 'DESC' },
    });
  }

  /**
   * Draw an offline batch's raw material out of stock, mirroring what the
   * online confirm does: explode the approved mix by the batched volume, apply
   * each material's moisture correction, write the ticket's material lines and
   * post one ledger movement per material.
   *
   * Two deliberate differences from the online path, both because the concrete
   * ALREADY EXISTS by the time this arrives:
   *  - no availability gate. Online, a shortfall blocks the confirm so the
   *    operator can adjust stock first; here refusing would only discard a real
   *    production record. The balance is allowed to go negative, which is the
   *    honest signal that the book and the silo disagree.
   *  - the recipe is the cloud's current approved mix, not whatever the device
   *    held. The device sends no material lines, and the theoretical draw is a
   *    far better estimate than the zero we recorded before.
   *
   * Returns a note to stamp on the ticket when it could NOT be costed, so the
   * gap is visible on the ticket instead of silently absent.
   */
  private async consumeForOfflineBatch(
    m: EntityManager,
    tenantId: string,
    ticket: BatchTicket,
    mix: MixDesign | null,
    batchQty: number,
    userId: string | null,
  ): Promise<string | null> {
    if (!(batchQty > 0)) return 'Pushed from a plant device with no batch quantity — no stock was consumed.';
    if (!mix) {
      return `Pushed from a plant device, but no approved mix design was found for ${ticket.gradeLabel ?? 'this grade'} — no stock was consumed. Approve a mix and adjust stock manually.`;
    }
    const mixMaterials = await m
      .getRepository(MixDesignMaterial)
      .find({ where: { mixDesignId: mix.id }, order: { sequenceNo: 'ASC' } });
    if (!mixMaterials.length) {
      return `Pushed from a plant device, but mix design ${mix.mixCode ?? mix.id} has no materials — no stock was consumed.`;
    }

    const matIds = [...new Set(mixMaterials.map((mm) => mm.materialId).filter((x): x is string => !!x))];
    const propRows = matIds.length ? await m.getRepository(Material).find({ where: { id: In(matIds) } }) : [];
    const props = new Map(propRows.map((x) => [x.id, x]));
    const inputs: MoistureInput[] = mixMaterials.map((mm) => {
      const prop = mm.materialId ? props.get(mm.materialId) : undefined;
      return {
        materialType: prop?.materialType ?? null,
        targetSsd: Number(mm.targetQuantity ?? 0) * batchQty,
        absorptionPct: Number(prop?.waterAbsorptionPct ?? 0),
        moisturePct: Number(prop?.defaultMoisturePct ?? 0),
      };
    });
    const { results } = applyMoistureCorrection(inputs);

    const matRepo = m.getRepository(BatchTicketMaterial);
    // Sorted, like the online confirm, so two pushes touching the same
    // materials take the balance locks in one order and cannot deadlock.
    const consume = new Map<string, { label: string | null; uom: string | null; qty: number }>();
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
      if (mm.materialId && res.correctedTarget > 0) {
        const prev = consume.get(mm.materialId);
        consume.set(mm.materialId, {
          label: mm.materialLabel, uom: mm.uom,
          qty: (prev?.qty ?? 0) + res.correctedTarget,
        });
      }
    }
    for (const materialId of [...consume.keys()].sort()) {
      const c = consume.get(materialId)!;
      await this.stock.consumeWithin(m, tenantId, ticket.plantId, materialId, c.label, c.uom, c.qty, ticket.id, userId);
    }
    return null;
  }

  private async applyPush(m: EntityManager, tenantId: string, device: Device, r: PushRecord, userId: string | null = null): Promise<PushResult> {
    const p = r.payload ?? {};
    if (r.operation === 'create' && r.entityName === 'delivery_challan') {
      const repo = m.getRepository(DeliveryChallan);
      const challanNo = String(p.challanNo ?? '').trim();
      // A document with no number used to be saved as '' — and every later
      // un-numbered push then collapsed into that one row as an "idempotent"
      // hit. Refuse it as a per-record conflict instead.
      if (!challanNo) return this.recordConflict(m, tenantId, device, r, null, 'missing_document_number');
      // Only a live status may be created offline; 'cancelled' or an unknown
      // string is refused (the shipped plant-app creates as 'delivered').
      const status = p.challanStatus === undefined ? 'issued' : p.challanStatus;
      if (!isChallanStatus(status) || status === 'cancelled') return this.recordConflict(m, tenantId, device, r, null, 'invalid_status');
      const quantityM3 = Number(p.quantityM3);
      if (!(quantityM3 > 0)) return this.recordConflict(m, tenantId, device, r, null, 'invalid_quantity');
      // Customer / site ids from the device must resolve inside the tenant (FK
      // checks bypass RLS, so a stale or foreign UUID would otherwise be stored
      // and the challan could never be invoiced).
      if (p.customerId && !(await m.getRepository(Customer).findOne({ where: { id: String(p.customerId) } }))) {
        return this.recordConflict(m, tenantId, device, r, null, 'unknown_customer');
      }
      if (p.siteId && !(await m.getRepository(Site).findOne({ where: { id: String(p.siteId) } }))) {
        return this.recordConflict(m, tenantId, device, r, null, 'unknown_site');
      }
      // The order this load was dispatched against. An offline challan used to
      // be stored with orderId null, and the invoice takes its rate from the
      // ORDER's line (agreedLine returns 0 for a challan with no order) — so
      // every offline delivery billed at ₹0 unless somebody noticed and typed
      // the rate in by hand. Resolve it inside the tenant, like the customer.
      let order: Order | null = null;
      if (p.orderId) {
        order = await m.getRepository(Order).findOne({ where: { id: String(p.orderId) } });
        if (!order) return this.recordConflict(m, tenantId, device, r, null, 'unknown_order');
        // Billing the load to one customer against another's order would put the
        // wrong rate — and the wrong receivable — on the invoice.
        if (p.customerId && order.customerId && order.customerId !== String(p.customerId)) {
          return this.recordConflict(m, tenantId, device, r, order, 'customer_order_mismatch');
        }
      }
      const existing = await repo.findOne({ where: { challanNo } });
      if (existing) {
        // Idempotent retry of the SAME document → applied with the existing id.
        // A DIFFERENT document under a reused number (another device, a reset
        // reservation, a number re-issued after FY roll-over) is a conflict —
        // it used to be silently discarded while the device showed it synced.
        if (sameDocument(existing as unknown as Record<string, unknown>, p, ['gradeLabel', 'quantityM3', 'customerId', 'siteId', 'slump', 'orderId'])) {
          return { localId: r.localId, status: 'applied', cloudId: existing.id };
        }
        return this.recordConflict(m, tenantId, device, r, existing, 'duplicate_number');
      }
      // The invoice picks the order line by gradeId (falling back to the first
      // line), so a challan that names only a grade LABEL would bill at the
      // first line's rate on a multi-grade order. Resolve the id: from the
      // order's own lines when we have one, else from the grade master.
      const gradeLabel = (p.gradeLabel as string) ?? null;
      const gradeId = await this.resolveGradeId(m, order, gradeLabel);
      const saved = await repo.save(
        repo.create({
          tenantId, challanNo, plantId: device.plantId,
          orderId: order?.id ?? null,
          // '' → null: an empty uuid string would otherwise abort the record (22P02).
          // With an order and no customer on the record, bill the order's customer
          // rather than leaving the challan unattributable.
          customerId: (p.customerId as string) || order?.customerId || null,
          siteId: (p.siteId as string) || order?.siteId || null,
          gradeId, gradeLabel, quantityM3: String(quantityM3),
          slump: (p.slump as string) ?? null, receiverName: (p.receiverName as string) ?? null,
          challanStatus: status, invoiceStatus: 'not_invoiced',
        }),
      );
      return { localId: r.localId, status: 'applied', cloudId: saved.id };
    }

    if (r.operation === 'create' && r.entityName === 'batch_ticket') {
      const repo = m.getRepository(BatchTicket);
      const batchTicketNo = String(p.batchTicketNo ?? '').trim();
      if (!batchTicketNo) return this.recordConflict(m, tenantId, device, r, null, 'missing_document_number');
      const existing = await repo.findOne({ where: { batchTicketNo } });
      if (existing) {
        if (sameDocument(existing as unknown as Record<string, unknown>, p, ['gradeLabel', 'batchQuantityM3'])) {
          return { localId: r.localId, status: 'applied', cloudId: existing.id };
        }
        return this.recordConflict(m, tenantId, device, r, existing, 'duplicate_number');
      }
      const gradeLabel = (p.gradeLabel as string) ?? null;
      const batchQty = Number(p.batchQuantityM3 ?? 0);
      const mix = await this.resolveApprovedMix(m, gradeLabel);
      const saved = await repo.save(
        repo.create({
          tenantId, batchTicketNo, plantId: device.plantId,
          gradeId: mix?.gradeId ?? (await this.resolveGradeId(m, null, gradeLabel)),
          gradeLabel, batchQuantityM3: String(batchQty),
          mixDesignId: mix?.id ?? null,
          sourceType: 'local_db_import', status: 'confirmed', batchEndTime: new Date(),
          operatorUserId: userId,
        }),
      );
      // The concrete was physically made, so the raw material physically left
      // the silo. This ticket used to be saved with no material lines and no
      // ledger movement at all, so book stock drifted permanently upwards by
      // every offline batch — invisibly, because nothing reconciles it.
      const note = await this.consumeForOfflineBatch(m, tenantId, saved, mix, batchQty, userId);
      if (note) await repo.update(saved.id, { notes: note });
      return { localId: r.localId, status: 'applied', cloudId: saved.id };
    }

    if (r.operation === 'update' && r.entityName === 'delivery_challan') {
      const repo = m.getRepository(DeliveryChallan);
      // Locked: the transition guards below must judge the settled row.
      const challan = r.cloudId ? await repo.findOne({ where: { id: r.cloudId }, lock: { mode: 'pessimistic_write' } }) : null;
      if (!challan) return this.recordConflict(m, tenantId, device, r, null, 'record_missing_on_cloud');
      if (r.baseUpdatedAt && iso(challan.updatedAt) !== r.baseUpdatedAt) {
        return this.recordConflict(m, tenantId, device, r, challan, 'stale_update');
      }
      const receiverName = p.receiverName !== undefined ? ((p.receiverName as string) ?? null) : undefined;
      if (p.challanStatus !== undefined && p.challanStatus !== challan.challanStatus) {
        // A status change is a state-machine TRANSITION, never a raw column
        // write: it goes through the same whitelist and guards as the challan
        // endpoints (draft→issued→delivered, draft/issued→cancelled; dispatch
        // must be live; an invoiced challan is frozen). A refused move is a
        // per-record conflict the supervisor can see, not a silent write or a 500.
        if (!isChallanStatus(p.challanStatus)) return this.recordConflict(m, tenantId, device, r, challan, 'invalid_status');
        if (!r.baseUpdatedAt) return this.recordConflict(m, tenantId, device, r, challan, 'missing_base_version');
        try {
          await this.changeChallanStatus(m, tenantId, challan, p.challanStatus, receiverName, `via offline sync (${device.deviceName})`);
        } catch (e) {
          if (e instanceof BadRequestException) {
            const msg = (e.getResponse() as { message?: string })?.message ?? e.message;
            return this.recordConflict(m, tenantId, device, r, challan, `guard_refused: ${msg}`.slice(0, 200));
          }
          throw e;
        }
        return { localId: r.localId, status: 'applied', cloudId: challan.id };
      }
      if (receiverName !== undefined) await repo.update(challan.id, { receiverName });
      return { localId: r.localId, status: 'applied', cloudId: challan.id };
    }

    return this.recordConflict(m, tenantId, device, r, null, 'unsupported_entity');
  }

  /**
   * Move a challan to `to` through the shared state machine: whitelist, invoiced
   * guard, dispatch-live guard, then the real transition (delivery runs the full
   * return-capture / dispatch close-out). Throws BadRequestException on refusal;
   * push turns that into a conflict row, conflict resolution surfaces it as 400.
   */
  private async changeChallanStatus(
    m: EntityManager,
    tenantId: string,
    challan: DeliveryChallan,
    to: ChallanStatus,
    receiverName: string | null | undefined,
    note: string,
  ): Promise<void> {
    if (!canTransition(challan.challanStatus, to)) throw badReq(`Cannot move challan from ${challan.challanStatus} to ${to}`);
    await assertNotInvoiced(m, challan);
    if (to !== 'cancelled') await assertDispatchLive(m, challan);
    if (to === 'delivered') {
      await deliverChallan(m, tenantId, challan, { receiverName: receiverName ?? challan.receiverName ?? undefined, note }, null);
      return;
    }
    await m.getRepository(DeliveryChallan).update(challan.id, {
      challanStatus: to,
      ...(receiverName !== undefined ? { receiverName } : {}),
    });
    await recordDeliveryHistory(m, tenantId, { challanId: challan.id }, challan.challanStatus, to, null, note);
  }

  private async recordConflict(m: EntityManager, tenantId: string, device: Device, r: PushRecord, cloud: unknown, reason: string): Promise<PushResult> {
    const repo = m.getRepository(SyncConflict);
    const conflict = await repo.save(
      repo.create({
        tenantId, deviceId: device.id, plantId: device.plantId, entityName: r.entityName,
        localId: r.localId, cloudId: r.cloudId ?? null,
        localPayloadJson: r.payload as unknown, cloudPayloadJson: cloud as unknown,
        conflictReason: reason, resolutionStatus: 'pending',
      }),
    );
    return { localId: r.localId, status: 'conflict', conflictId: conflict.id, reason };
  }

  // ---- Pull (cloud → offline) ------------------------------------------
  /**
   * Changes since the device's keyset cursor. Each entity is paged independently
   * with a `(updated_at, id)` keyset and capped at `PULL_LIMIT`; if any entity
   * fills its page, `hasMore` is set and the device pulls again from the returned
   * token. Because the cursor is a total order, a backlog of any size — even many
   * rows sharing one timestamp — drains completely with no row skipped or lost.
   */
  pull(tenantId: string, deviceId: string, sinceToken?: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const device = await this.activeDevice(m, deviceId);
      const cursors = decodeSince(sinceToken);
      const next: PullCursors = { ...cursors };
      let hasMore = false;

      // Sequential (not Promise.all) so the four reads share the one transaction
      // connection without overlapping queries.
      // Same plant scope as the bootstrap: a device only pulls its own plant's
      // documents. Rows with no plant stay visible (legacy and tenant-level
      // records), and a device registered without a plant keeps the old
      // tenant-wide view rather than suddenly going empty.
      const plantId = device.plantId;
      const page = async <T extends ObjectLiteral & { id: string; updatedAt: Date }>(
        key: PullEntity,
        repo: Repository<T>,
        scope?: (qb: SelectQueryBuilder<T>) => void,
      ): Promise<T[]> => {
        const cur = cursors[key];
        // Compare and order on the MILLISECOND-truncated timestamp, because that
        // is the precision the cursor can carry: Postgres stores timestamptz to
        // the microsecond, the driver hands us a JS Date (milliseconds), and the
        // token is an ISO string. Comparing raw microseconds against a truncated
        // cursor re-selects the boundary row on every later pull — a drained
        // device kept receiving the last row of each entity for ever, so "no
        // changes" never actually meant no changes. Truncating both sides makes
        // (ts, id) an exact total order again.
        const qb = repo
          .createQueryBuilder('e')
          .where("(date_trunc('milliseconds', e.updated_at), e.id) > (:ts::timestamptz, :id::uuid)", { ts: cur.ts, id: cur.id });
        scope?.(qb);
        const rows = await qb
          .orderBy("date_trunc('milliseconds', e.updated_at)", 'ASC')
          .addOrderBy('e.id', 'ASC')
          .limit(PULL_LIMIT + 1) // one extra to detect that more remain
          .getMany();
        const capped = rows.length > PULL_LIMIT;
        const delivered = capped ? rows.slice(0, PULL_LIMIT) : rows;
        const last = delivered[delivered.length - 1];
        if (last) next[key] = { ts: new Date(last.updatedAt).toISOString(), id: last.id };
        if (capped) hasMore = true;
        return delivered;
      };

      // Rows that carry a plant are filtered on it directly; a row with no plant
      // stays visible (legacy and tenant-level records).
      const byPlant = plantId
        ? <T extends ObjectLiteral>(qb: SelectQueryBuilder<T>) =>
            qb.andWhere('(e.plant_id = :plantId OR e.plant_id IS NULL)', { plantId })
        : undefined;
      const orders = await page('orders', m.getRepository(Order), byPlant);
      // A customer carries no plant of its own — it is in scope when this plant
      // has an order for it.
      const customers = await page(
        'customers',
        m.getRepository(Customer),
        plantId
          ? (qb) =>
              qb.andWhere(
                'EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = e.id AND (o.plant_id = :plantId OR o.plant_id IS NULL))',
                { plantId },
              )
          : undefined,
      );
      // ...and the customers of the orders just delivered, which that keyset
      // cannot reach on its own: a long-standing customer who receives a NEW
      // order has an updated_at far behind the cursor, so the device would show
      // an order whose customer it has never been sent. Re-sending one it
      // already holds is harmless — the device upserts by id.
      const known = new Set(customers.map((c) => c.id));
      const wanted = [...new Set(orders.map((o) => o.customerId).filter((id): id is string => !!id))]
        .filter((id) => !known.has(id));
      if (wanted.length) {
        customers.push(...(await m.getRepository(Customer).find({ where: { id: In(wanted) } })));
      }
      const challans = await page('deliveryChallans', m.getRepository(DeliveryChallan), byPlant);
      const stock = await page('stockBalances', m.getRepository(StockBalance), byPlant);

      const token = encodeCursors(next);
      // The authoritative cursor is the opaque token returned to (and stored by)
      // the device. The device row keeps only a timestamp of the last pull, for
      // operational visibility — `last_sync_token` is timestamptz and is never
      // read back to drive a pull.
      const pulledAt = new Date();
      await m.getRepository(Device).update(deviceId, { lastSyncToken: pulledAt, lastSeenAt: pulledAt });
      return {
        syncToken: token,
        hasMore,
        changes: { orders, customers, deliveryChallans: challans, stockBalances: stock },
        counts: {
          orders: orders.length,
          customers: customers.length,
          deliveryChallans: challans.length,
          stockBalances: stock.length,
        },
      };
    });
  }

  // ---- Conflicts --------------------------------------------------------
  listConflicts(tenantId: string, status?: string) {
    return this.db.runInTenant(tenantId, (m) =>
      // sync_conflicts is append-only and grows with device sync activity; the
      // screen shows the recent ones to resolve, so bound the read to the most
      // recent 500 rather than loading the whole history into one response.
      m.getRepository(SyncConflict).find({
        where: status ? { resolutionStatus: status } : {},
        order: { createdAt: 'DESC' },
        take: 500,
      }),
    );
  }

  resolveConflict(tenantId: string, id: string, resolution: string, userId: string) {
    if (!['keep_cloud', 'keep_local'].includes(resolution)) throw badReq('resolution must be keep_cloud or keep_local');
    return this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(SyncConflict);
      const conflict = await repo.findOne({ where: { id } });
      if (!conflict) throw notFound('Conflict not found');
      if (conflict.resolutionStatus !== 'pending') throw badReq(`Conflict already ${conflict.resolutionStatus}`);

      if (resolution === 'keep_local' && conflict.entityName === 'delivery_challan' && conflict.cloudId) {
        const p = (conflict.localPayloadJson ?? {}) as Record<string, unknown>;
        const challanRepo = m.getRepository(DeliveryChallan);
        const challan = await challanRepo.findOne({ where: { id: conflict.cloudId }, lock: { mode: 'pessimistic_write' } });
        if (!challan) throw notFound('Challan not found');
        const receiverName = p.receiverName !== undefined ? ((p.receiverName as string) ?? null) : undefined;
        if (p.challanStatus !== undefined && p.challanStatus !== challan.challanStatus) {
          // keep_local used to copy the device's status straight onto the row.
          // It now goes through the same state machine and guards as the
          // endpoints; a refused move is a 400 and the conflict stays pending.
          if (!isChallanStatus(p.challanStatus)) throw badReq(`Unknown challan status ${String(p.challanStatus)}`);
          await this.changeChallanStatus(m, tenantId, challan, p.challanStatus, receiverName, 'via sync conflict resolution (keep_local)');
        } else if (receiverName !== undefined) {
          await challanRepo.update(challan.id, { receiverName });
        }
      }
      await repo.update(id, { resolutionStatus: resolution, resolvedBy: userId, resolvedAt: new Date() });
      return repo.findOne({ where: { id } });
    });
  }
}
