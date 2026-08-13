import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { TenantDbService } from '../core/database/tenant-db.service';
import { Dispatch, DispatchLocationPing } from '../core/database/entities';
import { isValidLatLng, trackSummary } from './gps.util';

const notFound = () => new NotFoundException({ code: 'RECORD_NOT_FOUND', message: 'Dispatch not found' });
const badReq = (message: string) => new BadRequestException({ code: 'VALIDATION_ERROR', message });
const numOrNull = (v: unknown): number | null => (v === undefined || v === null || v === '' ? null : Number(v) || 0);

/** Dispatch statuses that mean a truck is on the road and worth tracking. */
const TRACKABLE = new Set(['loaded', 'left_plant', 'reached_site', 'pouring', 'returning', 'delayed']);
/** A trip that is over — a ping is refused. */
const CLOSED = new Set(['cancelled', 'rejected']);

/**
 * GPS tracking (the `gps` module). Records a location ping for a dispatch, keeps
 * the latest fix denormalised on the dispatch for the board, lists the live
 * positions of in-transit loads, and returns a dispatch's full track.
 */
@Injectable()
export class GpsService {
  constructor(private readonly db: TenantDbService) {}

  /** Record one GPS fix for a dispatch and roll it onto the dispatch's latest. */
  recordPing(tenantId: string, dispatchId: string, dto: Record<string, unknown>) {
    const latitude = Number(dto.latitude);
    const longitude = Number(dto.longitude);
    if (!isValidLatLng(latitude, longitude)) throw badReq('A valid latitude (-90..90) and longitude (-180..180) are required');

    return this.db.runInTenant(tenantId, async (m) => {
      const dispatch = await m.getRepository(Dispatch).findOne({ where: { id: dispatchId } });
      if (!dispatch) throw notFound();
      if (CLOSED.has(dispatch.dispatchStatus)) throw badReq(`Dispatch is ${dispatch.dispatchStatus} — tracking is closed`);

      const recordedAt = dto.recordedAt ? new Date(String(dto.recordedAt)) : new Date();
      const speedKmph = numOrNull(dto.speedKmph);
      const repo = m.getRepository(DispatchLocationPing);
      const ping = await repo.save(
        repo.create({
          tenantId, dispatchId, vehicleId: dispatch.vehicleId,
          latitude: String(latitude), longitude: String(longitude),
          speedKmph: speedKmph === null ? null : String(speedKmph),
          heading: numOrNull(dto.heading) === null ? null : String(numOrNull(dto.heading)),
          accuracyM: numOrNull(dto.accuracyM) === null ? null : String(numOrNull(dto.accuracyM)),
          source: (dto.source as string) ?? 'device',
          recordedAt,
        }),
      );

      await m.getRepository(Dispatch).update(dispatchId, {
        lastLatitude: String(latitude), lastLongitude: String(longitude),
        lastLocationAt: recordedAt,
        lastSpeedKmph: speedKmph === null ? null : String(speedKmph),
      });
      return ping;
    });
  }

  /**
   * The live board: in-transit dispatches that have a recent fix, newest first,
   * with the vehicle, status and last-known position + age in seconds.
   */
  live(tenantId: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const rows: Array<Record<string, unknown>> = await m.query(
        `SELECT d.id, d.dispatch_no AS "dispatchNo", d.dispatch_status AS "dispatchStatus",
                d.grade_label AS "gradeLabel", v.vehicle_no AS "vehicleNo",
                d.last_latitude::float AS "lastLatitude", d.last_longitude::float AS "lastLongitude",
                d.last_speed_kmph::float AS "lastSpeedKmph", d.last_location_at AS "lastLocationAt",
                EXTRACT(EPOCH FROM (now() - d.last_location_at))::int AS "ageSeconds"
           FROM dispatches d
           LEFT JOIN vehicles v ON v.id = d.vehicle_id
          WHERE d.last_location_at IS NOT NULL
            AND d.dispatch_status = ANY($1)
          ORDER BY d.last_location_at DESC`,
        [[...TRACKABLE]],
      );
      return rows;
    });
  }

  /** A dispatch's full ordered track (oldest → newest) with a path summary. */
  track(tenantId: string, dispatchId: string) {
    return this.db.runInTenant(tenantId, async (m: EntityManager) => {
      const dispatch = await m.getRepository(Dispatch).findOne({ where: { id: dispatchId } });
      if (!dispatch) throw notFound();
      const pings = await m.getRepository(DispatchLocationPing).find({
        where: { dispatchId },
        order: { recordedAt: 'ASC', createdAt: 'ASC' },
      });
      const summary = trackSummary(pings.map((p) => ({ latitude: p.latitude, longitude: p.longitude })));
      return { dispatchId, dispatchNo: dispatch.dispatchNo, status: dispatch.dispatchStatus, summary, pings };
    });
  }
}
