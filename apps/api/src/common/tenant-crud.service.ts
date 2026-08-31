import { BadRequestException, NotFoundException } from '@nestjs/common';
import type {
  DeepPartial,
  EntityTarget,
  FindManyOptions,
  FindOptionsWhere,
  ObjectLiteral,
} from 'typeorm';
import { TenantDbService } from '../core/database/tenant-db.service';
import { AuditService, AUDIT_ACTIONS } from '../audit/audit.service';

export interface CrudOpts {
  orderBy?: string;
  required?: string[];
  /**
   * Audit label for this master (e.g. 'customer'). When set AND an AuditService
   * is supplied, create/update/deactivate/reactivate are written to the audit
   * trail — a customer credit-limit change, a supplier GSTIN edit, etc. left no
   * record before. Omit to leave a master unaudited.
   */
  resource?: string;
  /** Row field used as the human label in the audit entry (e.g. 'customerName'). */
  labelField?: string;
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
    protected readonly audit?: AuditService,
  ) {}

  /** Write a master mutation to the audit trail when this master is audited. */
  private async recordAudit(
    tenantId: string,
    userId: string | null | undefined,
    action: string,
    row: T | null,
    verb: string,
    details?: Record<string, unknown>,
  ): Promise<void> {
    if (!this.audit || !this.opts.resource) return;
    const r = row as Record<string, unknown> | null;
    const label = r && this.opts.labelField ? (r[this.opts.labelField] as string | undefined) ?? null : null;
    await this.audit.record({
      tenantId,
      actorUserId: userId ?? null,
      action,
      entityType: this.opts.resource,
      entityId: r?.id ? String(r.id) : null,
      entityLabel: label,
      summary: `${verb} ${this.opts.resource}${label ? ` ${label}` : ''}`.trim(),
      details,
    });
  }

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

  async create(tenantId: string, dto: Record<string, unknown>, userId?: string | null): Promise<T> {
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
    const saved = await this.db.runInTenant(tenantId, (m) => {
      const repo = m.getRepository(this.entity);
      const entity = repo.create({ ...dto, tenantId } as unknown as DeepPartial<T>);
      return repo.save(entity);
    });
    await this.recordAudit(tenantId, userId, AUDIT_ACTIONS.MASTER_CREATE, saved, 'Created');
    return saved;
  }

  async update(tenantId: string, id: string, dto: Record<string, unknown>, userId?: string | null): Promise<T> {
    this.validateWrite(dto);
    const result = await this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(this.entity);
      const row = await repo.findOne({ where: { id } as unknown as FindOptionsWhere<T> });
      if (!row) throw new NotFoundException({ code: 'RECORD_NOT_FOUND', message: 'Not found' });
      const rest = { ...dto };
      delete rest.tenantId;
      delete rest.id;
      await repo.update(id, rest as any);
      return (await repo.findOne({ where: { id } as unknown as FindOptionsWhere<T> })) as T;
    });
    const changed = Object.keys(dto).filter((k) => k !== 'tenantId' && k !== 'id');
    await this.recordAudit(tenantId, userId, AUDIT_ACTIONS.MASTER_UPDATE, result, 'Updated', { fields: changed });
    return result;
  }

  /**
   * Soft delete: mark the record inactive rather than removing it, so records
   * referenced by transactions (a material used in a mix, a customer with
   * invoices) are never orphaned. Reversible by editing the record's status.
   */
  async deactivate(tenantId: string, id: string, userId?: string | null): Promise<T> {
    const field = this.opts.softDelete?.field ?? 'status';
    const value = this.opts.softDelete?.value ?? 'inactive';
    const result = await this.db.runInTenant(tenantId, async (m) => {
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
    await this.recordAudit(tenantId, userId, AUDIT_ACTIONS.MASTER_DEACTIVATE, result, this.opts.hardDelete ? 'Deleted' : 'Deactivated');
    return result;
  }

  /**
   * Reverse of {@link deactivate}: flip a soft-deleted row back to active, so a
   * mistakenly-deactivated record isn't stranded. The active value is the
   * inverse of the soft-delete value (false→true for a boolean flag, else the
   * 'active' status). Hard-delete entities have nothing to restore.
   */
  async reactivate(tenantId: string, id: string, userId?: string | null): Promise<T> {
    if (this.opts.hardDelete) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'This record was permanently removed and cannot be reactivated.',
      });
    }
    const field = this.opts.softDelete?.field ?? 'status';
    const sd = this.opts.softDelete?.value;
    const activeValue = typeof sd === 'boolean' ? !sd : 'active';
    const result = await this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(this.entity);
      const row = await repo.findOne({ where: { id } as unknown as FindOptionsWhere<T> });
      if (!row) throw new NotFoundException({ code: 'RECORD_NOT_FOUND', message: 'Not found' });
      await repo.update(id, { [field]: activeValue } as any);
      return (await repo.findOne({ where: { id } as unknown as FindOptionsWhere<T> })) as T;
    });
    await this.recordAudit(tenantId, userId, AUDIT_ACTIONS.MASTER_REACTIVATE, result, 'Reactivated');
    return result;
  }
}
