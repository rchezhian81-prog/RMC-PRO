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
  escalationAllowed,
} from './agent.types';

interface RunTaskParams {
  tenantId: string;
  agentName: string;
  actorUserId: string | null;
  taskKind?: string;
  input?: Record<string, unknown>;
}

/** Internal run parameters carry escalation depth + the parent run id. */
interface RunTaskInternal extends RunTaskParams {
  depth: number;
  parentRunId: string | null;
}

/** Escalation nesting bound — a backstop against escalation loops. */
const MAX_ESCALATION_DEPTH = 3;

/**
 * The supervisor/orchestrator (M0 + M2). It owns the guardrail funnel that EVERY
 * agent action passes through:
 *
 *   kill switch → create run → [ per tool call: step budget → scope → policy →
 *   action budget → tenant-scoped execution → audit step ] → finalise run.
 *
 * M2 adds inter-agent escalation (e.g. Monitor → Specialist): an agent may hand a
 * sub-task to another agent, but ONLY one in its own `canEscalateTo` allow-list,
 * bounded by `MAX_ESCALATION_DEPTH`, and the escalated run is a first-class,
 * audited child linked by `parent_run_id`. Escalation never grants more
 * privilege — the child runs through this same funnel with its own budgets.
 *
 * Every guarantee is enforced here in our code, never delegated to a model:
 * tenant isolation (runInTenant), least privilege (registry + escalation
 * allow-list), the hard rule (policy engine blocks non-reversible writes),
 * bounded work (kill switch + budgets + depth), and audit (every step + run).
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

  /** Public entry point — starts a top-level run (no parent, depth 0). */
  runTask(params: RunTaskParams): Promise<AgentRunResult> {
    return this.runTaskInternal({ ...params, depth: 0, parentRunId: null });
  }

  private async runTaskInternal(params: RunTaskInternal): Promise<AgentRunResult> {
    const { tenantId, agentName, actorUserId, depth, parentRunId } = params;
    const taskKind = params.taskKind ?? null;
    const input = params.input ?? {};

    const agent = this.registry.getAgent(agentName);
    const controls = await this.governor.getControls(tenantId);

    // Kill switch: a paused tenant runs nothing (top-level or escalated).
    if (controls.automationPaused) {
      const killed = await this.createRun(tenantId, agentName, taskKind, actorUserId, 'killed', 'refused: automation paused', parentRunId);
      await this.recordStep(tenantId, killed.id, 1, {
        stepType: 'blocked', policyVerdict: 'block', detail: { reason: 'automation paused (kill switch)' },
      });
      await this.finalizeRun(tenantId, killed.id, 'killed', 0, 0, { reason: 'automation paused' });
      await this.auditRun(tenantId, actorUserId, killed.id, agentName, taskKind, 'killed', { steps: 0, actions: 0 });
      return { runId: killed.id, status: 'killed', stepsUsed: 0, actionsUsed: 0, outcome: { reason: 'automation paused' }, reason: 'automation paused' };
    }

    const run = await this.createRun(tenantId, agentName, taskKind, actorUserId, 'running', `agent ${agentName} run`, parentRunId);

    const usage = { steps: 0, actions: 0 };
    let seq = 0;
    const nextStep = (): number => {
      // Shared step budget across tool calls AND escalations.
      if (!stepAllowed(usage.steps, controls.maxStepsPerRun)) {
        throw new AgentError('BUDGET_EXCEEDED', `step budget ${controls.maxStepsPerRun} exceeded`);
      }
      usage.steps += 1;
      return ++seq;
    };

    const ctx: AgentRunContext = {
      tenantId,
      actorUserId,
      input,
      callTool: async <T>(toolName: string, args?: unknown): Promise<T> => {
        let stepSeq: number;
        try {
          stepSeq = nextStep();
        } catch (e) {
          await this.recordStep(tenantId, run.id, ++seq, {
            stepType: 'blocked', toolName, policyVerdict: 'block',
            detail: { reason: 'step budget exceeded', cap: controls.maxStepsPerRun },
          });
          throw e;
        }

        // scope — least privilege.
        let tool;
        try {
          tool = this.registry.resolveTool(agentName, toolName);
        } catch (e) {
          await this.recordStep(tenantId, run.id, stepSeq, {
            stepType: 'blocked', toolName, policyVerdict: 'block', detail: { reason: 'out of scope' },
          });
          throw e;
        }

        // policy — the hard rule.
        const decision = this.policy.decide(tool);
        if (decision.verdict === 'block') {
          await this.recordStep(tenantId, run.id, stepSeq, {
            stepType: 'blocked', toolName, toolKind: tool.kind, reversibility: tool.reversibility,
            policyVerdict: 'block', detail: { reason: decision.reason },
          });
          throw new AgentError('ACTION_BLOCKED', decision.reason, { toolName, reversibility: tool.reversibility });
        }

        // action budget — writes only.
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

        // execute — inside the tenant transaction (RLS-bound).
        const result = await this.db.runInTenant(tenantId, (m) =>
          tool.execute({ tenantId, actorUserId, manager: m, args: args ?? {} }),
        );
        await this.recordStep(tenantId, run.id, stepSeq, {
          stepType: 'tool_call', toolName, toolKind: tool.kind, reversibility: tool.reversibility,
          policyVerdict: decision.verdict, detail: { ok: true },
        });
        return result as T;
      },
      escalate: async (targetAgent: string, subInput?: Record<string, unknown>): Promise<AgentRunResult> => {
        const stepSeq = nextStep();
        // escalation scope — least privilege for escalation.
        if (!escalationAllowed(agent.canEscalateTo, targetAgent)) {
          await this.recordStep(tenantId, run.id, stepSeq, {
            stepType: 'blocked', policyVerdict: 'block',
            detail: { reason: 'escalation not allowed', targetAgent },
          });
          throw new AgentError('ESCALATION_NOT_ALLOWED', `agent '${agentName}' may not escalate to '${targetAgent}'`, { targetAgent });
        }
        if (depth >= MAX_ESCALATION_DEPTH) {
          await this.recordStep(tenantId, run.id, stepSeq, {
            stepType: 'blocked', policyVerdict: 'block',
            detail: { reason: 'escalation depth exceeded', depth, cap: MAX_ESCALATION_DEPTH },
          });
          throw new AgentError('ESCALATION_DEPTH', `escalation depth ${MAX_ESCALATION_DEPTH} exceeded`, { targetAgent });
        }
        // Run the target as a linked child through the same funnel.
        const child = await this.runTaskInternal({
          tenantId, agentName: targetAgent, actorUserId,
          taskKind: `escalation:${agentName}`, input: subInput ?? {},
          depth: depth + 1, parentRunId: run.id,
        });
        await this.recordStep(tenantId, run.id, stepSeq, {
          stepType: 'escalation',
          detail: { targetAgent, childRunId: child.runId, childStatus: child.status },
        });
        return child;
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
      if (e.code === 'BUDGET_EXCEEDED' || e.code === 'ESCALATION_DEPTH') return 'aborted';
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
    parentRunId: string | null,
  ): Promise<AgentRun> {
    return this.db.runInTenant(tenantId, (m) => {
      const repo = m.getRepository(AgentRun);
      return repo.save(repo.create({ tenantId, agentName, taskKind, status, createdBy: actorUserId, summary, parentRunId }));
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
