import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * The multi-agent substrate's persistent state (M0 of
 * `docs/audit/MULTI_AGENT_SYSTEM_ARCHITECTURE.md`). Three tenant-scoped,
 * RLS-enforced tables:
 *
 *   - `agent_controls`   — one row per tenant: the automation kill switch and the
 *                          per-run step/action budgets the governor enforces.
 *   - `agent_runs`       — one row per orchestrated task: status + usage counters.
 *   - `agent_run_steps`  — append-only trail of every tool call / policy decision
 *                          inside a run (the agentic audit the blueprint requires).
 *
 * All three are FORCE-RLS'd on `tenant_id` exactly like the other tenant tables,
 * so an agent can never read or write another tenant's runs — isolation is
 * DB-enforced, not prompt-trusted (WR-AGT-2).
 */

/** Per-tenant automation controls: the kill switch + budget ceilings. */
@Entity('agent_controls')
export class AgentControl {
  /** One row per tenant; the tenant id IS the key. */
  @PrimaryColumn({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  /** The kill switch. When true the kernel refuses to start any run (WR-AGT-6). */
  @Column({ name: 'automation_paused', type: 'boolean', default: false })
  automationPaused!: boolean;

  /** Max tool calls in a single run before it is aborted (runaway-loop backstop). */
  @Column({ name: 'max_steps_per_run', type: 'int', default: 50 })
  maxStepsPerRun!: number;

  /** Max WRITE actions in a single run before it is aborted. */
  @Column({ name: 'max_actions_per_run', type: 'int', default: 10 })
  maxActionsPerRun!: number;

  /** Set by the reversible diagnostic write — proves a bounded write executed. */
  @Column({ name: 'last_diagnostic_at', type: 'timestamptz', nullable: true })
  lastDiagnosticAt!: Date | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ name: 'updated_by', type: 'uuid', nullable: true })
  updatedBy!: string | null;
}

/** One orchestrated task run: what agent, for whom, its status and usage. */
@Entity('agent_runs')
@Index('idx_agent_runs_tenant_time', ['tenantId', 'createdAt'])
export class AgentRun {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'agent_name', type: 'varchar' })
  agentName!: string;

  /** A short label for the kind of task, e.g. `diagnostics`. */
  @Column({ name: 'task_kind', type: 'varchar', nullable: true })
  taskKind!: string | null;

  /** Set when this run was spawned by another agent escalating (M2). */
  @Column({ name: 'parent_run_id', type: 'uuid', nullable: true })
  parentRunId!: string | null;

  /** running | completed | failed | aborted | blocked | killed. */
  @Column({ name: 'status', type: 'varchar', default: 'running' })
  status!: string;

  @Column({ name: 'steps_used', type: 'int', default: 0 })
  stepsUsed!: number;

  @Column({ name: 'actions_used', type: 'int', default: 0 })
  actionsUsed!: number;

  /** The person the run acted for. Null for a genuinely system-initiated run. */
  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy!: string | null;

  @Column({ name: 'summary', type: 'varchar', nullable: true })
  summary!: string | null;

  /** Structured result or error info. Never holds a secret. */
  @Column({ name: 'outcome', type: 'jsonb', nullable: true })
  outcome!: Record<string, unknown> | null;

  @Column({ name: 'ended_at', type: 'timestamptz', nullable: true })
  endedAt!: Date | null;
}

/**
 * Append-only record of a single step inside a run — a tool call, a policy
 * decision, a block, a budget stop, or a note. Like `audit_logs`, the app role
 * gets SELECT + INSERT only, so a step trail can be read and written but never
 * rewritten.
 */
@Entity('agent_run_steps')
@Index('idx_agent_run_steps_run', ['tenantId', 'runId', 'seq'])
export class AgentRunStep {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'run_id', type: 'uuid' })
  runId!: string;

  /** 1-based ordinal within the run. */
  @Column({ name: 'seq', type: 'int' })
  seq!: number;

  /** tool_call | blocked | note. */
  @Column({ name: 'step_type', type: 'varchar' })
  stepType!: string;

  @Column({ name: 'tool_name', type: 'varchar', nullable: true })
  toolName!: string | null;

  /** read | write. */
  @Column({ name: 'tool_kind', type: 'varchar', nullable: true })
  toolKind!: string | null;

  /** reversible | irreversible | financial | legal | safety. */
  @Column({ name: 'reversibility', type: 'varchar', nullable: true })
  reversibility!: string | null;

  /** execute | bounded | block — the policy engine's verdict. */
  @Column({ name: 'policy_verdict', type: 'varchar', nullable: true })
  policyVerdict!: string | null;

  @Column({ name: 'detail', type: 'jsonb', nullable: true })
  detail!: Record<string, unknown> | null;
}

/**
 * A high-risk action an agent PREPARED for a human to approve (M4 — the L2
 * substrate). The agent never executes a financial/legal/irreversible action; it
 * records one here as `pending`, and a human with `agents.approve` decides. The
 * prepared `payload` is secret-scrubbed. Executing an *approved* action is a
 * separate, deliberate step (and, for messaging/clearance, waits on the consent
 * engine / live integrations — held for deployment).
 */
@Entity('agent_approval_requests')
@Index('idx_agent_approvals_tenant_status', ['tenantId', 'status', 'createdAt'])
export class AgentApprovalRequest {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  /** The run that prepared this action (null if prepared outside a run). */
  @Column({ name: 'run_id', type: 'uuid', nullable: true })
  runId!: string | null;

  @Column({ name: 'agent_name', type: 'varchar' })
  agentName!: string;

  /** What kind of action, e.g. `payment_reminder`, `einvoice_irn`. */
  @Column({ name: 'action_kind', type: 'varchar' })
  actionKind!: string;

  @Column({ name: 'title', type: 'varchar' })
  title!: string;

  /** The prepared action details (secret-scrubbed). Never executed by the agent. */
  @Column({ name: 'payload', type: 'jsonb', nullable: true })
  payload!: Record<string, unknown> | null;

  /** The action's reversibility class, for the reviewer's context. */
  @Column({ name: 'reversibility', type: 'varchar', nullable: true })
  reversibility!: string | null;

  /** pending | approved | rejected | cancelled. */
  @Column({ name: 'status', type: 'varchar', default: 'pending' })
  status!: string;

  @Column({ name: 'requested_by', type: 'uuid', nullable: true })
  requestedBy!: string | null;

  @Column({ name: 'decided_by', type: 'uuid', nullable: true })
  decidedBy!: string | null;

  @Column({ name: 'decided_at', type: 'timestamptz', nullable: true })
  decidedAt!: Date | null;

  @Column({ name: 'decision_reason', type: 'varchar', nullable: true })
  decisionReason!: string | null;
}
