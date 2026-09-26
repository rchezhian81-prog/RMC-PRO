import { Injectable, UnauthorizedException } from '@nestjs/common';
import { IsNull } from 'typeorm';
import { TenantDbService } from '../core/database/tenant-db.service';
import { AuditService, AUDIT_ACTIONS } from '../audit/audit.service';
import { GpsIngestKey } from '../core/database/entities';
import { GpsService } from './gps.service';
import { generateIngestKey, hashIngestKey, ingestKeyHint, normalizeVehicleNo, parsePositions, type VendorPosition } from './gps-ingest.util';

/** Dispatch statuses that mean the truck is on a trip a vendor fix should attach to. */
const TRACKABLE = ['loaded', 'left_plant', 'reached_site', 'pouring', 'returning', 'delayed'];

export interface IngestKeyStatus {
  configured: boolean;
  keyHint: string | null;
  label: string | null;
  createdAt: string | null;
  lastUsedAt: string | null;
}

export interface IngestOutcome {
  received: number;
  accepted: number;
  vehiclesUpdated: number;
  tripsUpdated: number;
  rejected: Array<{ index: number; reason: string }>;
}

/**
 * The GPS vendor feed: any tracking provider posts positions with the
 * tenant's ingest key; each fix updates the vehicle's last known position and,
 * when that vehicle is on a live trip, is recorded as a ping on the dispatch
 * (through GpsService, so the live board and the track see it as usual).
 */
@Injectable()
export class GpsIngestService {
  constructor(
    private readonly db: TenantDbService,
    private readonly gps: GpsService,
    private readonly audit: AuditService,
  ) {}

  // ---- key management (owner side) -------------------------------------

  keyStatus(tenantId: string): Promise<IngestKeyStatus> {
    return this.db.runInTenant(tenantId, async (m) => {
      const row = await m.getRepository(GpsIngestKey).findOne({ where: { tenantId, revokedAt: IsNull() }, order: { createdAt: 'DESC' } });
      return {
        configured: Boolean(row),
        keyHint: row?.keyHint ?? null,
        label: row?.label ?? null,
        createdAt: row ? new Date(row.createdAt).toISOString() : null,
        lastUsedAt: row?.lastUsedAt ? new Date(row.lastUsedAt).toISOString() : null,
      };
    });
  }

