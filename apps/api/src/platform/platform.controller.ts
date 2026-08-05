import { Body, Controller, Get, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SuperAdminGuard } from '../rbac/super-admin.guard';
import { PlatformService } from './platform.service';
import {
  AssignPlanDto,
  CreatePlanDto,
  CreateTenantDto,
  CreateTenantUserDto,
  SetPlanModulesDto,
  SetTenantModuleDto,
  UpdatePlanDto,
  UpdateTenantDto,
} from './dto/platform.dto';

@Controller('platform')
@UseGuards(JwtAuthGuard, SuperAdminGuard)
export class PlatformController {
  constructor(private readonly svc: PlatformService) {}

  // ---- Tenants ----
  @Get('tenants')
  listTenants() {
    return this.svc.listTenants();
  }

  @Post('tenants')
  createTenant(@Body() dto: CreateTenantDto) {
    return this.svc.createTenant(dto);
  }

  @Get('tenants/:id')
  getTenant(@Param('id') id: string) {
    return this.svc.getTenant(id);
  }

  @Patch('tenants/:id')
  updateTenant(@Param('id') id: string, @Body() dto: UpdateTenantDto) {
    return this.svc.updateTenant(id, dto);
  }

  @Post('tenants/:id/assign-plan')
  assignPlan(@Param('id') id: string, @Body() dto: AssignPlanDto) {
    return this.svc.assignPlan(id, dto.planId);
  }

  @Get('tenants/:id/modules')
  tenantModules(@Param('id') id: string) {
    return this.svc.getTenantModules(id);
  }

  @Get('tenants/:id/users')
  listTenantUsers(@Param('id') id: string) {
    return this.svc.listTenantUsers(id);
  }

  @Post('tenants/:id/users')
  createTenantUser(@Param('id') id: string, @Body() dto: CreateTenantUserDto) {
    return this.svc.createTenantUser(id, dto);
  }

  @Put('tenants/:id/modules/:moduleKey')
  setTenantModule(
    @Param('id') id: string,
    @Param('moduleKey') moduleKey: string,
    @Body() dto: SetTenantModuleDto,
  ) {
    return this.svc.setTenantModule(id, moduleKey, dto.isEnabled);
  }

  // ---- Plans ----
  @Get('plans')
  listPlans() {
    return this.svc.listPlans();
  }

  @Post('plans')
  createPlan(@Body() dto: CreatePlanDto) {
    return this.svc.createPlan(dto);
  }

  @Get('plans/:id')
  getPlan(@Param('id') id: string) {
    return this.svc.getPlan(id);
  }

  @Patch('plans/:id')
  updatePlan(@Param('id') id: string, @Body() dto: UpdatePlanDto) {
    return this.svc.updatePlan(id, dto);
  }

  @Put('plans/:id/modules')
  setPlanModules(@Param('id') id: string, @Body() dto: SetPlanModulesDto) {
    return this.svc.setPlanModules(id, dto.moduleKeys);
  }

  // ---- Module catalog ----
  @Get('modules')
  listModules() {
    return this.svc.listModules();
  }
}
