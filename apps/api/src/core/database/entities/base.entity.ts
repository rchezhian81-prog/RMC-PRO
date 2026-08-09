import {
  CreateDateColumn,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  Column,
} from 'typeorm';

/** Common id + timestamps (Design Doc 6 §2.3). */
export abstract class BaseUuidEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

/** Adds tenant_id for tenant-scoped tables (RLS-enforced). */
export abstract class TenantScopedEntity extends BaseUuidEntity {
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;
}
