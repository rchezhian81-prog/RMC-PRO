import { Column, Entity } from 'typeorm';
import { TenantScopedEntity } from './base.entity';

/**
 * GPS tracking (Plan: activate the `gps` module). A location ping for an
 * in-transit dispatch — the truck's position over time — so the dispatch board
 * can show where each load is and replay its track. Tenant-scoped under the same
 * FORCE-RLS policy; the latest ping is also denormalised onto `dispatches`
 * (last_latitude / last_longitude / last_location_at) for a cheap board read.
 */
@Entity('dispatch_location_pings')
export class DispatchLocationPing extends TenantScopedEntity {
  @Column({ name: 'dispatch_id', type: 'uuid' }) dispatchId!: string;
  @Column({ name: 'vehicle_id', type: 'uuid', nullable: true }) vehicleId!: string | null;
  @Column({ name: 'latitude', type: 'numeric', precision: 10, scale: 6 }) latitude!: string;
  @Column({ name: 'longitude', type: 'numeric', precision: 10, scale: 6 }) longitude!: string;
  @Column({ name: 'speed_kmph', type: 'numeric', precision: 6, scale: 2, nullable: true }) speedKmph!: string | null;
  @Column({ name: 'heading', type: 'numeric', precision: 6, scale: 2, nullable: true }) heading!: string | null;
  @Column({ name: 'accuracy_m', type: 'numeric', precision: 8, scale: 2, nullable: true }) accuracyM!: string | null;
  /** Where the fix came from: device | gps | manual. */
  @Column({ name: 'source', type: 'varchar', default: 'device' }) source!: string;
  @Column({ name: 'recorded_at', type: 'timestamptz', nullable: true }) recordedAt!: Date | null;
}
