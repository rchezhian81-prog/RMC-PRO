import { Injectable } from '@nestjs/common';
import { TenantCrudService } from '../common/tenant-crud.service';
import { TenantDbService } from '../core/database/tenant-db.service';
import { Plant } from '../core/database/entities';

/** Plant setup master (Design Doc 6 §5.3), tenant-scoped via RLS. */
@Injectable()
export class PlantsService extends TenantCrudService<Plant> {
  constructor(db: TenantDbService) {
    super(db, Plant, { orderBy: 'plantCode', required: ['plantCode', 'plantName'] });
  }
}
