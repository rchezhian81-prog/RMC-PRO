import { Column, Entity, Unique } from 'typeorm';
import { TenantScopedEntity } from './base.entity';

/**
 * A pump job: one concrete pump booked to an order / site for a pour, with its
 * operator, the on-site → pumping → done timeline, the quantity pumped, the
 * pump hours and the charge worked out from the job's basis. Tenant-scoped
 * under FORCE RLS like every other operational table.
 *
 *   status: planned → on_site → pumping → completed; planned / on_site → cancelled.
 *   charge_basis: per_m3 | per_hour | fixed | included (the order's rate already
 *                 carries the pump, so the job bills nothing on its own).
 */
@Entity('pump_jobs')
@Unique('uq_pump_jobs_no', ['tenantId', 'jobNo'])
export class PumpJob extends TenantScopedEntity {
  @Column({ name: 'job_no', type: 'varchar' }) jobNo!: string;
  @Column({ name: 'order_id', type: 'uuid', nullable: true }) orderId!: string | null;
  @Column({ name: 'customer_id', type: 'uuid', nullable: true }) customerId!: string | null;
  @Column({ name: 'site_id', type: 'uuid', nullable: true }) siteId!: string | null;
  @Column({ name: 'pump_vehicle_id', type: 'uuid' }) pumpVehicleId!: string;
  @Column({ name: 'operator_driver_id', type: 'uuid', nullable: true }) operatorDriverId!: string | null;
  @Column({ name: 'scheduled_date', type: 'date', nullable: true }) scheduledDate!: string | null;
  /** Planned start as HH:MM (plant local time). */
  @Column({ name: 'scheduled_time', type: 'varchar', nullable: true }) scheduledTime!: string | null;
  @Column({ name: 'arrived_at', type: 'timestamptz', nullable: true }) arrivedAt!: Date | null;
  @Column({ name: 'pumping_start_at', type: 'timestamptz', nullable: true }) pumpingStartAt!: Date | null;
  @Column({ name: 'pumping_end_at', type: 'timestamptz', nullable: true }) pumpingEndAt!: Date | null;
  @Column({ name: 'pumped_quantity_m3', type: 'numeric', precision: 12, scale: 3, default: 0 }) pumpedQuantityM3!: string;
  @Column({ name: 'pump_hours', type: 'numeric', precision: 8, scale: 2, default: 0 }) pumpHours!: string;
  @Column({ name: 'pipeline_length_m', type: 'numeric', precision: 8, scale: 1, nullable: true }) pipelineLengthM!: string | null;
  @Column({ name: 'charge_basis', type: 'varchar', default: 'per_m3' }) chargeBasis!: string;
  @Column({ name: 'rate', type: 'numeric', precision: 14, scale: 2, default: 0 }) rate!: string;
  @Column({ name: 'charge_amount', type: 'numeric', precision: 16, scale: 2, default: 0 }) chargeAmount!: string;
  @Column({ name: 'status', type: 'varchar', default: 'planned' }) status!: string;
  @Column({ name: 'remarks', type: 'varchar', nullable: true }) remarks!: string | null;
  @Column({ name: 'created_by', type: 'uuid', nullable: true }) createdBy!: string | null;
}
