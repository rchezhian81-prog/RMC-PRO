import { Column, Entity } from 'typeorm';
import type { TenantStatus } from '@rmc/shared';
import { BaseUuidEntity } from './base.entity';

/** Platform-level: one RMC company on the SaaS platform (Design Doc 6 §4.1). No tenant_id. */
@Entity('tenants')
export class Tenant extends BaseUuidEntity {
  @Column({ name: 'tenant_code', type: 'varchar', unique: true })
  tenantCode!: string;

  @Column({ name: 'tenant_name', type: 'varchar' })
  tenantName!: string;

  @Column({ name: 'legal_name', type: 'varchar', nullable: true })
  legalName!: string | null;

  @Column({ name: 'status', type: 'varchar', default: 'active' })
  status!: TenantStatus;

  @Column({ name: 'default_language', type: 'varchar', default: 'en' })
  defaultLanguage!: string;
}
