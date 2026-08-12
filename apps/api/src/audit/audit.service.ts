import { Injectable, Logger } from '@nestjs/common';
import { Brackets } from 'typeorm';
import { TenantDbService } from '../core/database/tenant-db.service';
import { AuditLog, User } from '../core/database/entities';

/** A consequential action worth remembering. */
export interface AuditEvent {
  tenantId: string;
  /** Who did it. Null only for a genuinely system-initiated event. */
  actorUserId: string | null;
  /** Stable machine key, e.g. `credit_hold.release`. See `AUDIT_ACTIONS`. */
  action: string;
  /** One plain sentence for a non-technical reader. */
  summary: string;
  entityType?: string;
  entityId?: string | null;
  entityLabel?: string | null;
  details?: Record<string, unknown>;
  ipAddress?: string | null;
}

export interface AuditQuery {
  entityType?: string;
  entityId?: string;
  action?: string;
  /** Free-text over summary and actor email. */
  search?: string;
  limit?: number;
  offset?: number;
}

/**
 * Keys under which anything even resembling a secret is hidden before an event
 * is stored. The trail records that a password was reset, never the password.
 */
const SENSITIVE_KEY = /pass|secret|token|hash|authorization|credential|otp|key$/i;
const REDACTED = '[redacted]';

/** Recursively replace sensitive values so no secret is ever written to the trail. */
function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEY.test(k) ? REDACTED : redact(v, depth + 1);
  }
  return out;
}

@Injectable()
export class AuditService {
  private readonly log = new Logger(AuditService.name);

  constructor(private readonly db: TenantDbService) {}

  /**
   * Write one event.
   *
   * Deliberately best-effort: it runs in its own short transaction after the
   * business action has already committed, and a failure is logged loudly but
   * never re-thrown. An audit trail that could roll back a credit-hold release
   * — or block one because of its own bug — would be worse than one that, in a
   * rare failure, is briefly incomplete. Completeness is guarded by the loud log
   * line, not by taking the operation down with it.
   */
  async record(event: AuditEvent): Promise<void> {
    try {
      const actor = event.actorUserId ? await this.lookupActor(event.actorUserId) : null;
      await this.db.runInTenant(event.tenantId, (m) => {
        const repo = m.getRepository(AuditLog);
        return repo.save(
          repo.create({
            tenantId: event.tenantId,
            actorUserId: event.actorUserId ?? null,
            actorEmail: actor?.email ?? null,
            actorName: actor?.name ?? null,
            action: event.action,
            entityType: event.entityType ?? null,
            entityId: event.entityId ?? null,
            entityLabel: event.entityLabel ?? null,
            summary: event.summary,
            details: event.details ? (redact(event.details) as Record<string, unknown>) : null,
            ipAddress: event.ipAddress ?? null,
          }),
        );
      });
    } catch (err) {
      this.log.error(
        `Audit write failed for '${event.action}' (tenant ${event.tenantId}): ` +
          (err instanceof Error ? err.message : String(err)),
      );
    }
  }

  /** The trail, newest first, with optional filters. Read-only. */
  async list(tenantId: string, query: AuditQuery = {}) {
    const limit = Math.min(Math.max(Number(query.limit) || 100, 1), 500);
    const offset = Math.max(Number(query.offset) || 0, 0);
    return this.db.runInTenant(tenantId, async (m) => {
      const qb = m
        .getRepository(AuditLog)
        .createQueryBuilder('a')
        .orderBy('a.created_at', 'DESC')
        .limit(limit)
        .offset(offset);
      if (query.entityType) qb.andWhere('a.entity_type = :et', { et: query.entityType });
      if (query.entityId) qb.andWhere('a.entity_id = :eid', { eid: query.entityId });
      if (query.action) qb.andWhere('a.action = :act', { act: query.action });
      if (query.search) {
        qb.andWhere(
          new Brackets((w) =>
            w
              .where('a.summary ILIKE :q', { q: `%${query.search}%` })
              .orWhere('a.actor_email ILIKE :q', { q: `%${query.search}%` }),
          ),
        );
      }
      const rows = await qb.getMany();
      return rows.map((r) => ({
        id: r.id,
        at: r.createdAt,
        actor: r.actorName || r.actorEmail || (r.actorUserId ? 'Unknown user' : 'System'),
        actorEmail: r.actorEmail,
        action: r.action,
        entityType: r.entityType,
        entityId: r.entityId,
        entityLabel: r.entityLabel,
        summary: r.summary,
        details: r.details,
      }));
    });
  }

  private async lookupActor(userId: string): Promise<{ email: string; name: string } | null> {
    // Resolving who the actor is — often a super-admin (tenant_id NULL) acting
    // on a tenant's data — is an identity lookup, so it runs in the platform
    // context; a plain read of the RLS-scoped users table would find nothing.
    const u = await this.db.runAsPlatform((m) =>
      m.getRepository(User).findOne({ where: { id: userId } }),
    );
    return u ? { email: u.email, name: u.name } : null;
  }
}

/**
 * The actions worth a permanent record — the approvals, cancellations and
 * account changes an auditor reviews. Kept as constants so the same key is used
 * at the write site and when filtering the trail.
 */
export const AUDIT_ACTIONS = {
  CREDIT_HOLD_RELEASE: 'credit_hold.release',
  CREDIT_HOLD_REJECT: 'credit_hold.reject',
  ORDER_CANCEL: 'order.cancel',
  INVOICE_CANCEL: 'invoice.cancel',
  INVOICE_TRANSPORT: 'invoice.transport_update',
  INVOICE_WRITEOFF: 'invoice.writeoff',
  RECEIPT_BOUNCE: 'receipt.bounce',
  QUOTATION_APPROVE: 'quotation.approve',
  QUOTATION_REJECT: 'quotation.reject',
  RATE_CONTRACT_APPROVE: 'rate_contract.approve',
  RATE_CONTRACT_REJECT: 'rate_contract.reject',
  MIX_DESIGN_APPROVE: 'mix_design.approve',
  MIX_DESIGN_REJECT: 'mix_design.reject',
  NEGATIVE_STOCK_APPROVE: 'negative_stock.approve',
  NEGATIVE_STOCK_REJECT: 'negative_stock.reject',
  USER_CREATE: 'user.create',
  USER_DEACTIVATE: 'user.deactivate',
  USER_REACTIVATE: 'user.reactivate',
  USER_PASSWORD_RESET: 'user.password_reset',
  USER_ROLE_CHANGE: 'user.role_change',
  TENANT_STATUS_CHANGE: 'tenant.status_change',
  TENANT_MODULE_CHANGE: 'tenant.module_change',
  TENANT_PLAN_ASSIGN: 'tenant.plan_assign',
  TENANT_DATA_EXPORT: 'tenant.data_export',
} as const;
