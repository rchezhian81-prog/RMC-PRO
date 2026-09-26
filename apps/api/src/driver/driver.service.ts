import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { TenantDbService } from '../core/database/tenant-db.service';
import { Dispatch, Driver, Vehicle } from '../core/database/entities';
import { DispatchService } from '../dispatch/dispatch.service';
import { GpsService } from '../gps/gps.service';
import { TenantAccessService } from '../rbac/tenant-access.service';

const badReq = (message: string) => new BadRequestException({ code: 'VALIDATION_ERROR', message });

/** The moves a driver may make from the phone. Everything else stays with the office. */
export const DRIVER_STATUSES = ['left_plant', 'reached_site', 'pouring', 'completed', 'delayed', 'returning'] as const;

/** Trips a driver still has in hand (shown first), plus what they closed today. */
const OPEN = ['waiting', 'loaded', 'left_plant', 'reached_site', 'pouring', 'delayed', 'returning'];

export interface DriverIdentity {
  linked: boolean;
  driver: { id: string; driverCode: string; driverName: string; mobile: string | null } | null;
  /** The vehicle whose master says this driver is its assigned driver, if any. */
  vehicle: { id: string; vehicleNo: string } | null;
  /** Whether the tenant's plan includes GPS tracking — the phone streams only when it does. */
  gpsEnabled: boolean;
  message: string | null;
}

/**
 * The driver's phone screen ("My Trips", the `driver_app` module).
 *
 * A login is linked to ONE driver record (Masters → Drivers → Login account).
 * Every read and write here is scoped to that driver: the trips listed are the
 * dispatches assigned to them, and a status move or a position fix on a
 * dispatch assigned to someone else is refused. The moves themselves go through
 * DispatchService.setStatus (the same transition graph, timestamps and history
 * as the board) and the fixes through GpsService.recordPing, so the office
 * sees a phone update exactly as it sees a board update.
 */
@Injectable()
export class DriverService {
  constructor(
    private readonly db: TenantDbService,
    private readonly dispatch: DispatchService,
    private readonly gps: GpsService,
    private readonly access: TenantAccessService,
  ) {}

  private async driverFor(m: EntityManager, userId: string): Promise<Driver | null> {
    return m.getRepository(Driver).findOne({ where: { userId } });
  }

  /** Who the signed-in user is on the road, or a plain-words reason they are nobody yet. */
  me(tenantId: string, userId: string): Promise<DriverIdentity> {
    return this.db.runInTenant(tenantId, async (m) => {
      const driver = await this.driverFor(m, userId);
      const gpsEnabled = await this.access.isModuleEnabled(tenantId, 'gps');
      if (!driver) {
        return {
          linked: false, driver: null, vehicle: null, gpsEnabled,
          message: 'Your login is not linked to a driver record yet. Ask the office to open Masters → Drivers, edit your name and choose your login under "Login account".',
        };
      }
      if (driver.status === 'inactive') {
        return {
          linked: false, driver: null, vehicle: null, gpsEnabled,
          message: `The driver record ${driver.driverName} is inactive. Ask the office to reactivate it under Masters → Drivers.`,
        };
      }
      const vehicle = await m.getRepository(Vehicle).findOne({ where: { driverId: driver.id } });
      return {
        linked: true,
        driver: { id: driver.id, driverCode: driver.driverCode, driverName: driver.driverName, mobile: driver.mobile },
        vehicle: vehicle ? { id: vehicle.id, vehicleNo: vehicle.vehicleNo } : null,
        gpsEnabled,
        message: null,
      };
    });
  }

