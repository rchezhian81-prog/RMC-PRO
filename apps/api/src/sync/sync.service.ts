import { BadRequestException, HttpException, Injectable, NotFoundException } from '@nestjs/common';
import type { EntityManager, ObjectLiteral, Repository } from 'typeorm';
import { TenantDbService } from '../core/database/tenant-db.service';
import {
  BatchTicket,
  Customer,
  DeliveryChallan,
  Device,
  LocalNumberReservation,
  Order,
  Site,
  StockBalance,
  SyncConflict,
} from '../core/database/entities';
import { NumberingService } from '../sales/numbering.service';
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
  ) {}

  // ---- Devices ----------------------------------------------------------
  registerDevice(tenantId: string, dto: Record<string, unknown>, userId: string) {
    const identifier = String(dto.deviceIdentifier ?? '').trim();
    const name = String(dto.deviceName ?? '').trim();
    if (!identifier || !name) throw badReq('deviceIdentifier and deviceName are required');
    return this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(Device);
      const existing = await repo.findOne({ where: { deviceIdentifier: identifier } });
      if (existing) {
        await repo.update(existing.id, { deviceName: name, status: 'active', lastSeenAt: new Date() });
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

  // ---- Bootstrap --------------------------------------------------------
  bootstrap(tenantId: string, deviceId: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const device = await m.getRepository(Device).findOne({ where: { id: deviceId } });
      if (!device) throw notFound('Device not found');
      const token = new Date();
      await m.getRepository(Device).update(deviceId, { lastSeenAt: token, lastSyncToken: token });
      // Snapshot ALL customers and confirmed orders — no row cap. The token below
      // is the bootstrap instant, so the follow-up pull delivers only changes AFTER
      // it; a 500-row cap therefore permanently lost the customers/orders beyond it
      // (their updated_at < token, so the keyset pull skipped them too) on any
      // tenant with >500 of either. The other reference tables were already returned
      // in full — these now match. Ordered for a deterministic response.
      const [customers, orders, grades, materials, mixDesigns, plants] = await Promise.all([
        m.getRepository(Customer).find({ order: { createdAt: 'ASC' } }),
        m.getRepository(Order).find({ where: { orderStatus: 'confirmed' }, order: { createdAt: 'ASC' } }),
        m.query(`SELECT * FROM concrete_grades ORDER BY grade_code`),
        m.query(`SELECT * FROM materials ORDER BY material_code`),
        m.query(`SELECT * FROM mix_designs WHERE approval_status = 'approved'`),
        m.query(`SELECT * FROM plants ORDER BY plant_code`),
      ]);
      return {
        // Token is the bootstrap instant; the device stores it and the follow-up
        // pull delivers only what changed AFTER it. This stays a parseable ISO
        // timestamp (the plant-app engine uses it as a local clock), and it is now
        // correct because the snapshot above is complete.
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
        const device = await m.getRepository(Device).findOne({ where: { id: deviceId } });
        if (!device) throw notFound('Device not found');
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
  push(tenantId: string, deviceId: string, records: PushRecord[]) {
    if (!Array.isArray(records)) throw badReq('records[] required');
    return this.db.runInTenant(tenantId, async (m) => {
      const device = await m.getRepository(Device).findOne({ where: { id: deviceId } });
      if (!device) throw notFound('Device not found');
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
          results.push(await this.applyPush(m, tenantId, device, r));
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

  private async applyPush(m: EntityManager, tenantId: string, device: Device, r: PushRecord): Promise<PushResult> {
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
      const existing = await repo.findOne({ where: { challanNo } });
      if (existing) {
        // Idempotent retry of the SAME document → applied with the existing id.
        // A DIFFERENT document under a reused number (another device, a reset
        // reservation, a number re-issued after FY roll-over) is a conflict —
        // it used to be silently discarded while the device showed it synced.
        if (sameDocument(existing as unknown as Record<string, unknown>, p, ['gradeLabel', 'quantityM3', 'customerId', 'siteId', 'slump'])) {
          return { localId: r.localId, status: 'applied', cloudId: existing.id };
        }
        return this.recordConflict(m, tenantId, device, r, existing, 'duplicate_number');
      }
      const saved = await repo.save(
        repo.create({
          tenantId, challanNo, plantId: device.plantId,
          // '' → null: an empty uuid string would otherwise abort the record (22P02).
          customerId: (p.customerId as string) || null, siteId: (p.siteId as string) || null,
          gradeLabel: (p.gradeLabel as string) ?? null, quantityM3: String(quantityM3),
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
      const saved = await repo.save(
        repo.create({
          tenantId, batchTicketNo, plantId: device.plantId,
          gradeLabel: (p.gradeLabel as string) ?? null, batchQuantityM3: String(p.batchQuantityM3 ?? 0),
          sourceType: 'local_db_import', status: 'confirmed', batchEndTime: new Date(),
        }),
      );
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
      const cursors = decodeSince(sinceToken);
      const next: PullCursors = { ...cursors };
      let hasMore = false;

      // Sequential (not Promise.all) so the four reads share the one transaction
      // connection without overlapping queries.
      const page = async <T extends ObjectLiteral & { id: string; updatedAt: Date }>(
        key: PullEntity,
        repo: Repository<T>,
      ): Promise<T[]> => {
        const cur = cursors[key];
        const rows = await repo
          .createQueryBuilder('e')
          .where('(e.updated_at, e.id) > (:ts::timestamptz, :id::uuid)', { ts: cur.ts, id: cur.id })
          .orderBy('e.updated_at', 'ASC')
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

      const orders = await page('orders', m.getRepository(Order));
      const customers = await page('customers', m.getRepository(Customer));
      const challans = await page('deliveryChallans', m.getRepository(DeliveryChallan));
      const stock = await page('stockBalances', m.getRepository(StockBalance));

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
