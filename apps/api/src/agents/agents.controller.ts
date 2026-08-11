import { BadRequestException, Body, Controller, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
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
import { AGENT_AUTOMATION } from './automation.agent';
import { ApprovalService } from './approval.service';
import { LlmService } from './llm/llm.service';
import { GstExecutionService } from '../compliance/gst-execution.service';

/**
 * Agents that expose the conversational LLM `/ask` mode. These are the ones whose
 * tools are self-contained (they need no mandatory out-of-band scope like a single
 * customerId): read-only analytics/advisory plus the Automation agent (whose
 * high-risk tools are BLOCKED by policy anyway, so ask can only prepare or read).
 * Diagnostics (internal probe) and Customer-Service (mandatory customer scope)
 * are intentionally excluded.
 */
const ASK_ENABLED_AGENTS = new Set<string>([
  AGENT_DATA_ANALYSIS,
  AGENT_MONITOR,
  AGENT_SPECIALIST,
  AGENT_AUTOMATION,
]);

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

class RunAutomationDto {
  @IsOptional() @IsString() @MaxLength(64) actionKind?: string;
  @IsOptional() @IsString() @MaxLength(200) title?: string;
  @IsOptional() @IsObject() payload?: Record<string, unknown>;
  @IsOptional() @IsIn(['reversible', 'irreversible', 'financial', 'legal', 'safety']) reversibility?: string;
  /** Test/hard-rule path: attempt a financial commit (must be blocked). */
  @IsOptional() @IsBoolean() tryCommit?: boolean;
  /** M5: prepare a compliance payload — generate/cancel an IRN or e-way, or update/extend a live e-way. */
  @IsOptional() @IsIn(['einvoice', 'eway', 'einvoice_cancel', 'eway_cancel', 'eway_update_vehicle', 'eway_extend']) compliance?: string;
  @IsOptional() @IsUUID() invoiceId?: string;
  /** Cancel / update / extend reason code (per-action set; validated again at execute). */
  @IsOptional() @IsIn(['1', '2', '3', '4', '99']) reasonCode?: string;
  @IsOptional() @IsString() @MaxLength(100) remarks?: string;
  /** e-way Part-B vehicle update: the new vehicle number. */
  @IsOptional() @IsString() @MaxLength(20) vehicleNo?: string;
  /** e-way validity extension: distance (km) still to travel. */
  @IsOptional() @IsInt() @Min(1) @Max(100000) remainingDistanceKm?: number;
}

class DecideApprovalDto {
  @IsIn(['approved', 'rejected']) decision!: 'approved' | 'rejected';
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

class AskAgentDto {
  /** The operator's question/instruction to the agent (treated as the task). */
  @IsString() @MaxLength(4000) message!: string;
  /** Optional extra operator instruction folded into the system prompt. */
  @IsOptional() @IsString() @MaxLength(2000) system?: string;
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
    private readonly approvals: ApprovalService,
    private readonly llm: LlmService,
    private readonly gst: GstExecutionService,
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

  /**
   * Run the Automation agent: it PREPARES an action for approval (a reversible
   * L3 write) — it never commits a financial/legal/irreversible action.
   */
  @Post('automation/run')
  runAutomation(@CurrentUser() u: AuthUser, @Body() dto: RunAutomationDto) {
    return this.kernel.runTask({
      tenantId: u.tenantId as string,
      agentName: AGENT_AUTOMATION,
      actorUserId: u.userId,
      taskKind: 'automation',
      input: { ...dto },
    });
  }

  // ---- LLM reasoning (`/ask`) — the model proposes, the kernel disposes ----

  /**
   * Whether an LLM provider is configured for this deployment, and which model.
   * The UI uses this to decide whether to offer `/ask`; when false, `/ask` still
   * responds but degrades gracefully (no model call).
   */
  @Get('llm')
  llmStatus() {
    return {
      configured: this.llm.isConfigured(),
      provider: this.llm.providerName(),
      model: this.llm.modelId(),
      askEnabledAgents: [...ASK_ENABLED_AGENTS],
    };
  }

  /**
   * Ask an agent a free-form question. The LLM reasons over ONLY this agent's
   * allow-listed tools; every tool it proposes is routed through the same
   * guardrail funnel as a deterministic run (scope → policy → budget →
   * tenant-scoped execute → audit), so the model cannot widen its access, bypass
   * the hard rule, or cross tenants. Without a configured key it degrades to a
   * clear "not configured" outcome. Gated by `agents.manage` (class default).
   */
  @Post(':name/ask')
  ask(@CurrentUser() u: AuthUser, @Param('name') name: string, @Body() dto: AskAgentDto) {
    if (!ASK_ENABLED_AGENTS.has(name)) {
      throw new BadRequestException(`agent '${name}' does not support ask mode`);
    }
    return this.kernel.runTask({
      tenantId: u.tenantId as string,
      agentName: name,
      actorUserId: u.userId,
      taskKind: 'ask',
      mode: 'ask',
      input: { message: dto.message, system: dto.system },
    });
  }

  // ---- Approval queue (the human-in-the-loop L2 gate; `agents.approve`) ----

  /** Pending (or ?status=all/approved/rejected) prepared actions for this tenant. */
  @Get('approvals')
  @RequirePermissions('agents.approve')
  listApprovals(@CurrentUser() u: AuthUser, @Query('status') status?: string) {
    return this.approvals.list(u.tenantId as string, status ?? 'pending');
  }

  /** Approve or reject a prepared action. Decided once — a second decision 409s. */
  @Post('approvals/:id/decide')
  @RequirePermissions('agents.approve')
  decideApproval(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: DecideApprovalDto) {
    return this.approvals.decide(u.tenantId as string, id, dto.decision, u.userId, dto.reason);
  }

  // ---- GST live execution (the approved-action transmission step; GW-2/3/4) ----

  /** Whether a GST provider is configured for this deployment, and which one. */
  @Get('gst')
  gstStatus() {
    return { configured: this.gst.isConfigured(), provider: this.gst.providerName() };
  }

  /**
   * Execute an APPROVED GST action (IRN or e-way) against the configured provider
   * and persist the government response onto the invoice. Gated by `agents.approve`
   * — the same human authority that approved it. Idempotent; with no provider
   * configured it skips (prepare-only preserved). This is the operator/worker
   * entrypoint until the durable queue backbone (GW-1) lands.
   */
  @Post('approvals/:id/execute')
  @RequirePermissions('agents.approve')
  executeApproval(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.gst.execute(u.tenantId as string, id, u.userId);
  }
}
