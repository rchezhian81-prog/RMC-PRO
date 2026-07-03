import { Column, Entity, Unique } from 'typeorm';
import { TenantScopedEntity } from './base.entity';

/**
 * Sprint 10 — Offline sync control (Design Doc 6 §16, Doc 8). Registered
 * devices, cloud-issued number reservations (prevent duplicate offline numbers),
 * and offline↔cloud conflicts. The local sync_queue lives in the plant app's
 * SQLite, not here.
 */

/** Registered plant/local device (Doc 6 §16.1). */
@Entity('devices')
@Unique('uq_devices_identifier', ['tenantId', 'deviceIdentifier'])
export class Device extends TenantScopedEntity {
  @Column({ name: 'plant_id', type: 'uuid', nullable: true }) plantId!: string | null;
  @Column({ name: 'device_name', type: 'varchar' }) deviceName!: string;
  @Column({ name: 'device_type', type: 'varchar', default: 'standalone_plant_app' }) deviceType!: string;
  @Column({ name: 'device_identifier', type: 'varchar' }) deviceIdentifier!: string;
  @Column({ name: 'registered_by', type: 'uuid', nullable: true }) registeredBy!: string | null;
  @Column({ name: 'last_seen_at', type: 'timestamptz', nullable: true }) lastSeenAt!: Date | null;
  @Column({ name: 'last_sync_token', type: 'timestamptz', nullable: true }) lastSyncToken!: Date | null;
  @Column({ name: 'status', type: 'varchar', default: 'active' }) status!: string;
}

/** Cloud-issued offline number block (Doc 6 §16.4). */
@Entity('local_number_reservations')
export class LocalNumberReservation extends TenantScopedEntity {
  @Column({ name: 'plant_id', type: 'uuid', nullable: true }) plantId!: string | null;
  @Column({ name: 'device_id', type: 'uuid', nullable: true }) deviceId!: string | null;
  @Column({ name: 'document_type', type: 'varchar' }) documentType!: string;
  @Column({ name: 'prefix', type: 'varchar', nullable: true }) prefix!: string | null;
  @Column({ name: 'padding_length', type: 'int', default: 4 }) paddingLength!: number;
  @Column({ name: 'number_from', type: 'int', default: 0 }) numberFrom!: number;
  @Column({ name: 'number_to', type: 'int', default: 0 }) numberTo!: number;
  @Column({ name: 'used_count', type: 'int', default: 0 }) usedCount!: number;
  @Column({ name: 'status', type: 'varchar', default: 'active' }) status!: string;
}

/** Offline↔cloud conflict (Doc 6 §16.3). */
@Entity('sync_conflicts')
export class SyncConflict extends TenantScopedEntity {
  @Column({ name: 'plant_id', type: 'uuid', nullable: true }) plantId!: string | null;
  @Column({ name: 'device_id', type: 'uuid', nullable: true }) deviceId!: string | null;
  @Column({ name: 'entity_name', type: 'varchar' }) entityName!: string;
  @Column({ name: 'local_id', type: 'varchar', nullable: true }) localId!: string | null;
  @Column({ name: 'cloud_id', type: 'uuid', nullable: true }) cloudId!: string | null;
  @Column({ name: 'local_payload_json', type: 'jsonb', nullable: true }) localPayloadJson!: unknown;
  @Column({ name: 'cloud_payload_json', type: 'jsonb', nullable: true }) cloudPayloadJson!: unknown;
  @Column({ name: 'conflict_reason', type: 'varchar', nullable: true }) conflictReason!: string | null;
  @Column({ name: 'resolution_status', type: 'varchar', default: 'pending' }) resolutionStatus!: string;
  @Column({ name: 'resolved_by', type: 'uuid', nullable: true }) resolvedBy!: string | null;
  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true }) resolvedAt!: Date | null;
}
