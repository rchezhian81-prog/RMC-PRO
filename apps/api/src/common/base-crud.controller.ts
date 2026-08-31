import { Body, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import type { ObjectLiteral } from 'typeorm';
import { CurrentUser, type AuthUser } from '../auth/auth-user';
import { TenantCrudService } from './tenant-crud.service';

/**
 * Inherited CRUD routes for tenant-scoped masters. Concrete controllers set
 * @Controller(path) + guards and supply the service. tenantId is guaranteed by
 * TenantGuard.
 */
export abstract class BaseCrudController<T extends ObjectLiteral> {
  protected abstract service: TenantCrudService<T>;

  @Get()
  list(@CurrentUser() u: AuthUser, @Query('active') active?: string) {
    // ?active=true returns only active rows (pick-lists); default returns all.
    return this.service.list(u.tenantId as string, active === 'true');
  }

  @Get(':id')
  getOne(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.service.get(u.tenantId as string, id);
  }

  @Post()
  create(@CurrentUser() u: AuthUser, @Body() dto: Record<string, unknown>) {
    return this.service.create(u.tenantId as string, dto, u.userId);
  }

  @Patch(':id')
  update(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body() dto: Record<string, unknown>,
  ) {
    return this.service.update(u.tenantId as string, id, dto, u.userId);
  }

  /** Soft delete (deactivate) — see TenantCrudService.deactivate. */
  @Delete(':id')
  remove(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.service.deactivate(u.tenantId as string, id, u.userId);
  }

  /** Restore a deactivated record — the inverse of remove. PATCH so the crud
   * permission guard treats it as an edit, not a create. */
  @Patch(':id/reactivate')
  reactivate(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.service.reactivate(u.tenantId as string, id, u.userId);
  }
}
