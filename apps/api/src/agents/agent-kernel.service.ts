import { Injectable, Logger } from '@nestjs/common';
import { TenantDbService } from '../core/database/tenant-db.service';
import { AgentRun, AgentRunStep } from '../core/database/entities';
import { AuditService } from '../audit/audit.service';
import { ToolRegistryService } from './tool-registry.service';
import { PolicyEngineService } from './policy-engine.service';
import { AgentGovernorService, actionAllowed, stepAllowed } from './agent-governor.service';
import {
  AgentError,
  AgentRunContext,
  AgentRunResult,
  RunStatus,
} from './agent.types';

interface RunTaskParams {
  tenantId: string;
  agentName: string;
  actorUserId: string | null;
  taskKind?: string;
  input?: Record<string, unknown>;
}

/**
 * The supervisor/orchestrator (M0). It owns the guardrail funnel that EVERY
 * agent action passes through, in order:
 *
 *   kill switch → create run → [ per tool call: step budget → scope → policy →
 *   action budget → tenant-scoped execution → audit step ] → finalise run.
 *
 * The guarantees are enforced here in our code, never delegated to a model:
 *   - tenant isolation: every DB touch runs inside `runInTenant`, so RLS makes a
 *     cross-tenant read/write impossible (WR-AGT-2);
 *   - least privilege: the tool registry rejects any tool outside the agent's
 *     allow-list (WR-AGT-3);
 *   - the hard rule: the policy engine blocks every financial/legal/safety/
 *     irreversible action for human approval — no such action ever auto-runs
 *     (WR-AGT-4);
 *   - bounded work: the governor's kill switch and per-run budgets stop a paused
 *     tenant and a runaway loop (WR-AGT-6);
 *   - audit: every step and every run outcome is written to the append-only
 *     trail, and the run lifecycle is cross-linked into `audit_logs` (WR-AGT-5).
 *
 * M0 wires no LLM: an "agent" is a registered handler. The point of M0 is that
 * the guardrails are real, tested, and in place before any agent is given a
 * model or a write tool.
 */
@Injectable()
export class AgentKernelService {
  private readonly log = new Logger(AgentKernelService.name);

  constructor(
    private readonly registry: ToolRegistryService,
    private readonly policy: PolicyEngineService,
    private readonly governor: AgentGovernorService,
    private readonly db: TenantDbService,
    private readonly audit: AuditService,
  ) {}

  async runTask(params: RunTaskParams): Promise<AgentRunResult> {
    const { tenantId, agentName, actorUserId } = params;
    const taskKind = params.taskKind ?? null;
    const input = params.input ?? {};

    // Resolve the agent up front — an unknown agent is rejected before any run
    // row exists (the registry throws a typed UNKNOWN_AGENT error).
    const agent = this.registry.getAgent(agentName);
    const controls = await this.governor.getControls(tenantId);

    // Kill switch: a paused tenant runs nothing. Record the refusal as a run so
    // the attempt is visible in the trail, then return.
    if (controls.automationPaused) {
      const killed = await this.createRun(tenantId, agentName, taskKind, actorUserId, 'killed', 'refused: automation paused');
      await this.recordStep(tenantId, killed.id, 1, {
        stepType: 'blocked',
        policyVerdict: 'block',
        detail: { reason: 'automation paused (kill switch)' },
      });
      await this.finalizeRun(tenantId, killed.id, 'killed', 0, 0, { reason: 'automation paused' });
      await this.auditRun(tenantId, actorUserId, killed.id, agentName, taskKind, 'killed', { steps: 0, actions: 0 });
      return { runId: killed.id, status: 'killed', stepsUsed: 0, actionsUsed: 0, outcome: { reason: 'automation paused' }, reason: 'automation paused' };
    }

    const run = await this.createRun(tenantId, agentName, taskKind, actorUserId, 'running', `agent ${agentName} run`);

    const usage = { steps: 0, actions: 0 };
    let seq = 0;

    const ctx: AgentRunContext = {
      tenantId,
      actorUserId,
      input,
      callTool: async <T>(toolName: string, args?: unknown): Promise<T> => {
        const stepSeq = ++seq;

        // 1) step budget — the runaway-loop backstop.
        if (!stepAllowed(usage.steps, controls.maxStepsPerRun)) {
          await this.recordStep(tenantId, run.id, stepSeq, {
            stepType: 'blocked', toolName, policyVerdict: 'block',
            detail: { reason: 'step budget exceeded', cap: controls.maxStepsPerRun },
          });
          throw new AgentError('BUDGET_EXCEEDED', `step budget ${controls.maxStepsPerRun} exceeded`, { toolName });
        }
        usage.steps += 1;

        // 2) scope — least privilege; a tool outside the allow-list is rejected.
        let tool;
        try {
          tool = this.registry.resolveTool(agentName, toolName);
        } catch (e) {
          await this.recordStep(tenantId, run.id, stepSeq, {
            stepType: 'blocked', toolName, policyVerdict: 'block', detail: { reason: 'out of scope' },
          });
          throw e;
        }

        // 3) policy — the hard rule; non-reversible writes are blocked.
        const decision = this.policy.decide(tool);
        if (decision.verdict === 'block') {
          await this.recordStep(tenantId, run.id, stepSeq, {
            stepType: 'blocked', toolName, toolKind: tool.kind, reversibility: tool.reversibility,
            policyVerdict: 'block', detail: { reason: decision.reason },
          });
          throw new AgentError('ACTION_BLOCKED', decision.reason, { toolName, reversibility: tool.reversibility });
        }

        // 4) action budget — writes only.
        if (tool.kind === 'write') {
          if (!actionAllowed(usage.actions, controls.maxActionsPerRun)) {
            await this.recordStep(tenantId, run.id, stepSeq, {
              stepType: 'blocked', toolName, toolKind: 'write', reversibility: tool.reversibility,
              policyVerdict: decision.verdict, detail: { reason: 'action budget exceeded', cap: controls.maxActionsPerRun },
            });
            throw new AgentError('BUDGET_EXCEEDED', `action budget ${controls.maxActionsPerRun} exceeded`, { toolName });
          }
          usage.actions += 1;
        }

        // 5) execute — inside the tenant transaction, so the tool is RLS-bound.
        const result = await this.db.runInTenant(tenantId, (m) =>
          tool.execute({ tenantId, actorUserId, manager: m, args: args ?? {} }),
        );
        await this.recordStep(tenantId, run.id, stepSeq, {
          stepType: 'tool_call', toolName, toolKind: tool.kind, reversibility: tool.reversibility,
          policyVerdict: decision.verdict, detail: { ok: true },
        });
        return result as T;
      },
      note: async (message: string, detail?: Record<string, unknown>) => {
        await this.recordStep(tenantId, run.id, ++seq, {
          stepType: 'note', detail: detail ? { message, detail } : { message },
        });
      },
    };

    let status: RunStatus = 'completed';
    let outcome: Record<string, unknown> | null = null;
    let reason: string | undefined;
    try {
      const result = await agent.handler(ctx);
      outcome = { result: result ?? null };
    } catch (e) {
      status = this.classify(e);
      reason = e instanceof Error ? e.message : String(e);
      outcome = { error: { code: e instanceof AgentError ? e.code : 'ERROR', message: reason } };
      if (status === 'failed') {
        this.log.warn(`agent run ${run.id} (${agentName}) failed: ${reason}`);
      }
    }

    await this.finalizeRun(tenantId, run.id, status, usage.steps, usage.actions, outcome);
    await this.auditRun(tenantId, actorUserId, run.id, agentName, taskKind, status, usage);
    return { runId: run.id, status, stepsUsed: usage.steps, actionsUsed: usage.actions, outcome, reason };
  }

