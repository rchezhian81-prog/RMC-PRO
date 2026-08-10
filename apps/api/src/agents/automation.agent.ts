import { Injectable, OnModuleInit } from '@nestjs/common';
import { ToolRegistryService } from './tool-registry.service';
import { ApprovalService } from './approval.service';
import type { AgentToolDef } from './agent.types';

export const AGENT_AUTOMATION = 'automation';

/**
 * The Automation agent (M4) — the first agent with WRITE tools, added one at a
 * time behind the policy engine. It demonstrates both sides of the hard rule:
 *
 *   - `automation.open_approval` (WRITE, reversible) → policy `bounded` (L3): it
 *     executes under the run's caps, but all it does is record a PENDING
 *     approval request. A pending request has no downstream effect and can be
 *     rejected/cancelled, so it is genuinely reversible — and it IS the
 *     prepare-and-block mechanism. This is how the agent "does" a high-risk
 *     action: by preparing it for a human, never by executing it.
 *
 *   - `automation.commit_financial` (WRITE, financial) → policy `block` (L2): a
 *     money-movement stand-in the engine refuses to auto-execute. Its executor
 *     throws if ever reached, proving the block happens before execution.
 *
 * The normal handler path PREPARES an action (open_approval) rather than
 * committing it. Executing an *approved* action is a separate, human-initiated
 * step — and for messaging/clearance it also waits on the consent engine / live
 * integrations, which are held for deployment.
 */
@Injectable()
export class AutomationAgent implements OnModuleInit {
  constructor(
    private readonly registry: ToolRegistryService,
    private readonly approvals: ApprovalService,
  ) {}

  onModuleInit(): void {
    const openApproval: AgentToolDef = {
      name: 'automation.open_approval',
      kind: 'write',
      reversibility: 'reversible',
      permission: 'agents.approve',
      description: 'Reversible write: record a PENDING approval request for a human to decide. Never executes the action.',
      execute: async (ctx) => {
        const a = (ctx.args ?? {}) as {
          actionKind?: string; title?: string; payload?: Record<string, unknown>; reversibility?: string;
        };
        const req = await this.approvals.prepare(ctx.manager, {
          tenantId: ctx.tenantId,
          runId: ctx.runId,
          agentName: AGENT_AUTOMATION,
          actionKind: a.actionKind ?? 'unspecified',
          title: a.title ?? 'Prepared action awaiting approval',
          payload: a.payload ?? {},
          reversibility: a.reversibility ?? 'irreversible',
          requestedBy: ctx.actorUserId,
        });
        return { approvalId: req.id, status: req.status, actionKind: req.actionKind };
      },
    };

    const commitFinancial: AgentToolDef = {
      name: 'automation.commit_financial',
      kind: 'write',
      reversibility: 'financial',
      permission: 'receipts.create',
      description: 'Financial-class stand-in: MUST be blocked by policy and never auto-execute.',
      execute: async () => {
        throw new Error('SAFETY VIOLATION: a financial action executed without approval');
      },
    };

    for (const t of [openApproval, commitFinancial]) this.registry.registerTool(t);

    this.registry.registerAgent({
      name: AGENT_AUTOMATION,
      description: 'Prepares reversible/high-risk actions for human approval (M4).',
      tools: [openApproval.name, commitFinancial.name],
      handler: async (ctx) => {
        const input = ctx.input as {
          actionKind?: string; title?: string; payload?: Record<string, unknown>;
          reversibility?: string; tryCommit?: boolean;
        };
        // Demonstrate the hard rule: a financial action is blocked, never auto-run.
        if (input.tryCommit) {
          await ctx.callTool('automation.commit_financial', {}); // throws ACTION_BLOCKED → run 'blocked'
        }
        // The normal path: PREPARE the action for a human instead of executing it.
        const prepared = await ctx.callTool('automation.open_approval', {
          actionKind: input.actionKind ?? 'payment_reminder',
          title: input.title ?? 'Payment reminder (prepared)',
          payload: input.payload ?? {},
          reversibility: input.reversibility ?? 'irreversible',
        });
        await ctx.note('automation: prepared an action for human approval');
        return { prepared };
      },
    });
  }
}
