import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { In } from 'typeorm';
import { TenantDbService } from '../core/database/tenant-db.service';
import { Driver, Order, PumpJob, Vehicle } from '../core/database/entities';
import { NumberingService } from '../sales/numbering.service';
import { listLimit } from '../common/list-limit.util';
import { businessToday, documentDate } from '../common/business-date.util';
import { dateRange } from '../common/date-range.util';
import {
  canPumpTransition, isChargeBasis, isPumpStatus, isPumpVehicle, pumpCharge, pumpHoursBetween,
  reconcilePumpJobs, type OrderPumpFacts,
} from './pump.util';

const notFound = () => new NotFoundException({ code: 'RECORD_NOT_FOUND', message: 'Pump job not found' });
const badReq = (message: string) => new BadRequestException({ code: 'VALIDATION_ERROR', message });
const num = (v: unknown): number => Number(v ?? 0) || 0;
const str = (v: unknown): string | null => (v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim());

const SELECT = `
  SELECT j.id, j.job_no AS "jobNo", j.order_id AS "orderId", j.customer_id AS "customerId", j.site_id AS "siteId",
         j.pump_vehicle_id AS "pumpVehicleId", j.operator_driver_id AS "operatorDriverId",
         j.scheduled_date AS "scheduledDate", j.scheduled_time AS "scheduledTime",
         j.arrived_at AS "arrivedAt", j.pumping_start_at AS "pumpingStartAt", j.pumping_end_at AS "pumpingEndAt",
         j.pumped_quantity_m3::float AS "pumpedQuantityM3", j.pump_hours::float AS "pumpHours",
         j.pipeline_length_m::float AS "pipelineLengthM", j.charge_basis AS "chargeBasis",
         j.rate::float AS "rate", j.charge_amount::float AS "chargeAmount", j.status, j.remarks,
         j.created_at AS "createdAt", j.updated_at AS "updatedAt",
         v.vehicle_no AS "pumpVehicleNo", v.vehicle_type AS "pumpVehicleType",
         d.driver_name AS "operatorName", d.mobile AS "operatorMobile",
         o.order_no AS "orderNo", c.customer_name AS "customerName", s.site_name AS "siteName", s.city AS "siteCity"
    FROM pump_jobs j
    LEFT JOIN vehicles v ON v.id = j.pump_vehicle_id
    LEFT JOIN drivers d ON d.id = j.operator_driver_id
    LEFT JOIN orders o ON o.id = j.order_id
    LEFT JOIN customers c ON c.id = j.customer_id
    LEFT JOIN sites s ON s.id = j.site_id
`;

/**
 * Pump management: the pump register (which vehicles are pumps and what each is
 * doing now), pump jobs (a pump booked to an order / site with an operator, then
 * on site → pumping → done with the pumped quantity, the hours and the charge),
 * and the utilisation + pump-charge reconciliation report.
 */
@Injectable()
export class PumpJobService {
  constructor(private readonly db: TenantDbService, private readonly numbering: NumberingService) {}

  list(tenantId: string, q: { status?: string; vehicleId?: string; orderId?: string; from?: string; to?: string; limit?: string }) {
    return this.db.runInTenant(tenantId, async (m) => {
      const where: string[] = [];
      const params: unknown[] = [];
      const add = (clause: string, v: unknown) => { params.push(v); where.push(clause.replace('?', `$${params.length}`)); };
      if (q.status) add('j.status = ?', q.status);
      if (q.vehicleId) add('j.pump_vehicle_id = ?', q.vehicleId);
      if (q.orderId) add('j.order_id = ?', q.orderId);
      if (q.from) add('j.scheduled_date >= ?', q.from);
      if (q.to) add('j.scheduled_date <= ?', q.to);
      params.push(listLimit(q.limit));
      const rows: Array<Record<string, unknown>> = await m.query(
        `${SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY (j.status IN ('planned','on_site','pumping')) DESC, j.scheduled_date DESC NULLS LAST, j.created_at DESC
         LIMIT $${params.length}`,
        params,
      );
      return rows;
    });
  }