  /** Map a thrown error to how the run ended. */
  private classify(e: unknown): RunStatus {
    if (e instanceof AgentError) {
      if (e.code === 'ACTION_BLOCKED') return 'blocked';
      if (e.code === 'BUDGET_EXCEEDED') return 'aborted';
    }
    return 'failed';
  }

  private createRun(
    tenantId: string,
    agentName: string,
    taskKind: string | null,
    actorUserId: string | null,
    status: RunStatus | 'running',
    summary: string,
  ): Promise<AgentRun> {
    return this.db.runInTenant(tenantId, (m) => {
      const repo = m.getRepository(AgentRun);
      return repo.save(repo.create({ tenantId, agentName, taskKind, status, createdBy: actorUserId, summary }));
    });
  }

  private finalizeRun(
    tenantId: string,
    runId: string,
    status: RunStatus,
    stepsUsed: number,
    actionsUsed: number,
    outcome: Record<string, unknown> | null,
  ): Promise<unknown> {
    // save (not update): a partial carrying the PK updates only these columns,
    // and its DeepPartial signature accepts the jsonb `outcome` cleanly.
    return this.db.runInTenant(tenantId, (m) =>
      m.getRepository(AgentRun).save({ id: runId, status, stepsUsed, actionsUsed, outcome, endedAt: new Date() }),
    );
  }

  private recordStep(
    tenantId: string,
    runId: string,
    seq: number,
    fields: Partial<AgentRunStep>,
  ): Promise<unknown> {
    return this.db.runInTenant(tenantId, (m) => {
      const repo = m.getRepository(AgentRunStep);
      return repo.save(repo.create({ tenantId, runId, seq, ...fields } as AgentRunStep));
    });
  }

  /** Cross-link the run lifecycle into the main audit trail (best-effort). */
  private auditRun(
    tenantId: string,
    actorUserId: string | null,
    runId: string,
    agentName: string,
    taskKind: string | null,
    status: RunStatus,
    usage: { steps: number; actions: number },
  ): Promise<void> {
    return this.audit.record({
      tenantId,
      actorUserId,
      action: `agent.run.${status}`,
      summary: `Agent '${agentName}' run ${status} (${usage.steps} steps, ${usage.actions} actions)`,
      entityType: 'agent_run',
      entityId: runId,
      details: { agentName, taskKind, ...usage },
    });
  }

  /** Recent runs for a tenant (newest first). */
  listRuns(tenantId: string, limit = 50): Promise<AgentRun[]> {
    const capped = Math.min(Math.max(limit, 1), 200);
    return this.db.runInTenant(tenantId, (m) =>
      m.getRepository(AgentRun).find({ where: { tenantId }, order: { createdAt: 'DESC' }, take: capped }),
    );
  }
}
