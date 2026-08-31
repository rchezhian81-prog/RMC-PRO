import { Injectable } from '@nestjs/common';
import { TenantCrudService } from '../common/tenant-crud.service';
import { TenantDbService } from '../core/database/tenant-db.service';
import { PlanLimitsService } from '../rbac/plan-limits.service';
import { AuditService } from '../audit/audit.service';
import { Plant } from '../core/database/entities';

/** Plant setup master (Design Doc 6 §5.3), tenant-scoped via RLS. */
@Injectable()
export class PlantsService extends TenantCrudService<Plant> {
  constructor(
    db: TenantDbService,
    private readonly planLimits: PlanLimitsService,
    audit: AuditService,
  ) {
    super(db, Plant, { orderBy: 'plantCode', required: ['plantCode', 'plantName'], resource: 'plant', labelField: 'plantName' }, audit);
  }

  /** How many plants a tenant may run is what its subscription actually sells. */
  override async create(tenantId: string, dto: Record<string, unknown>, userId?: string | null): Promise<Plant> {
    await this.planLimits.assertCanAddPlant(tenantId);
    return super.create(tenantId, dto, userId);
  }

  /**
   * Bringing a decommissioned plant back takes a slot again, so it is bounded
   * the same way. Checked only on the inactive → active edge, so editing an
   * already-active plant never trips the limit.
   */
  override async update(tenantId: string, id: string, dto: Record<string, unknown>, userId?: string | null): Promise<Plant> {
    if (dto.status !== undefined && String(dto.status) === 'active') {
      const current = await this.get(tenantId, id);
      if (current.status !== 'active') await this.planLimits.assertCanAddPlant(tenantId);
    }
    return super.update(tenantId, id, dto, userId);
  }
}