  /** Create a key (retiring any earlier one). The key is in the response ONCE and never stored in clear. */
  async createKey(tenantId: string, label: string | null, userId: string): Promise<IngestKeyStatus & { key: string }> {
    const key = generateIngestKey();
    const status = await this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(GpsIngestKey);
      await repo.update({ tenantId, revokedAt: IsNull() }, { revokedAt: new Date() });
      const row = await repo.save(repo.create({ tenantId, keyHash: hashIngestKey(key), keyHint: ingestKeyHint(key), label, createdBy: userId }));
      return { configured: true, keyHint: row.keyHint, label: row.label, createdAt: new Date(row.createdAt).toISOString(), lastUsedAt: null };
    });
    await this.audit.record({
      tenantId, actorUserId: userId, action: AUDIT_ACTIONS.INTEGRATION_CHANGE, entityType: 'gps_ingest_key', entityId: null,
      entityLabel: `…${status.keyHint}`, summary: `Issued a GPS vendor feed key (…${status.keyHint}${label ? `, ${label}` : ''}); earlier keys retired`,
    });
    return { ...status, key };
  }

  async revokeKey(tenantId: string, userId: string): Promise<{ revoked: boolean }> {
    const revoked = await this.db.runInTenant(tenantId, async (m) => {
      const res = await m.getRepository(GpsIngestKey).update({ tenantId, revokedAt: IsNull() }, { revokedAt: new Date() });
      return (res.affected ?? 0) > 0;
    });
    if (revoked) {
      await this.audit.record({
        tenantId, actorUserId: userId, action: AUDIT_ACTIONS.INTEGRATION_CHANGE, entityType: 'gps_ingest_key', entityId: null,
        entityLabel: null, summary: 'Revoked the GPS vendor feed key',
      });
    }
    return { revoked };
  }

  // ---- the feed itself (vendor side, no login) -------------------------

  /** Which tenant a key belongs to — a cross-tenant lookup, so it runs as the platform. Wrong/revoked key → 401. */
  private async resolveTenant(key: string): Promise<string> {
    const k = (key ?? '').trim();
    if (!k) throw new UnauthorizedException({ code: 'GPS_KEY_REQUIRED', message: 'Send the ingest key in the X-RMC-GPS-KEY header' });
    const hash = hashIngestKey(k);
    const row = await this.db.runAsPlatform((m) => m.getRepository(GpsIngestKey).findOne({ where: { keyHash: hash, revokedAt: IsNull() } }));
    if (!row) throw new UnauthorizedException({ code: 'GPS_KEY_INVALID', message: 'The ingest key is not valid (wrong or revoked)' });
    return row.tenantId;
  }

  async ingest(key: string, body: unknown): Promise<IngestOutcome> {
    const tenantId = await this.resolveTenant(key);
    const { positions, rejected } = parsePositions(body);
    const outcome: IngestOutcome = { received: positions.length + rejected.length, accepted: 0, vehiclesUpdated: 0, tripsUpdated: 0, rejected: [...rejected] };
    if (!positions.length) return outcome;

    await this.db.runInTenant(tenantId, async (m) => {
      await m.getRepository(GpsIngestKey).update({ keyHash: hashIngestKey(key) }, { lastUsedAt: new Date() });
      const vehicles: Array<{ id: string; vehicle_no: string; gps_device_id: string | null }> = await m.query(
        `SELECT id, vehicle_no, gps_device_id FROM vehicles WHERE status <> 'inactive'`,
      );
      const byNo = new Map(vehicles.map((v) => [normalizeVehicleNo(v.vehicle_no), v.id]));
      const byDevice = new Map(vehicles.filter((v) => v.gps_device_id).map((v) => [String(v.gps_device_id).trim().toUpperCase(), v.id]));
      const touched = new Set<string>();

      // Newest fix per vehicle drives the "last known" columns; every fix on a live trip is a ping.
      const sorted = [...positions].sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());
      for (const p of sorted) {
        const vehicleId = (p.deviceId && byDevice.get(p.deviceId)) || (p.vehicleNo && byNo.get(p.vehicleNo)) || null;
        if (!vehicleId) {
          outcome.rejected.push({ index: p.index, reason: `no vehicle matches ${p.deviceId ? `device ${p.deviceId}` : `number ${p.vehicleNo}`}` });
          continue;
        }
        outcome.accepted += 1;
        await m.query(
          `UPDATE vehicles SET last_latitude = $2, last_longitude = $3, last_location_at = $4, last_speed_kmph = $5, updated_at = now()
            WHERE id = $1 AND (last_location_at IS NULL OR last_location_at <= $4)`,
          [vehicleId, String(p.latitude), String(p.longitude), p.recordedAt, p.speedKmph === null ? null : String(p.speedKmph)],
        );
        touched.add(vehicleId);
        const [live] = await m.query(
          `SELECT id FROM dispatches WHERE vehicle_id = $1 AND dispatch_status = ANY($2) ORDER BY created_at DESC LIMIT 1`,
          [vehicleId, TRACKABLE],
        );
        if (live?.id) {
          await this.gps.recordPingWithin(m, tenantId, String(live.id), {
            latitude: p.latitude, longitude: p.longitude, speedKmph: p.speedKmph, heading: p.heading, accuracyM: p.accuracyM,
            recordedAt: p.recordedAt.toISOString(), source: 'vendor',
          });
          outcome.tripsUpdated += 1;
        }
      }
      outcome.vehiclesUpdated = touched.size;
    });
    return outcome;
  }

  /** Every vehicle with a last known position (idle or on a trip), newest fix first. */
  fleet(tenantId: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const rows: Array<Record<string, unknown>> = await m.query(
        `SELECT v.id, v.vehicle_no AS "vehicleNo", v.vehicle_type AS "vehicleType", v.status, v.gps_device_id AS "gpsDeviceId",
                v.last_latitude::float AS "lastLatitude", v.last_longitude::float AS "lastLongitude",
                v.last_speed_kmph::float AS "lastSpeedKmph", v.last_location_at AS "lastLocationAt",
                EXTRACT(EPOCH FROM (now() - v.last_location_at))::int AS "ageSeconds",
                d.driver_name AS "driverName",
                cur.id AS "dispatchId", cur.dispatch_no AS "dispatchNo", cur.dispatch_status AS "dispatchStatus"
           FROM vehicles v
           LEFT JOIN drivers d ON d.id = v.driver_id
           LEFT JOIN LATERAL (
             SELECT id, dispatch_no, dispatch_status FROM dispatches x
              WHERE x.vehicle_id = v.id AND x.dispatch_status = ANY($1)
              ORDER BY x.created_at DESC LIMIT 1
           ) cur ON true
          WHERE v.status <> 'inactive'
          ORDER BY v.last_location_at DESC NULLS LAST, v.vehicle_no`,
        [TRACKABLE],
      );
      return rows;
    });
  }
}

export type { VendorPosition };
