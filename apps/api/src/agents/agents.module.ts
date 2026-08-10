import { Module } from '@nestjs/common';
import { AgentsController } from './agents.controller';
import { ToolRegistryService } from './tool-registry.service';
import { PolicyEngineService } from './policy-engine.service';
import { AgentGovernorService } from './agent-governor.service';
import { AgentKernelService } from './agent-kernel.service';
import { DiagnosticsAgent } from './diagnostics.agent';

/**
 * The multi-agent substrate (M0). Wires the orchestrator kernel, the guardrail
 * services (tool registry, policy engine, governor), and the internal
 * diagnostics probe agent that registers itself on init.
 *
 * TenantDbService, AuditService and the RBAC guards all come from global modules
 * (DatabaseModule / AuditModule / RbacModule), exactly as the audit module does.
 * No LLM and no domain write tools are wired here — that is later (M1+),
 * deliberately, so the guardrails ship and are proven first.
 */
@Module({
  controllers: [AgentsController],
  providers: [
    ToolRegistryService,
    PolicyEngineService,
    AgentGovernorService,
    AgentKernelService,
    DiagnosticsAgent,
  ],
  exports: [AgentKernelService, ToolRegistryService, AgentGovernorService],
})
export class AgentsModule {}
