import { Column, Entity, Unique } from 'typeorm';
import { TenantScopedEntity } from './base.entity';

/**
 * Fleet maintenance & fuel log (Plan D3). Builds on D1's `vehicles` master with
 * the running upkeep of mixers & pumps: preventive service schedules (due by km
 * and/or by date), maintenance / breakdown / repair jobs with their cost, and a
 * fuel (diesel) log that yields km-per-litre and cost-per-km. All tenant-scoped
 * under the same FORCE-RLS policy as the rest of the schema; money columns
 * numeric(14,2), odometer/quantity numeric with one/two decimals.
 */

/**
 * A preventive-service schedule for one vehicle + service type (e.g. engine oil
 * every 10,000 km, general service every 90 days). Carries the last-service
 * anchor and the computed next-due (odometer and/or date); completing a linked
 * maintenance job rolls the anchor forward and recomputes the next-due.
 */
@Entity('vehicle_service_schedules')
export class VehicleServiceSchedule extends TenantScopedEntity {
  @Column({ name: 'vehicle_id', type: 'uuid' }) vehicleId!: string;
  /** engine_oil | general | tyre | fitness | gearbox | … (free text, tenant-defined). */
  @Column({ name: 'service_type', type: 'varchar' }) serviceType!: string;
  @Column({ name: 'interval_km', type: 'int', nullable: true }) intervalKm!: number | null;
  @Column({ name: 'interval_days', type: 'int', nullable: true }) intervalDays!: number | null;
  @Column({ name: 'last_service_odometer', type: 'numeric', precision: 12, scale: 1, nullable: true }) lastServiceOdometer!: string | null;
  @Column({ name: 'last_service_date', type: 'date', nullable: true }) lastServiceDate!: string | null;
  @Column({ name: 'next_due_odometer', type: 'numeric', precision: 12, scale: 1, nullable: true }) nextDueOdometer!: string | null;
  @Column({ name: 'next_due_date', type: 'date', nullable: true }) nextDueDate!: string | null;
  @Column({ name: 'is_active', type: 'boolean', default: true }) isActive!: boolean;
  @Column({ name: 'remarks', type: 'varchar', nullable: true }) remarks!: string | null;
}

/**
 * A maintenance event on a vehicle — a scheduled service, an ad-hoc repair, or a
 * breakdown. `job_type` distinguishes them; a breakdown carries downtime hours.
 * Cost is split labour / parts and rolled to a total. Completing a job that
 * links a schedule advances that schedule.
 */
@Entity('vehicle_maintenance_jobs')
@Unique('uq_vehicle_maintenance_jobs_no', ['tenantId', 'jobNo'])
export class VehicleMaintenanceJob extends TenantScopedEntity {
  @Column({ name: 'job_no', type: 'varchar' }) jobNo!: string;
  @Column({ name: 'vehicle_id', type: 'uuid' }) vehicleId!: string;
  /** Optional link to the service schedule this job fulfils (advanced on completion). */
  @Column({ name: 'schedule_id', type: 'uuid', nullable: true }) scheduleId!: string | null;
  /** service | repair | breakdown. */
  @Column({ name: 'job_type', type: 'varchar', default: 'service' }) jobType!: string;
  @Column({ name: 'reported_date', type: 'date', nullable: true }) reportedDate!: string | null;
  @Column({ name: 'completed_date', type: 'date', nullable: true }) completedDate!: string | null;
  @Column({ name: 'odometer', type: 'numeric', precision: 12, scale: 1, nullable: true }) odometer!: string | null;
  @Column({ name: 'vendor_name', type: 'varchar', nullable: true }) vendorName!: string | null;
  @Column({ name: 'labour_cost', type: 'numeric', precision: 14, scale: 2, default: 0 }) labourCost!: string;
  @Column({ name: 'parts_cost', type: 'numeric', precision: 14, scale: 2, default: 0 }) partsCost!: string;
  @Column({ name: 'total_cost', type: 'numeric', precision: 14, scale: 2, default: 0 }) totalCost!: string;
  /** Hours the vehicle was off the road (breakdowns / repairs). */
  @Column({ name: 'downtime_hours', type: 'numeric', precision: 10, scale: 1, nullable: true }) downtimeHours!: string | null;
  @Column({ name: 'description', type: 'varchar', nullable: true }) description!: string | null;
  /** open → completed; or cancelled. */
  @Column({ name: 'status', type: 'varchar', default: 'open' }) status!: string;
}

/**
 * One fuel (diesel) fill for a vehicle. When the previous full-tank reading is
 * known, the service fills in `distance_km` and `km_per_litre` on save so a
 * per-vehicle mileage / cost-per-km report needs no recomputation.
 */
@Entity('vehicle_fuel_logs')
export class VehicleFuelLog extends TenantScopedEntity {
  @Column({ name: 'vehicle_id', type: 'uuid' }) vehicleId!: string;
  @Column({ name: 'fuel_date', type: 'date', nullable: true }) fuelDate!: string | null;
  @Column({ name: 'odometer', type: 'numeric', precision: 12, scale: 1, default: 0 }) odometer!: string;
  @Column({ name: 'fuel_type', type: 'varchar', default: 'diesel' }) fuelType!: string;
  @Column({ name: 'quantity_litres', type: 'numeric', precision: 12, scale: 2, default: 0 }) quantityLitres!: string;
  @Column({ name: 'rate_per_litre', type: 'numeric', precision: 10, scale: 2, default: 0 }) ratePerLitre!: string;
  @Column({ name: 'amount', type: 'numeric', precision: 14, scale: 2, default: 0 }) amount!: string;
  /** A full tank closes a measurement interval; partial fills don't yield mileage. */
  @Column({ name: 'is_tank_full', type: 'boolean', default: true }) isTankFull!: boolean;
  @Column({ name: 'station', type: 'varchar', nullable: true }) station!: string | null;
  /** Distance since the previous full-tank fill (computed on save). */
  @Column({ name: 'distance_km', type: 'numeric', precision: 12, scale: 1, nullable: true }) distanceKm!: string | null;
  /** distance_km / quantity_litres for this interval (computed on save). */
  @Column({ name: 'km_per_litre', type: 'numeric', precision: 10, scale: 2, nullable: true }) kmPerLitre!: string | null;
  @Column({ name: 'remarks', type: 'varchar', nullable: true }) remarks!: string | null;
}