  get(tenantId: string, id: string) {
    return this.db.runInTenant(tenantId, (m) => this.loadFull(m, id));
  }

  private async loadFull(m: EntityManager, id: string) {
    const rows: Array<Record<string, unknown>> = await m.query(`${SELECT} WHERE j.id = $1`, [id]);
    if (!rows[0]) throw notFound();
    return rows[0];
  }

  /** The pump register: every pump in the vehicle master with what it is doing right now. */
  pumps(tenantId: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const rows: Array<Record<string, unknown>> = await m.query(
        `SELECT v.id, v.vehicle_no AS "vehicleNo", v.vehicle_type AS "vehicleType", v.capacity_m3::float AS "capacityM3",
                v.ownership_type AS "ownershipType", v.status,
                d.driver_name AS "operatorName",
                cur.id AS "currentJobId", cur.job_no AS "currentJobNo", cur.status AS "currentJobStatus",
                cur.site_name AS "currentSiteName",
                (SELECT count(*)::int FROM pump_jobs pj WHERE pj.pump_vehicle_id = v.id AND pj.status IN ('planned','on_site','pumping')) AS "openJobs",
                (SELECT COALESCE(sum(pj.pump_hours),0)::float FROM pump_jobs pj WHERE pj.pump_vehicle_id = v.id AND pj.status = 'completed'
                    AND pj.pumping_end_at >= date_trunc('month', now())) AS "hoursThisMonth",
                (SELECT COALESCE(sum(pj.pumped_quantity_m3),0)::float FROM pump_jobs pj WHERE pj.pump_vehicle_id = v.id AND pj.status = 'completed'
                    AND pj.pumping_end_at >= date_trunc('month', now())) AS "m3ThisMonth"
           FROM vehicles v
           LEFT JOIN drivers d ON d.id = v.driver_id
           LEFT JOIN LATERAL (
             SELECT pj.id, pj.job_no, pj.status, s.site_name FROM pump_jobs pj LEFT JOIN sites s ON s.id = pj.site_id
              WHERE pj.pump_vehicle_id = v.id AND pj.status IN ('on_site','pumping')
              ORDER BY pj.updated_at DESC LIMIT 1
           ) cur ON true
          WHERE v.vehicle_type ILIKE '%pump%'
          ORDER BY v.vehicle_no`,
      );
      return rows;
    });
  }

  private async resolvePump(m: EntityManager, vehicleId: string): Promise<Vehicle> {
    const v = await m.getRepository(Vehicle).findOne({ where: { id: vehicleId } });
    if (!v) throw badReq('Pump not found in the vehicle master');
    if (!isPumpVehicle(v.vehicleType)) throw badReq(`${v.vehicleNo} is a ${v.vehicleType ?? 'vehicle'}, not a concrete pump. Set its type to "Concrete pump" under Masters → Vehicles.`);
    if (v.status === 'inactive') throw badReq(`Pump ${v.vehicleNo} is inactive — reactivate it or choose another pump.`);
    return v;
  }

  private async resolveOperator(m: EntityManager, driverId: string): Promise<Driver> {
    const d = await m.getRepository(Driver).findOne({ where: { id: driverId } });
    if (!d) throw badReq('Operator not found in the driver master');
    if (d.status === 'inactive') throw badReq(`Operator ${d.driverName} is inactive — choose an active driver.`);
    return d;
  }

  create(tenantId: string, dto: Record<string, unknown>, userId: string) {
    const pumpVehicleId = str(dto.pumpVehicleId);
    if (!pumpVehicleId) throw badReq('Choose the pump (a vehicle of type concrete pump).');
    const basis = str(dto.chargeBasis) ?? 'per_m3';
    if (!isChargeBasis(basis)) throw badReq('chargeBasis must be per_m3, per_hour, fixed or included');
    const rate = num(dto.rate);
    if (rate < 0) throw badReq('The rate cannot be negative');
    if (dto.pipelineLengthM !== undefined && dto.pipelineLengthM !== null && dto.pipelineLengthM !== '' && num(dto.pipelineLengthM) < 0) {
      throw badReq('Pipeline length cannot be negative');
    }
    const scheduledTime = str(dto.scheduledTime);
    if (scheduledTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(scheduledTime)) throw badReq('Scheduled time must be HH:MM');

    return this.db.runInTenant(tenantId, async (m) => {
      await this.resolvePump(m, pumpVehicleId);
      const operatorId = str(dto.operatorDriverId);
      if (operatorId) await this.resolveOperator(m, operatorId);

      let customerId = str(dto.customerId);
      let siteId = str(dto.siteId);
      const orderId = str(dto.orderId);
      if (orderId) {
        const order = await m.getRepository(Order).findOne({ where: { id: orderId } });
        if (!order) throw badReq('Order not found');
        if (order.orderStatus === 'cancelled') throw badReq(`Order ${order.orderNo} is cancelled — a pump cannot be booked against it`);
        customerId = order.customerId ?? customerId;
        siteId = order.siteId ?? siteId;
      }

      const jobNo = await this.numbering.next(m, tenantId, 'pump_job', 'PJ-');
      const repo = m.getRepository(PumpJob);
      const job = await repo.save(
        repo.create({
          tenantId, jobNo, orderId, customerId, siteId,
          pumpVehicleId, operatorDriverId: operatorId,
          scheduledDate: documentDate(dto.scheduledDate),
          scheduledTime,
          pipelineLengthM: str(dto.pipelineLengthM) === null ? null : String(num(dto.pipelineLengthM)),
          chargeBasis: basis,
          rate: String(rate),
          chargeAmount: String(pumpCharge(basis, rate, 0, 0)),
          status: 'planned',
          remarks: str(dto.remarks),
          createdBy: userId,
        }),
      );
      return this.loadFull(m, job.id);
    });
  }

  /** Edit the plan while the job has not started pumping. */
  update(tenantId: string, id: string, dto: Record<string, unknown>) {
    return this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(PumpJob);
      const job = await repo.findOne({ where: { id } });
      if (!job) throw notFound();
      if (!['planned', 'on_site'].includes(job.status)) throw badReq(`Job ${job.jobNo} is ${job.status} and its plan can no longer be edited`);
      const patch: Partial<PumpJob> = {};
      if (dto.pumpVehicleId !== undefined) {
        const v = await this.resolvePump(m, String(dto.pumpVehicleId));
        patch.pumpVehicleId = v.id;
      }
      if (dto.operatorDriverId !== undefined) {
        const opId = str(dto.operatorDriverId);
        if (opId) await this.resolveOperator(m, opId);
        patch.operatorDriverId = opId;
      }
      if (dto.scheduledDate !== undefined) patch.scheduledDate = documentDate(dto.scheduledDate);
      if (dto.scheduledTime !== undefined) {
        const t = str(dto.scheduledTime);
        if (t && !/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) throw badReq('Scheduled time must be HH:MM');
        patch.scheduledTime = t;
      }
      if (dto.pipelineLengthM !== undefined) {
        const p = str(dto.pipelineLengthM);
        if (p !== null && num(p) < 0) throw badReq('Pipeline length cannot be negative');
        patch.pipelineLengthM = p === null ? null : String(num(p));
      }
      if (dto.chargeBasis !== undefined) {
        if (!isChargeBasis(dto.chargeBasis)) throw badReq('chargeBasis must be per_m3, per_hour, fixed or included');
        patch.chargeBasis = dto.chargeBasis;
      }
      if (dto.rate !== undefined) {
        if (num(dto.rate) < 0) throw badReq('The rate cannot be negative');
        patch.rate = String(num(dto.rate));
      }
      if (dto.remarks !== undefined) patch.remarks = str(dto.remarks);
      const basis = patch.chargeBasis ?? job.chargeBasis;
      const rate = num(patch.rate ?? job.rate);
      patch.chargeAmount = String(pumpCharge(basis, rate, job.pumpedQuantityM3, job.pumpHours));
      await repo.update({ id }, patch);
      return this.loadFull(m, id);
    });
  }

  /**
   * Move a job: planned → on_site → pumping → completed, or cancel before
   * pumping starts. Completing records the pumped m³ and works out the hours
   * (from the start/end stamps unless given) and the charge.
   */
  setStatus(tenantId: string, id: string, dto: Record<string, unknown>) {
    const status = String(dto.status ?? '');
    if (!isPumpStatus(status)) throw badReq(`Invalid pump job status ${status || '(blank)'}`);
    const at = dto.at ? new Date(String(dto.at)) : new Date();
    if (Number.isNaN(at.getTime())) throw badReq('at is not a valid timestamp');
    if (at.getTime() > Date.now() + 5 * 60_000) throw badReq('at cannot be in the future');

    return this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(PumpJob);
      const job = await repo.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!job) throw notFound();
      if (!canPumpTransition(job.status, status)) throw badReq(`Cannot move pump job ${job.jobNo} from ${job.status} to ${status}`);

      const patch: Partial<PumpJob> = { status };
      if (status === 'on_site') patch.arrivedAt = at;
      if (status === 'pumping') {
        // One pump cannot pump on two sites at once.
        const busy = await repo.findOne({ where: { pumpVehicleId: job.pumpVehicleId, status: 'pumping' } });
        if (busy && busy.id !== job.id) throw badReq(`This pump is already pumping on job ${busy.jobNo} — complete that job first`);
        patch.arrivedAt = job.arrivedAt ?? at;
        patch.pumpingStartAt = at;
      }
      if (status === 'completed') {
        const pumped = dto.pumpedQuantityM3 === undefined || dto.pumpedQuantityM3 === null || dto.pumpedQuantityM3 === ''
          ? num(job.pumpedQuantityM3)
          : num(dto.pumpedQuantityM3);
        if (pumped < 0) throw badReq('Pumped quantity cannot be negative');
        if (dto.pumpedQuantityM3 !== undefined && !Number.isFinite(Number(dto.pumpedQuantityM3))) throw badReq('Pumped quantity must be a number');
        const start = job.pumpingStartAt ?? (job.status === 'on_site' ? job.arrivedAt : null);
        let hours = dto.pumpHours === undefined || dto.pumpHours === null || dto.pumpHours === '' ? pumpHoursBetween(start, at) : num(dto.pumpHours);
        if (hours !== null && hours < 0) throw badReq('Pump hours cannot be negative');
        if (hours === null) hours = 0;
        patch.pumpingStartAt = job.pumpingStartAt ?? start ?? at;
        patch.pumpingEndAt = at;
        patch.pumpedQuantityM3 = String(pumped);
        patch.pumpHours = String(hours);
        patch.chargeAmount = String(pumpCharge(job.chargeBasis, job.rate, pumped, hours));
      }
      if (dto.remarks !== undefined) patch.remarks = str(dto.remarks);
      const res = await repo.update({ id, status: job.status }, patch);
      if (!res.affected) throw badReq('Pump job changed concurrently — reload and retry');
      return this.loadFull(m, id);
    });
  }

  /** Utilisation per pump + the pump-charge reconciliation per order, over the scheduled-date range. */
  utilisation(tenantId: string, from?: string, to?: string) {
    const [f, t] = dateRange(from, to);
    // Default window: the last 30 days up to today (plant time).
    const today = businessToday();
    const range = {
      from: f ?? new Date(new Date(`${today}T00:00:00Z`).getTime() - 30 * 86_400_000).toISOString().slice(0, 10),
      to: t ?? today,
    };
    return this.db.runInTenant(tenantId, async (m) => {
      const perPump: Array<Record<string, unknown>> = await m.query(
        `SELECT v.id AS "vehicleId", v.vehicle_no AS "vehicleNo", v.vehicle_type AS "vehicleType",
                count(j.id) FILTER (WHERE j.status = 'completed')::int AS "jobsCompleted",
                count(j.id) FILTER (WHERE j.status = 'cancelled')::int AS "jobsCancelled",
                count(j.id) FILTER (WHERE j.status IN ('planned','on_site','pumping'))::int AS "jobsOpen",
                COALESCE(sum(j.pump_hours) FILTER (WHERE j.status = 'completed'), 0)::float AS "pumpHours",
                COALESCE(sum(j.pumped_quantity_m3) FILTER (WHERE j.status = 'completed'), 0)::float AS "pumpedM3",
                COALESCE(sum(j.charge_amount) FILTER (WHERE j.status = 'completed'), 0)::float AS "chargeAmount",
                COALESCE(sum(EXTRACT(EPOCH FROM (j.pumping_start_at - j.arrived_at)) / 3600) FILTER (WHERE j.status = 'completed' AND j.arrived_at IS NOT NULL AND j.pumping_start_at IS NOT NULL), 0)::float AS "waitingHours"
           FROM vehicles v
           LEFT JOIN pump_jobs j ON j.pump_vehicle_id = v.id AND j.scheduled_date BETWEEN $1 AND $2
          WHERE v.vehicle_type ILIKE '%pump%'
          GROUP BY v.id, v.vehicle_no, v.vehicle_type
          ORDER BY v.vehicle_no`,
        [range.from, range.to],
      );

      const jobs = await m.getRepository(PumpJob).find({ where: { status: In(['planned', 'on_site', 'pumping', 'completed']) } });
      const inRange = jobs.filter((j) => j.orderId && (!j.scheduledDate || (j.scheduledDate >= range.from && j.scheduledDate <= range.to)));
      const orderIds = [...new Set(inRange.map((j) => j.orderId as string))];
      // Orders that asked for a pump in the range but have no job at all.
      const wanted: Array<{ id: string }> = await m.query(
        `SELECT DISTINCT o.id FROM orders o
           JOIN order_items oi ON oi.order_id = o.id
           LEFT JOIN sites s ON s.id = o.site_id
          WHERE (oi.pump_required = true OR s.pump_required = true OR oi.pump_charge > 0)
            AND o.order_status NOT IN ('cancelled')
            AND o.order_date BETWEEN $1 AND $2`,
        [range.from, range.to],
      );
      for (const w of wanted) if (!orderIds.includes(w.id)) orderIds.push(w.id);
      if (!orderIds.length) return { range, perPump, reconciliation: reconcilePumpJobs([]) };

      const facts: Array<Record<string, unknown>> = await m.query(
        `SELECT o.id AS "orderId", o.order_no AS "orderNo", c.customer_name AS "customerName",
                bool_or(COALESCE(oi.pump_required, false)) OR bool_or(COALESCE(s.pump_required, false)) AS "pumpRequired",
                CASE WHEN COALESCE(sum(oi.quantity_m3), 0) > 0
                     THEN sum(oi.pump_charge * oi.quantity_m3) / sum(oi.quantity_m3) ELSE MAX(oi.pump_charge) END::float AS "pumpChargePerM3",
                COALESCE((SELECT sum(dc.quantity_m3 - COALESCE(dc.return_quantity_m3, 0)) FROM delivery_challans dc
                           WHERE dc.order_id = o.id AND dc.challan_status = 'delivered'), 0)::float AS "deliveredM3"
           FROM orders o
           LEFT JOIN customers c ON c.id = o.customer_id
           LEFT JOIN sites s ON s.id = o.site_id
           LEFT JOIN order_items oi ON oi.order_id = o.id
          WHERE o.id = ANY($1)
          GROUP BY o.id, o.order_no, c.customer_name`,
        [orderIds],
      );
      const byOrder = new Map<string, OrderPumpFacts>();
      for (const f of facts) {
        byOrder.set(String(f.orderId), {
          orderId: String(f.orderId), orderNo: String(f.orderNo), customerName: (f.customerName as string) ?? null,
          pumpRequired: Boolean(f.pumpRequired), pumpChargePerM3: Number(f.pumpChargePerM3) || 0,
          deliveredM3: Number(f.deliveredM3) || 0, jobs: [],
        });
      }
      for (const j of jobs) {
        const o = j.orderId ? byOrder.get(j.orderId) : undefined;
        if (o) o.jobs.push({ status: j.status, pumpedM3: j.pumpedQuantityM3, hours: j.pumpHours, chargeAmount: j.chargeAmount, chargeBasis: j.chargeBasis });
      }
      return { range, perPump, reconciliation: reconcilePumpJobs([...byOrder.values()]) };
    });
  }
}

