import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../auth/auth-user';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../rbac/tenant.guard';
import { RequireModule } from '../rbac/module.decorator';
import { PermissionsGuard } from '../rbac/permissions.guard';
import { RequirePermissions } from '../rbac/permissions.decorator';
import { QcService } from './qc.service';

const tid = (u: AuthUser) => u.tenantId as string;

@Controller('qc')
@RequireModule('qc')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class QcController {
  constructor(private readonly service: QcService) {}

  @Get('cube-register') @RequirePermissions('qc.view')
  cubeRegister(@CurrentUser() u: AuthUser, @Query('from') from?: string, @Query('to') to?: string) {
    return this.service.cubeRegister(tid(u), from, to);
  }

  @Get('slump-register') @RequirePermissions('qc.view')
  slumpRegister(@CurrentUser() u: AuthUser, @Query('from') from?: string, @Query('to') to?: string) {
    return this.service.slumpRegister(tid(u), from, to);
  }

  @Get('slump-tests') @RequirePermissions('qc.view')
  listSlump(@CurrentUser() u: AuthUser) { return this.service.listSlump(tid(u)); }

  @Get('slump-tests/:id') @RequirePermissions('qc.view')
  getSlump(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.service.getSlump(tid(u), id); }

  @Post('slump-tests') @RequirePermissions('qc.record')
  createSlump(@CurrentUser() u: AuthUser, @Body() dto: Record<string, unknown>) {
    return this.service.createSlump(tid(u), dto, u.userId);
  }

  @Get('cube-sets') @RequirePermissions('qc.view')
  listCubeSets(@CurrentUser() u: AuthUser, @Query('status') status?: string) {
    return this.service.listCubeSets(tid(u), status);
  }

  @Get('cube-sets/:id') @RequirePermissions('qc.view')
  getCubeSet(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.service.getCubeSet(tid(u), id); }

  @Post('cube-sets') @RequirePermissions('qc.record')
  createCubeSet(@CurrentUser() u: AuthUser, @Body() dto: Record<string, unknown>) {
    return this.service.createCubeSet(tid(u), dto);
  }

  @Post('cube-sets/:id/results') @RequirePermissions('qc.record')
  recordResults(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: Record<string, unknown>) {
    return this.service.recordCubeResults(tid(u), id, dto);
  }
}
