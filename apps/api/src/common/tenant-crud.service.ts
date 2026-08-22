import { BadRequestException, NotFoundException } from '@nestjs/common';
import type {
  DeepPartial,
  EntityTarget,
  FindManyOptions,
  FindOptionsWhere,
  ObjectLiteral,
} from 'typeorm';
import { TenantDbService } from '../core/database/tenant-db.service';

export interface CrudOpts {
  orderBy?: string;
  required?: string[];
  /**
   * Field/value written on a soft delete (deactivate). Defaults to
   * status='inactive'; entities without a `status` column (e.g. number series)
   * override it, e.g. { field: 'isActive', value: false }.
   */
  softDelete?: { field: string; value: unknown };
  /**
   * Hard-delete (row removed) instead of soft-delete. For config rows that no
   * transaction references and that have no status column to flip — e.g. a UOM
   * conversion, where a soft-delete would write a non-existent `status` column
   * and 500, and a wrong conversion otherwise could never be removed.
   */
  hardDelete?: boolean;
}

/**
 * Generic tenant-scoped CRUD, run inside the tenant's RLS context so every
 * read/write is confined to the caller's tenant. Reused by all Sprint-3 masters.
 */
export class TenantCrudService<T extends ObjectLiteral> {
  constructor(
    protected readonly db: TenantDbService,
    protected readonly entity: EntityTarget<T>,
    protected readonly opts: CrudOpts = {},
  ) {}

  list(tenantId: string): Promise<T[]> {
    const options = (
      this.opts.orderBy ? { order: { [this.opts.orderBy]: 'ASC' } } : {}
    ) as FindManyOptions<T>;
    return this.db.runInTenant(tenantId, (m) => m.getRepository(this.entity).find(options));
  }

  get(tenantId: string, id: string): Promise<T> {
    return this.db.runInTenant(tenantId, async (m) => {
      const row = await m
        .getRepository(this.entity)
        .findOne({ where: { id } as unknown as FindOptionsWhere<T> });
      if (!row) throw new NotFoundException({ code: 'RECORD_NOT_FOUND', message: 'Not found' });
      return row;
    });
  }

  /**
   * Per-entity field validation hook, run before create and update. Default is
   * a no-op; masters override it to reject bad GSTIN / negative amounts / etc.
   * Throw via {@link fieldErrors} so the failure carries a per-field map.
   */
  protected validateWrite(_dto: Record<string, unknown>): void {}

  create(tenantId: string, dto: Record<string, unknown>): Promise<T> {
    const missing = (this.opts.required ?? []).filter(
      (k) => dto[k] === undefined || dto[k] === null || dto[k] === '',
    );
    if (missing.length) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: `Missing required: ${missing.join(', ')}`,
        fields: Object.fromEntries(missing.map((k) => [k, 'This field is required.'])),
      });
    }
    this.validateWrite(dto);
    return this.db.runInTenant(tenantId, (m) => {
      const repo = m.getRepository(this.entity);
      const entity = repo.create({ ...dto, tenantId } as unknown as DeepPartial<T>);
      return repo.save(entity);
    });
  }

  update(tenantId: string, id: string, dto: Record<string, unknown>): Promise<T> {
    this.validateWrite(dto);
    return this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(this.entity);
      const row = await repo.findOne({ where: { id } as unknown as FindOptionsWhere<T> });
      if (!row) throw new NotFoundException({ code: 'RECORD_NOT_FOUND', message: 'Not found' });
      const rest = { ...dto };
      delete rest.tenantId;
      delete rest.id;
      await repo.update(id, rest as any);
      return (await repo.findOne({ where: { id } as unknown as FindOptionsWhere<T> })) as T;
    });
  }

  /**
   * Soft delete: mark the record inactive rather than removing it, so records
   * referenced by transactions (a material used in a mix, a customer with
   * invoices) are never orphaned. Reversible by editing the record's status.
   */
  deactivate(tenantId: string, id: string): Promise<T> {
    const field = this.opts.softDelete?.field ?? 'status';
    const value = this.opts.softDelete?.value ?? 'inactive';
    return this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(this.entity);
      const row = await repo.findOne({ where: { id } as unknown as FindOptionsWhere<T> });
      if (!row) throw new NotFoundException({ code: 'RECORD_NOT_FOUND', message: 'Not found' });
      if (this.opts.hardDelete) {
        // No status column to flip — remove the row and return what was deleted.
        await repo.delete(id);
        return row;
      }
      await repo.update(id, { [field]: value } as any);
      return (await repo.findOne({ where: { id } as unknown as FindOptionsWhere<T> })) as T;
    });
  }
}
