import { Module } from '@nestjs/common';
import { AgentsController } from './agents.controller';
import { ToolRegistryService } from './tool-registry.service';
import { PolicyEngineService } from './policy-engine.service';
import { AgentGovernorService } from './agent-governor.service';
import { AgentKernelService } from './agent-kernel.service';
import { DiagnosticsAgent } from './diagnostics.agent';
import { DataAnalysisAgent } from './data-analysis.agent';
import { MonitorAgent } from './monitor.agent';
import { SpecialistAgent } from './specialist.agent';

/**
 * The multi-agent substrate (M0). Wires the orchestrator kernel, the guardrail
 * services (tool registry, policy engine, governor), and the internal
 * diagnostics probe agent that registers itself on init.
 *
 * TenantDbService, AuditService and the RBAC guards all come from global modules
 * (DatabaseModule / AuditModule / RbacModule), exactly as the audit module does.
 *
 * M1 adds the first two REAL agents — Data-Analysis and Monitor — both
 * read-only. M2 adds the Specialist advisory agent and inter-agent escalation
 * (Monitor → Specialist). Every agent here is still read-only: every tool is a
 * `read`, so the policy engine executes them freely and none can write. Still no
 * LLM; the agents run deterministic, tenant-scoped queries through the M0 funnel.
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
    SpecialistAgent,
  ],
  exports: [AgentKernelService, ToolRegistryService, AgentGovernorService],
})
export class AgentsModule {}
