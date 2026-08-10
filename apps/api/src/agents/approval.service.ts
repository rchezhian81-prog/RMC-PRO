import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { TenantDbService } from '../core/database/tenant-db.service';
import { AgentApprovalRequest } from '../core/database/entities';

/** Keys whose values are scrubbed before a prepared action is stored. */
const SENSITIVE_KEY = /pass|secret|token|hash|authorization|credential|otp|key$/i;
const REDACTED = '[redacted]';

/** Recursively redact anything resembling a secret from a prepared payload. */
export function scrubPayload(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => scrubPayload(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEY.test(k) ? REDACTED : scrubPayload(v, depth + 1);
  }
  return out;
}

/** Pure: a request may be decided only while it is still pending. */
export function canDecide(status: string): boolean {
  return status === 'pending';
}

export interface PrepareApprovalInput {
  tenantId: string;
  runId: string | null;
  agentName: string;
  actionKind: string;
  title: string;
  payload?: Record<string, unknown> | null;
  reversibility?: string | null;
  requestedBy: string | null;
}

/**
 * The L2 approval substrate (M4). An agent PREPARES a high-risk action here as
 * `pending` (never executing it); a human with `agents.approve` decides. Only a
 * pending request may be decided, and it is decided exactly once — the status
 * machine (`canDecide`) makes a double-decision a 409, not a silent overwrite.
 */
@Injectable()
export class ApprovalService {
  constructor(private readonly db: TenantDbService) {}

  /**
   * Insert a pending request using a caller-supplied, tenant-scoped manager —
   * for use INSIDE an agent tool, which already runs within `runInTenant`.
   */
  prepare(manager: EntityManager, input: PrepareApprovalInput): Promise<AgentApprovalRequest> {
    const repo = manager.getRepository(AgentApprovalRequest);
    return repo.save(
      repo.create({
        tenantId: input.tenantId,
        runId: input.runId,
        agentName: input.agentName,
        actionKind: input.actionKind,
        title: input.title,
        payload: (input.payload ? scrubPayload(input.payload) : null) as Record<string, unknown> | null,
        reversibility: input.reversibility ?? null,
        status: 'pending',
        requestedBy: input.requestedBy,
      }),
    );
  }

  /** Pending (or all/other-status) requests for a tenant, newest first. */
  list(tenantId: string, status = 'pending', limit = 100): Promise<AgentApprovalRequest[]> {
    const capped = Math.min(Math.max(limit, 1), 500);
    return this.db.runInTenant(tenantId, (m) =>
      m.getRepository(AgentApprovalRequest).find({
        where: status === 'all' ? { tenantId } : { tenantId, status },
        order: { createdAt: 'DESC' },
        take: capped,
      }),
    );
  }

  /** Approve or reject a pending request (the human-in-the-loop L2 gate). */
  decide(
    tenantId: string,
    id: string,
    decision: 'approved' | 'rejected',
    decidedBy: string | null,
    reason?: string,
  ): Promise<AgentApprovalRequest> {
    return this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(AgentApprovalRequest);
      const row = await repo.findOne({ where: { id, tenantId } });
      if (!row) throw new NotFoundException({ code: 'NOT_FOUND', message: 'approval request not found' });
      if (!canDecide(row.status)) {
        throw new ConflictException({
          code: 'ALREADY_DECIDED',
          message: `request is already ${row.status}`,
        });
      }
      row.status = decision;
      row.decidedBy = decidedBy;
      row.decidedAt = new Date();
      row.decisionReason = reason ?? null;
      return repo.save(row);
    });
  }
}
