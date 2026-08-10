import type { EntityManager } from 'typeorm';

/**
 * Shared types for the multi-agent substrate (M0). Kept dependency-free and,
 * where possible, pure — the policy engine and tool registry are ordinary logic
 * that unit-tests without a database.
 */

/** A tool either only reads, or it writes. Reads are always free (L0/L1). */
export type ToolKind = 'read' | 'write';

/**
 * Reversibility is the governing metric for a WRITE (blueprint hard rule).
 * Ordered least→most restrictive. Anything that is not cleanly `reversible`
 * is blocked for human approval (L2).
 */
export type Reversibility =
  | 'reversible' // low-risk write with a clean inverse → bounded execute (L3)
  | 'irreversible' // no clean undo → human approval (L2)
  | 'financial' // money movement → human approval (L2)
  | 'legal' // GST/IRN/e-way/contract → human approval (L2)
  | 'safety'; // load accept/reject, mix attestation → human approval (L2)

/** The policy engine's verdict for a single action. */
export type PolicyVerdict =
  | 'execute' // run freely (read)
  | 'bounded' // run under budget/caps, logged (reversible write, L3)
  | 'block'; // stop and require human approval (L2)

export interface PolicyDecision {
  verdict: PolicyVerdict;
  reason: string;
}

/** Context a tool executor receives — already inside the tenant transaction. */
export interface ToolContext<TArgs = unknown> {
  tenantId: string;
  actorUserId: string | null;
  /** Tenant-scoped EntityManager (RLS applies) — the tool must use only this. */
  manager: EntityManager;
  args: TArgs;
}

/** A registered tool: what it is, how risky, and how to run it. */
export interface AgentToolDef<TArgs = unknown, TResult = unknown> {
  name: string;
  kind: ToolKind;
  /** Only meaningful for writes; reads are reversible by nature. */
  reversibility: Reversibility;
  description: string;
  /** RBAC permission a human would need for the same action (parity/audit). */
  permission?: string;
  execute: (ctx: ToolContext<TArgs>) => Promise<TResult>;
}

/** The context an agent handler is given to do its work through the kernel. */
export interface AgentRunContext {
  tenantId: string;
  actorUserId: string | null;
  input: Record<string, unknown>;
  /**
   * Call a tool by name. Enforces, in order: budget (step cap) → scope
   * (allow-list) → policy (block on non-reversible) → budget (action cap) →
   * tenant-scoped execution → audit. Throws a typed AgentError on any stop.
   */
  callTool: <T = unknown>(toolName: string, args?: unknown) => Promise<T>;
  /** Record a free-text note as a step in the run trail (no side effects). */
  note: (message: string, detail?: Record<string, unknown>) => Promise<void>;
}

/** A registered agent: a named handler with an explicit tool allow-list. */
export interface AgentDef {
  name: string;
  description: string;
  /** The ONLY tool names this agent may call (least privilege, WR-AGT-3). */
  tools: string[];
  handler: (ctx: AgentRunContext) => Promise<unknown>;
}

export type RunStatus = 'completed' | 'failed' | 'aborted' | 'blocked' | 'killed';

export interface AgentRunResult {
  runId: string;
  status: RunStatus;
  stepsUsed: number;
  actionsUsed: number;
  outcome: Record<string, unknown> | null;
  /** Present when the run did not complete cleanly. */
  reason?: string;
}

/** Typed errors so the kernel can classify how a run ended. */
export type AgentErrorCode =
  | 'UNKNOWN_AGENT'
  | 'TOOL_OUT_OF_SCOPE'
  | 'ACTION_BLOCKED'
  | 'BUDGET_EXCEEDED'
  | 'AUTOMATION_PAUSED';

export class AgentError extends Error {
  constructor(
    readonly code: AgentErrorCode,
    message: string,
    readonly detail: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'AgentError';
  }
}
