import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { TenantDbService } from '../core/database/tenant-db.service';
import { Vehicle, VehicleServiceSchedule } from '../core/database/entities';
import { computeNextDue, serviceDueState } from './fleet.util';

const notFound = () => new NotFoundException({ code: 'RECORD_NOT_FOUND', message: 'Service schedule not found' });
const badReq = (message: string) => new BadRequestException({ code: 'VALIDATION_ERROR', message });
const numOrNull = (v: unknown): number | null => (v === undefined || v === null || v === '' ? null : Number(v) || 0);
const todayIso = (): string => new Date().toISOString().slice(0, 10);

/**
 * Vehicle preventive-service schedules (Plan D3). A schedule pairs a vehicle with
 * a service type and an interval (km and/or days); the last-service anchor drives
 * the computed next-due, and every list resolves the vehicle's current odometer
 * (latest fuel/maintenance reading) so each row carries an ok / due_soon / overdue
 * state for the dashboard and the fleet screen.
 */
@Injectable()
export class ServiceScheduleService {
  constructor(private readonly db: TenantDbService) {}

  /** Highest odometer known for a vehicle across fuel logs, jobs and its anchor. */
  private async currentOdometer(m: EntityManager, vehicleId: string, anchor: string | null): Promise<number | null> {
    const rows: Array<{ odo: string | null }> = await m.query(
      `SELECT GREATEST(
                COALESCE((SELECT max(odometer) FROM vehicle_fuel_logs WHERE vehicle_id = $1), 0),
                COALESCE((SELECT max(odometer) FROM vehicle_maintenance_jobs WHERE vehicle_id = $1), 0),
                COALESCE($2::numeric, 0)
              ) AS odo`,
      [vehicleId, anchor],
    );
    const odo = numOrNull(rows[0]?.odo);
    return odo && odo > 0 ? odo : anchor !== null ? Number(anchor) : null;
  }

  private async annotate(m: EntityManager, s: VehicleServiceSchedule) {
    const currentOdometer = await this.currentOdometer(m, s.vehicleId, s.lastServiceOdometer);
    const dueState = serviceDueState({
      nextDueOdometer: numOrNull(s.nextDueOdometer),
      currentOdometer,
      nextDueDate: s.nextDueDate,
      today: todayIso(),
    });
    return { ...s, currentOdometer, dueState };
  }

  async list(tenantId: string, vehicleId?: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const where: Record<string, unknown> = {};
      if (vehicleId) where.vehicleId = vehicleId;
      const rows = await m.getRepository(VehicleServiceSchedule).find({ where, order: { createdAt: 'DESC' } });
      return Promise.all(rows.map((s) => this.annotate(m, s)));
    });
  }

  async get(tenantId: string, id: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const s = await m.getRepository(VehicleServiceSchedule).findOne({ where: { id } });
      if (!s) throw notFound();
      return this.annotate(m, s);
    });
  }

  create(tenantId: string, dto: Record<string, unknown>) {
    const vehicleId = String(dto.vehicleId ?? '');
    if (!vehicleId) throw badReq('vehicleId required');
    const serviceType = String(dto.serviceType ?? '').trim();
    if (!serviceType) throw badReq('serviceType required');
    const intervalKm = numOrNull(dto.intervalKm);
    const intervalDays = numOrNull(dto.intervalDays);
    if (intervalKm === null && intervalDays === null) throw badReq('Set an interval in km and/or days');

    return this.db.runInTenant(tenantId, async (m) => {
      const vehicle = await m.getRepository(Vehicle).findOne({ where: { id: vehicleId } });
      if (!vehicle) throw badReq('Vehicle not found');

      const lastServiceOdometer = numOrNull(dto.lastServiceOdometer);
      const lastServiceDate = (dto.lastServiceDate as string) ?? null;
      const { nextDueOdometer, nextDueDate } = computeNextDue({
        baseOdometer: lastServiceOdometer,
        baseDate: lastServiceDate,
        intervalKm,
        intervalDays,
      });

      const repo = m.getRepository(VehicleServiceSchedule);
      const saved = await repo.save(
        repo.create({
          tenantId, vehicleId, serviceType,
          intervalKm, intervalDays,
          lastServiceOdometer: lastServiceOdometer === null ? null : String(lastServiceOdometer),
          lastServiceDate,
          nextDueOdometer: nextDueOdometer === null ? null : String(nextDueOdometer),
          nextDueDate,
          isActive: dto.isActive === undefined ? true : Boolean(dto.isActive),
          remarks: (dto.remarks as string) ?? null,
        }),
      );
      return this.annotate(m, saved);
    });
  }

  update(tenantId: string, id: string, dto: Record<string, unknown>) {
    return this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(VehicleServiceSchedule);
      const s = await repo.findOne({ where: { id } });
      if (!s) throw notFound();

      const intervalKm = dto.intervalKm === undefined ? s.intervalKm : numOrNull(dto.intervalKm);
      const intervalDays = dto.intervalDays === undefined ? s.intervalDays : numOrNull(dto.intervalDays);
      const lastServiceOdometer =
        dto.lastServiceOdometer === undefined ? numOrNull(s.lastServiceOdometer) : numOrNull(dto.lastServiceOdometer);
      const lastServiceDate = dto.lastServiceDate === undefined ? s.lastServiceDate : ((dto.lastServiceDate as string) ?? null);
      const serviceType = dto.serviceType === undefined ? s.serviceType : String(dto.serviceType).trim();
      const { nextDueOdometer, nextDueDate } = computeNextDue({
        baseOdometer: lastServiceOdometer,
        baseDate: lastServiceDate,
        intervalKm,
        intervalDays,
      });

      await repo.update(id, {
        serviceType,
        intervalKm, intervalDays,
        lastServiceOdometer: lastServiceOdometer === null ? null : String(lastServiceOdometer),
        lastServiceDate,
        nextDueOdometer: nextDueOdometer === null ? null : String(nextDueOdometer),
        nextDueDate,
        isActive: dto.isActive === undefined ? s.isActive : Boolean(dto.isActive),
        remarks: dto.remarks === undefined ? s.remarks : ((dto.remarks as string) ?? null),
      });
      const fresh = await repo.findOne({ where: { id } });
      return this.annotate(m, fresh as VehicleServiceSchedule);
    });
  }
}
