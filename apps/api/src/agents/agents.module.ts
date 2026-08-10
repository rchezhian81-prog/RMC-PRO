import { Module } from '@nestjs/common';
import { AgentsController } from './agents.controller';
import { ToolRegistryService } from './tool-registry.service';
import { PolicyEngineService } from './policy-engine.service';
import { AgentGovernorService } from './agent-governor.service';
import { AgentKernelService } from './agent-kernel.service';
import { DiagnosticsAgent } from './diagnostics.agent';
import { DataAnalysisAgent } from './data-analysis.agent';
import { MonitorAgent } from './monitor.agent';

/**
 * The multi-agent substrate (M0). Wires the orchestrator kernel, the guardrail
 * services (tool registry, policy engine, governor), and the internal
 * diagnostics probe agent that registers itself on init.
 *
 * TenantDbService, AuditService and the RBAC guards all come from global modules
 * (DatabaseModule / AuditModule / RbacModule), exactly as the audit module does.
 *
 * M1 adds the first two REAL agents — Data-Analysis and Monitor — both
 * read-only: every tool they register is a `read`, so the policy engine executes
 * them freely and neither can write. Still no LLM and no domain write tools; the
 * agents run deterministic, tenant-scoped queries through the same M0 funnel.
 */
@Module({
  controllers: [AgentsController],
  providers: [
    ToolRegistryService,
    PolicyEngineService,
    AgentGovernorService,
    AgentKernelService,
    DiagnosticsAgent,
    DataAnalysisAgent,
    MonitorAgent,
  ],
  exports: [AgentKernelService, ToolRegistryService, AgentGovernorService],
})
export class AgentsModule {}
