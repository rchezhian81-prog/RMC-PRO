import { Module } from '@nestjs/common';
import { ComplianceModule } from '../compliance/compliance.module';
import { AgentsController } from './agents.controller';
import { ToolRegistryService } from './tool-registry.service';
import { PolicyEngineService } from './policy-engine.service';
import { AgentGovernorService } from './agent-governor.service';
import { AgentKernelService } from './agent-kernel.service';
import { DiagnosticsAgent } from './diagnostics.agent';
import { DataAnalysisAgent } from './data-analysis.agent';
import { MonitorAgent } from './monitor.agent';
import { SpecialistAgent } from './specialist.agent';
import { CustomerServiceAgent } from './customer-service.agent';
import { AutomationAgent } from './automation.agent';
import { ApprovalService } from './approval.service';
import { LlmService } from './llm/llm.service';
import { AnthropicLlmProvider } from './llm/anthropic.provider';
import { LocalLlmProvider } from './llm/local.provider';
import { LLM_PROVIDER, type LlmProvider } from './llm/llm.types';

/**
 * Select the reasoning backend. Default is the INBUILT, self-hosted local model
 * (no subscription); the paid Anthropic API is strictly opt-in via
 * `AGENT_LLM_PROVIDER=anthropic`. Either way the provider is fail-safe off when
 * unconfigured, so the agents fall back to their deterministic paths.
 */
function selectLlmProvider(): LlmProvider {
  return (process.env.AGENT_LLM_PROVIDER ?? 'local').toLowerCase() === 'anthropic'
    ? new AnthropicLlmProvider()
    : new LocalLlmProvider();
}

/**
 * The multi-agent substrate (M0). Wires the orchestrator kernel, the guardrail
 * services (tool registry, policy engine, governor), and the internal
 * diagnostics probe agent that registers itself on init.
 *
 * TenantDbService, AuditService and the RBAC guards all come from global modules
 * (DatabaseModule / AuditModule / RbacModule), exactly as the audit module does.
 *
 * M1 adds the first two REAL agents — Data-Analysis and Monitor — both
 * read-only. M2 adds the Specialist advisory agent and inter-agent escalation.
 * M3 adds the customer-scoped Customer-Service agent. M4 adds the Automation
 * agent — the first with WRITE tools — plus the L2 approval substrate
 * (ApprovalService): a reversible write executes bounded (L3), and a
 * financial/legal/irreversible action is PREPARED for a human, never
 * auto-executed.
 *
 * LLM-1 adds the reasoning layer (LlmService + a pluggable provider bound behind
 * LLM_PROVIDER). Agents can now `ctx.reason()` / be `/ask`-ed: the model proposes
 * tool calls, but the SAME M0 funnel disposes — scope, policy (the hard rule),
 * budgets, tenant isolation, and audit are unchanged. Without an API key the
 * layer degrades gracefully and every deterministic path keeps working; the live
 * key is held for deployment.
 */
@Module({
  imports: [ComplianceModule],
  controllers: [AgentsController],
  providers: [
    ToolRegistryService,
    PolicyEngineService,
    AgentGovernorService,
    ApprovalService,
    // LLM reasoning layer: the provider is bound behind a token so the inbuilt
    // local model (default) or the opt-in Anthropic API can be swapped/absent
    // without touching the kernel.
    { provide: LLM_PROVIDER, useFactory: selectLlmProvider },
    LlmService,
    AgentKernelService,
    DiagnosticsAgent,
    DataAnalysisAgent,
    MonitorAgent,
    SpecialistAgent,
    CustomerServiceAgent,
    AutomationAgent,
  ],
  exports: [AgentKernelService, ToolRegistryService, AgentGovernorService, ApprovalService, LlmService],
})
export class AgentsModule {}
