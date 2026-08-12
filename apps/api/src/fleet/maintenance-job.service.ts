import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantDbService } from '../core/database/tenant-db.service';
import { Vehicle, VehicleMaintenanceJob, VehicleServiceSchedule } from '../core/database/entities';
import { NumberingService } from '../sales/numbering.service';
import { AuditService, AUDIT_ACTIONS } from '../audit/audit.service';
import { computeNextDue } from './fleet.util';

const notFound = () => new NotFoundException({ code: 'RECORD_NOT_FOUND', message: 'Maintenance job not found' });
const badReq = (message: string) => new BadRequestException({ code: 'VALIDATION_ERROR', message });
const num = (v: unknown): number => Number(v ?? 0) || 0;
const numOrNull = (v: unknown): number | null => (v === undefined || v === null || v === '' ? null : Number(v) || 0);
const round2 = (v: number): number => Math.round((Number(v) || 0) * 100) / 100;
const todayIso = (): string => new Date().toISOString().slice(0, 10);

const JOB_TYPES = new Set(['service', 'repair', 'breakdown']);

/**
 * Vehicle maintenance jobs (Plan D3) — a scheduled service, an ad-hoc repair, or
 * a breakdown, each with split labour/parts cost and (for breakdowns) downtime.
 * Completing a job that links a service schedule rolls that schedule's anchor to
 * this job's odometer + completion date and recomputes its next-due. Audited.
 */
@Injectable()
export class MaintenanceJobService {
  constructor(
    private readonly db: TenantDbService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
  ) {}

  list(tenantId: string, vehicleId?: string, status?: string) {
    return this.db.runInTenant(tenantId, (m) => {
      const where: Record<string, unknown> = {};
      if (vehicleId) where.vehicleId = vehicleId;
      if (status) where.status = status;
      return m.getRepository(VehicleMaintenanceJob).find({ where, order: { createdAt: 'DESC' } });
    });
  }

  get(tenantId: string, id: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const job = await m.getRepository(VehicleMaintenanceJob).findOne({ where: { id } });
      if (!job) throw notFound();
      return job;
    });
  }

  create(tenantId: string, dto: Record<string, unknown>) {
    const vehicleId = String(dto.vehicleId ?? '');
    if (!vehicleId) throw badReq('vehicleId required');
    const jobType = String(dto.jobType ?? 'service');
    if (!JOB_TYPES.has(jobType)) throw badReq('jobType must be service, repair or breakdown');

    return this.db.runInTenant(tenantId, async (m) => {
      const vehicle = await m.getRepository(Vehicle).findOne({ where: { id: vehicleId } });
      if (!vehicle) throw badReq('Vehicle not found');

      const scheduleId = (dto.scheduleId as string) || null;
      if (scheduleId) {
        const sched = await m.getRepository(VehicleServiceSchedule).findOne({ where: { id: scheduleId } });
        if (!sched) throw badReq('Service schedule not found');
        if (sched.vehicleId !== vehicleId) throw badReq('Schedule belongs to a different vehicle');
      }

      const labourCost = round2(num(dto.labourCost));
      const partsCost = round2(num(dto.partsCost));
      const totalCost = dto.totalCost !== undefined ? round2(num(dto.totalCost)) : round2(labourCost + partsCost);

      const jobNo = await this.numbering.next(m, tenantId, 'maintenance_job', 'MNT-');
      const repo = m.getRepository(VehicleMaintenanceJob);
      const job = await repo.save(
        repo.create({
          tenantId, jobNo, vehicleId, scheduleId, jobType,
          reportedDate: (dto.reportedDate as string) ?? todayIso(),
          completedDate: (dto.completedDate as string) ?? null,
          odometer: numOrNull(dto.odometer) === null ? null : String(numOrNull(dto.odometer)),
          vendorName: (dto.vendorName as string) ?? null,
          labourCost: String(labourCost), partsCost: String(partsCost), totalCost: String(totalCost),
          downtimeHours: numOrNull(dto.downtimeHours) === null ? null : String(numOrNull(dto.downtimeHours)),
          description: (dto.description as string) ?? null,
          status: 'open',
        }),
      );
      return job;
    });
  }

  /**
   * Complete a job: stamps the completion date/odometer and, when a schedule is
   * linked, advances it (last-service anchor → this job, next-due recomputed).
   * Audited.
   */
  async complete(tenantId: string, id: string, userId: string, dto: Record<string, unknown> = {}) {
    const { job, scheduleAdvanced } = await this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(VehicleMaintenanceJob);
      const job = await repo.findOne({ where: { id } });
      if (!job) throw notFound();
      if (job.status === 'completed') throw badReq('Job already completed');
      if (job.status === 'cancelled') throw badReq('Cannot complete a cancelled job');

      const completedDate = (dto.completedDate as string) ?? job.completedDate ?? todayIso();
      const odometer = dto.odometer !== undefined ? numOrNull(dto.odometer) : numOrNull(job.odometer);
      await repo.update(id, {
        status: 'completed',
        completedDate,
        odometer: odometer === null ? null : String(odometer),
      });

      let scheduleAdvanced = false;
      if (job.scheduleId) {
        const schedRepo = m.getRepository(VehicleServiceSchedule);
        const sched = await schedRepo.findOne({ where: { id: job.scheduleId } });
        if (sched) {
          const baseOdometer = odometer ?? numOrNull(sched.lastServiceOdometer);
          const { nextDueOdometer, nextDueDate } = computeNextDue({
            baseOdometer,
            baseDate: completedDate,
            intervalKm: sched.intervalKm,
            intervalDays: sched.intervalDays,
          });
          await schedRepo.update(sched.id, {
            lastServiceOdometer: baseOdometer === null ? sched.lastServiceOdometer : String(baseOdometer),
            lastServiceDate: completedDate,
            nextDueOdometer: nextDueOdometer === null ? null : String(nextDueOdometer),
            nextDueDate,
          });
          scheduleAdvanced = true;
        }
      }

      const fresh = await repo.findOne({ where: { id } });
      return { job: fresh as VehicleMaintenanceJob, scheduleAdvanced };
    });

    await this.audit.record({
      tenantId, actorUserId: userId, action: AUDIT_ACTIONS.VEHICLE_MAINTENANCE_COMPLETE,
      entityType: 'vehicle_maintenance_job', entityId: id, entityLabel: job.jobNo,
      summary: `Completed ${job.jobType} job ${job.jobNo} (₹${job.totalCost})${scheduleAdvanced ? ' — schedule advanced' : ''}`,
      details: { jobType: job.jobType, totalCost: job.totalCost, odometer: job.odometer, scheduleAdvanced },
    });
    return job;
  }

  /** Cancel an open job (never a completed one). */
  cancel(tenantId: string, id: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(VehicleMaintenanceJob);
      const job = await repo.findOne({ where: { id } });
      if (!job) throw notFound();
      if (job.status === 'completed') throw badReq('Cannot cancel a completed job');
      if (job.status === 'cancelled') throw badReq('Job already cancelled');
      await repo.update(id, { status: 'cancelled' });
      return repo.findOne({ where: { id } });
    });
  }
}
