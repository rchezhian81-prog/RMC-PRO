import { Injectable } from '@nestjs/common';
import { TenantDbService } from '../core/database/tenant-db.service';
import { Plant } from '../core/database/entities';

/** Reads plants strictly within the caller's tenant (RLS-enforced). */
@Injectable()
export class PlantsService {
  constructor(private readonly db: TenantDbService) {}

  list(tenantId: string | null): Promise<Plant[]> {
    if (!tenantId) return Promise.resolve([]);
    return this.db.runInTenant(tenantId, (m) =>
      m.getRepository(Plant).find({ order: { plantCode: 'ASC' } }),
    );
  }

  getById(tenantId: string | null, id: string): Promise<Plant | null> {
    if (!tenantId) return Promise.resolve(null);
    return this.db.runInTenant(tenantId, (m) => m.getRepository(Plant).findOne({ where: { id } }));
  }
}
