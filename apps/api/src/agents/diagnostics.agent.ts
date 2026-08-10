import { Injectable, OnModuleInit } from '@nestjs/common';
import { AgentControl, AgentRun } from '../core/database/entities';
import { ToolRegistryService } from './tool-registry.service';
import type { AgentDef, AgentToolDef } from './agent.types';

export const AGENT_DIAGNOSTICS = 'diagnostics';

/**
 * The M0 substrate self-test — a real, internal-only agent that exercises every
 * guardrail path without an LLM, so "isolation + audit + kill-switch tests
 * green" is a thing we actually run, not a promise. It registers three tools
 * that stand in for the three risk classes the policy engine must treat
 * differently:
 *
 *   - `diag.echo`             READ            → must EXECUTE freely.
 *   - `diag.mark`             WRITE reversible → must run BOUNDED under caps (it
 *                             stamps `agent_controls.last_diagnostic_at`, a
 *                             genuinely reversible, tenant-owned metadata write).
 *   - `diag.simulate_payment` WRITE financial  → must be BLOCKED for human
 *                             approval; its executor throws if it is ever
 *                             reached, proving the block happens before execution.
 *
 * The handler also offers to call an unlisted tool so the least-privilege scope
 * check can be exercised. This agent is not exposed to customers as a feature;
 * it is the substrate's health probe.
 */
@Injectable()
export class DiagnosticsAgent implements OnModuleInit {
  constructor(private readonly registry: ToolRegistryService) {}

  onModuleInit(): void {
    const echo: AgentToolDef = {
      name: 'diag.echo',
      kind: 'read',
      reversibility: 'reversible',
      description: 'Read-only probe: echoes the message and returns this tenant\'s run count.',
      execute: async (ctx) => {
        const runs = await ctx.manager.getRepository(AgentRun).count({ where: { tenantId: ctx.tenantId } });
        const args = (ctx.args ?? {}) as { msg?: unknown };
        return { ok: true, echoed: args.msg ?? null, runs };
      },
    };

    const mark: AgentToolDef = {
      name: 'diag.mark',
      kind: 'write',
      reversibility: 'reversible',
      description: 'Reversible write: stamps agent_controls.last_diagnostic_at for this tenant.',
      execute: async (ctx) => {
        const repo = ctx.manager.getRepository(AgentControl);
        const existing = await repo.findOne({ where: { tenantId: ctx.tenantId } });
        const now = new Date();
        if (existing) {
          await repo.update({ tenantId: ctx.tenantId }, { lastDiagnosticAt: now });
        } else {
          await repo.save(repo.create({ tenantId: ctx.tenantId, lastDiagnosticAt: now }));
        }
        return { marked: true, at: now.toISOString() };
      },
    };

    const simulatePayment: AgentToolDef = {
      name: 'diag.simulate_payment',
      kind: 'write',
      reversibility: 'financial',
      description: 'Financial-class probe: MUST be blocked by policy and never execute.',
      execute: async () => {
        // If this ever runs, the guardrail failed — make it loud.
        throw new Error('SAFETY VIOLATION: a financial tool executed without approval');
      },
    };

    for (const t of [echo, mark, simulatePayment]) this.registry.registerTool(t);

    const agent: AgentDef = {
      name: AGENT_DIAGNOSTICS,
      description: 'M0 substrate health probe (internal).',
      tools: [echo.name, mark.name, simulatePayment.name],
      handler: async (ctx) => {
        const input = ctx.input as {
          msg?: string; mark?: boolean; tryPayment?: boolean; tryUnknownTool?: boolean;
        };
        const echoed = await ctx.callTool('diag.echo', { msg: input.msg ?? 'ping' });
        await ctx.note('diagnostics: echo ok');
        if (input.mark) await ctx.callTool('diag.mark', {});
        // These deliberately throw to exercise the guardrails; the kernel records
        // the run status accordingly (blocked / failed).
        if (input.tryPayment) await ctx.callTool('diag.simulate_payment', { amount: 1 });
        if (input.tryUnknownTool) await ctx.callTool('diag.does_not_exist', {});
        return { echo: echoed };
      },
    };
    this.registry.registerAgent(agent);
  }
}
