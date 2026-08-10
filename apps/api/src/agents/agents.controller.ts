import { Body, Controller, Get, Post, Put, Query, UseGuards } from '@nestjs/common';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../rbac/tenant.guard';
import { PermissionsGuard } from '../rbac/permissions.guard';
import { RequirePermissions } from '../rbac/permissions.decorator';
import { CurrentUser, type AuthUser } from '../auth/auth-user';
import { AgentGovernorService } from './agent-governor.service';
import { AgentKernelService } from './agent-kernel.service';
import { ToolRegistryService } from './tool-registry.service';
import { AGENT_DIAGNOSTICS } from './diagnostics.agent';
import { AGENT_DATA_ANALYSIS } from './data-analysis.agent';
import { AGENT_MONITOR } from './monitor.agent';
import { AGENT_SPECIALIST } from './specialist.agent';
import { AGENT_CUSTOMER_SERVICE } from './customer-service.agent';

class SetControlsDto {
  /** The kill switch: true pauses all agent runs for this tenant. */
  @IsOptional() @IsBoolean() automationPaused?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(10000) maxStepsPerRun?: number;
  @IsOptional() @IsInt() @Min(0) @Max(1000) maxActionsPerRun?: number;
}

class RunDiagnosticsDto {
  @IsOptional() @IsString() @MaxLength(200) msg?: string;
  @IsOptional() @IsBoolean() mark?: boolean;
  @IsOptional() @IsBoolean() tryPayment?: boolean;
  @IsOptional() @IsBoolean() tryUnknownTool?: boolean;
  @IsOptional() @IsBoolean() tryEscalate?: boolean;
}

class RunAnalysisDto {
  @IsOptional() @IsInt() @Min(1) @Max(365) windowDays?: number;
  @IsOptional() @IsInt() @Min(1) @Max(50) topN?: number;
}

class RunMonitorDto {
  @IsOptional() @IsInt() @Min(0) @Max(100_000_000) stockThreshold?: number;
  /** When set, Monitor escalates to the Specialist for a cited AR-risk assessment. */
  @IsOptional() @IsBoolean() consultSpecialist?: boolean;
}

class RunSpecialistDto {
  @IsOptional() @IsIn(['all', 'compliance', 'ar_risk']) topic?: string;
  @IsOptional() @IsInt() @Min(1) @Max(365) windowDays?: number;
}

class RunCustomerServiceDto {
  /** Customer scope is mandatory — a CS run always acts for one named customer. */
  @IsUUID() customerId!: string;
  @IsOptional() @IsIn(['account_summary', 'order_status']) intent?: string;
}

/**
 * Tenant-scoped control surface for the multi-agent substrate (M0). Gated by the
 * new `agents.manage` permission, which only Company Owner / Company Admin hold —
 * the kill switch and per-run budgets are a tenant-admin control. There is no
 * cross-tenant access here: every method acts on the caller's own tenant, and
 * the services underneath run inside `runInTenant`, so RLS confines them.
 */
@Controller('agents')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
@RequirePermissions('agents.manage')
export class AgentsController {
  constructor(
    private readonly governor: AgentGovernorService,
    private readonly kernel: AgentKernelService,
    private readonly registry: ToolRegistryService,
  ) {}

  /** The registered agents and their tool allow-lists (the security contract). */
  @Get('catalog')
  catalog() {
    return this.registry.listAgents();
  }

  /** Current kill-switch + budget settings for this tenant. */
  @Get('controls')
  getControls(@CurrentUser() u: AuthUser) {
    return this.governor.getControls(u.tenantId as string);
  }

  /** Flip the kill switch and/or adjust the per-run budgets. */
  @Put('controls')
  setControls(@CurrentUser() u: AuthUser, @Body() dto: SetControlsDto) {
    return this.governor.setControls(u.tenantId as string, dto, u.userId);
  }

  /** Recent agent runs for this tenant (newest first). */
  @Get('runs')
  listRuns(@CurrentUser() u: AuthUser, @Query('limit') limit?: string) {
    return this.kernel.listRuns(u.tenantId as string, limit ? Number(limit) : 50);
  }

  /** Run the M0 substrate self-test through the full guardrail funnel. */
  @Post('diagnostics/run')
  runDiagnostics(@CurrentUser() u: AuthUser, @Body() dto: RunDiagnosticsDto) {
    return this.kernel.runTask({
      tenantId: u.tenantId as string,
      agentName: AGENT_DIAGNOSTICS,
      actorUserId: u.userId,
      taskKind: 'diagnostics',
      input: { ...dto },
    });
  }

  /** Run the read-only Data-Analysis agent: KPI snapshot + top customers. */
  @Post('data-analysis/run')
  runAnalysis(@CurrentUser() u: AuthUser, @Body() dto: RunAnalysisDto) {
    return this.kernel.runTask({
      tenantId: u.tenantId as string,
      agentName: AGENT_DATA_ANALYSIS,
      actorUserId: u.userId,
      taskKind: 'data-analysis',
      input: { ...dto },
    });
  }

  /** Run the read-only Monitor agent: operational threshold checks → alerts. */
  @Post('monitor/run')
  runMonitor(@CurrentUser() u: AuthUser, @Body() dto: RunMonitorDto) {
    return this.kernel.runTask({
      tenantId: u.tenantId as string,
      agentName: AGENT_MONITOR,
      actorUserId: u.userId,
      taskKind: 'monitor',
      input: { ...dto },
    });
  }

  /** Run the read-only Specialist agent: cited advisory (compliance / AR risk). */
  @Post('specialist/run')
  runSpecialist(@CurrentUser() u: AuthUser, @Body() dto: RunSpecialistDto) {
    return this.kernel.runTask({
      tenantId: u.tenantId as string,
      agentName: AGENT_SPECIALIST,
      actorUserId: u.userId,
      taskKind: 'specialist',
      input: { ...dto },
    });
  }

  /**
   * Run the customer-scoped, read-only Customer-Service agent for ONE customer.
   * `customerId` is mandatory; every tool filters by it (customer-scoping on top
   * of tenant RLS). Outbound messaging and order placement are out of scope here.
   */
  @Post('customer-service/run')
  runCustomerService(@CurrentUser() u: AuthUser, @Body() dto: RunCustomerServiceDto) {
    return this.kernel.runTask({
      tenantId: u.tenantId as string,
      agentName: AGENT_CUSTOMER_SERVICE,
      actorUserId: u.userId,
      taskKind: 'customer-service',
      input: { ...dto },
    });
  }
}
