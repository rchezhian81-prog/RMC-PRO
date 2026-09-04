import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { EntityManager, ObjectLiteral, Repository } from 'typeorm';
import { TenantDbService } from '../core/database/tenant-db.service';
import {
  BatchTicket,
  Customer,
  DeliveryChallan,
  Device,
  LocalNumberReservation,
  Order,
  StockBalance,
  SyncConflict,
} from '../core/database/entities';
import { NumberingService } from '../sales/numbering.service';

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
      const take = { take: 500 };
      const [customers, orders, grades, materials, mixDesigns, plants] = await Promise.all([
        m.getRepository(Customer).find(take),
        m.getRepository(Order).find({ where: { orderStatus: 'confirmed' }, ...take }),
        m.query(`SELECT * FROM concrete_grades ORDER BY grade_code`),
        m.query(`SELECT * FROM materials ORDER BY material_code`),
        m.query(`SELECT * FROM mix_designs WHERE approval_status = 'approved'`),
        m.query(`SELECT * FROM plants ORDER BY plant_code`),
      ]);
      return {
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
        results.push(await this.applyPush(m, tenantId, device, r));
      }
      await m.getRepository(Device).update(deviceId, { lastSeenAt: new Date() });
      return { results, applied: results.filter((x) => x.status === 'applied').length, conflicts: results.filter((x) => x.status === 'conflict').length };
    });
  }

  private async applyPush(m: EntityManager, tenantId: string, device: Device, r: PushRecord): Promise<PushResult> {
    const p = r.payload ?? {};
    if (r.operation === 'create' && r.entityName === 'delivery_challan') {
      const repo = m.getRepository(DeliveryChallan);
      const existing = await repo.findOne({ where: { challanNo: String(p.challanNo ?? '') } });
      if (existing) return { localId: r.localId, status: 'applied', cloudId: existing.id }; // idempotent
      const saved = await repo.save(
        repo.create({
          tenantId, challanNo: String(p.challanNo ?? ''), plantId: device.plantId,
          customerId: (p.customerId as string) ?? null, siteId: (p.siteId as string) ?? null,
          gradeLabel: (p.gradeLabel as string) ?? null, quantityM3: String(p.quantityM3 ?? 0),
          slump: (p.slump as string) ?? null, receiverName: (p.receiverName as string) ?? null,
          challanStatus: (p.challanStatus as string) ?? 'issued', invoiceStatus: 'not_invoiced',
        }),
      );
      return { localId: r.localId, status: 'applied', cloudId: saved.id };
    }

    if (r.operation === 'create' && r.entityName === 'batch_ticket') {
      const repo = m.getRepository(BatchTicket);
      const existing = await repo.findOne({ where: { batchTicketNo: String(p.batchTicketNo ?? '') } });
      if (existing) return { localId: r.localId, status: 'applied', cloudId: existing.id };
      const saved = await repo.save(
        repo.create({
          tenantId, batchTicketNo: String(p.batchTicketNo ?? ''), plantId: device.plantId,
          gradeLabel: (p.gradeLabel as string) ?? null, batchQuantityM3: String(p.batchQuantityM3 ?? 0),
          sourceType: 'local_db_import', status: 'confirmed', batchEndTime: new Date(),
        }),
      );
      return { localId: r.localId, status: 'applied', cloudId: saved.id };
    }

    if (r.operation === 'update' && r.entityName === 'delivery_challan') {
      const repo = m.getRepository(DeliveryChallan);
      const challan = r.cloudId ? await repo.findOne({ where: { id: r.cloudId } }) : null;
      if (!challan) return this.recordConflict(m, tenantId, device, r, null, 'record_missing_on_cloud');
      if (r.baseUpdatedAt && iso(challan.updatedAt) !== r.baseUpdatedAt) {
        return this.recordConflict(m, tenantId, device, r, challan, 'stale_update');
      }
      await repo.update(challan.id, {
        ...(p.receiverName !== undefined ? { receiverName: p.receiverName as string } : {}),
        ...(p.challanStatus !== undefined ? { challanStatus: p.challanStatus as string } : {}),
      });
      return { localId: r.localId, status: 'applied', cloudId: challan.id };
    }

    return this.recordConflict(m, tenantId, device, r, null, 'unsupported_entity');
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
      m.getRepository(SyncConflict).find({ where: status ? { resolutionStatus: status } : {}, order: { createdAt: 'DESC' } }),
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
        await m.getRepository(DeliveryChallan).update(conflict.cloudId, {
          ...(p.receiverName !== undefined ? { receiverName: p.receiverName as string } : {}),
          ...(p.challanStatus !== undefined ? { challanStatus: p.challanStatus as string } : {}),
        });
      }
      await repo.update(id, { resolutionStatus: resolution, resolvedBy: userId, resolvedAt: new Date() });
      return repo.findOne({ where: { id } });
    });
  }
}
