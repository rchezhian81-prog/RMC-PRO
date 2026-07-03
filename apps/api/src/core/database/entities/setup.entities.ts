import { Column, Entity } from 'typeorm';
import { TenantScopedEntity } from './base.entity';

/** Company inside a tenant (Design Doc 6 §5.1) — trimmed for the Phase-1 foundation. */
@Entity('companies')
export class Company extends TenantScopedEntity {
  @Column({ name: 'company_name', type: 'varchar' })
  companyName!: string;

  @Column({ name: 'gstin', type: 'varchar', nullable: true })
  gstin!: string | null;

  @Column({ name: 'state', type: 'varchar', nullable: true })
  state!: string | null;
}

/** Plant (Design Doc 6 §5.3) — trimmed for the Phase-1 foundation; RLS-enforced. */
@Entity('plants')
export class Plant extends TenantScopedEntity {
  @Column({ name: 'company_id', type: 'uuid', nullable: true })
  companyId!: string | null;

  @Column({ name: 'plant_code', type: 'varchar' })
  plantCode!: string;

  @Column({ name: 'plant_name', type: 'varchar' })
  plantName!: string;

  @Column({ name: 'city', type: 'varchar', nullable: true })
  city!: string | null;

  @Column({ name: 'status', type: 'varchar', default: 'active' })
  status!: string;
}