  /** A driver's trips: open ones first (oldest first, so the next load is on top), then today's closed ones. */
  trips(tenantId: string, userId: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const driver = await this.driverFor(m, userId);
      if (!driver) return [];
      const rows: Array<Record<string, unknown>> = await m.query(
        `SELECT d.id, d.dispatch_no AS "dispatchNo", d.dispatch_status AS "dispatchStatus",
                d.grade_label AS "gradeLabel", d.quantity_m3::float AS "quantityM3",
                d.dispatch_time AS "dispatchTime", d.site_arrival_time AS "siteArrivalTime",
                d.pour_start_time AS "pourStartTime", d.pour_end_time AS "pourEndTime",
                d.delay_reason AS "delayReason", d.return_quantity_m3::float AS "returnQuantityM3",
                d.last_location_at AS "lastLocationAt", d.created_at AS "createdAt",
                v.vehicle_no AS "vehicleNo",
                c.customer_name AS "customerName", c.contact_person AS "customerContact", c.mobile AS "customerMobile",
                s.site_name AS "siteName", s.address AS "siteAddress", s.city AS "siteCity",
                s.contact_person AS "siteContact", s.mobile AS "siteMobile",
                o.order_no AS "orderNo",
                ch.id AS "challanId", ch.challan_no AS "challanNo", ch.challan_status AS "challanStatus",
                (d.dispatch_status = ANY($2)) AS "open"
           FROM dispatches d
           LEFT JOIN vehicles v ON v.id = d.vehicle_id
           LEFT JOIN customers c ON c.id = d.customer_id
           LEFT JOIN sites s ON s.id = d.site_id
           LEFT JOIN orders o ON o.id = d.order_id
           LEFT JOIN LATERAL (
             SELECT id, challan_no, challan_status FROM delivery_challans dc
              WHERE dc.dispatch_id = d.id AND dc.challan_status <> 'cancelled'
              ORDER BY dc.created_at DESC LIMIT 1
           ) ch ON true
          WHERE d.driver_id = $1
            AND (d.dispatch_status = ANY($2)
                 OR (d.dispatch_status = 'completed' AND COALESCE(d.pour_end_time, d.updated_at) >= now() - interval '18 hours'))
          ORDER BY (d.dispatch_status = ANY($2)) DESC, d.created_at ASC
          LIMIT 50`,
        [driver.id, OPEN],
      );
      return rows;
    });
  }

  /** Load a dispatch and prove it belongs to this driver. */
  private async ownTrip(m: EntityManager, userId: string, dispatchId: string): Promise<{ driver: Driver; dispatch: Dispatch }> {
    const driver = await this.driverFor(m, userId);
    if (!driver) {
      throw new ForbiddenException({ code: 'DRIVER_NOT_LINKED', message: 'Your login is not linked to a driver record. Ask the office to link it under Masters → Drivers.' });
    }
    const dispatch = await m.getRepository(Dispatch).findOne({ where: { id: dispatchId } });
    if (!dispatch) throw new NotFoundException({ code: 'RECORD_NOT_FOUND', message: 'Trip not found' });
    if (dispatch.driverId !== driver.id) {
      throw new ForbiddenException({ code: 'NOT_YOUR_TRIP', message: `${dispatch.dispatchNo} is assigned to another driver.` });
    }
    return { driver, dispatch };
  }

  /** Move one of MY trips along the chain, through the board's own transition rules. */
  async setStatus(tenantId: string, userId: string, dispatchId: string, dto: Record<string, unknown>) {
    const status = String(dto.status ?? '');
    if (!(DRIVER_STATUSES as readonly string[]).includes(status)) {
      throw badReq(`A driver can mark a trip ${DRIVER_STATUSES.join(', ')} — not "${status || '(blank)'}".`);
    }
    await this.db.runInTenant(tenantId, (m) => this.ownTrip(m, userId, dispatchId));
    const note = typeof dto.note === 'string' && dto.note.trim() ? dto.note.trim() : `Updated from the driver's phone`;
    const extra: Record<string, unknown> = { note };
    if (status === 'delayed') extra.delayReason = dto.delayReason ?? 'Delayed (reported from the phone)';
    if (status === 'returning') {
      if (dto.returnQuantityM3 !== undefined) extra.returnQuantityM3 = dto.returnQuantityM3;
      if (dto.returnReason) extra.returnReason = dto.returnReason;
    }
    return this.dispatch.setStatus(tenantId, dispatchId, status, userId, extra);
  }

  /**
   * A position fix from the phone for one of MY trips. When the tenant's plan
   * has no GPS module the fix is dropped, and the phone is told so once rather
   * than failing on every beat.
   */
  async location(tenantId: string, userId: string, dispatchId: string, dto: Record<string, unknown>) {
    await this.db.runInTenant(tenantId, (m) => this.ownTrip(m, userId, dispatchId));
    if (!(await this.access.isModuleEnabled(tenantId, 'gps'))) {
      return { recorded: false, reason: 'GPS tracking is not included in this company\'s plan — the trip status still updates.' };
    }
    const ping = await this.gps.recordPing(tenantId, dispatchId, { ...dto, source: 'driver_phone' });
    return { recorded: true, pingId: ping.id, recordedAt: ping.recordedAt };
  }
}
