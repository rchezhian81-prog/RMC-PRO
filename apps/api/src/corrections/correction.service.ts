import { BadRequestException, Injectable } from '@nestjs/common';
import { TenantDbService } from '../core/database/tenant-db.service';
import { DocumentCorrection } from '../core/database/entities';
import { AuditService, AUDIT_ACTIONS } from '../audit/audit.service';
import { listLimit } from '../common/list-limit.util';

const badReq = (message: string) => new BadRequestException({ code: 'VALIDATION_ERROR', message });

/**
 * Document correction / amendment trail (Plan F2). Records an edit to a posted
 * document — what field changed, old → new value, why, and by whom — and lists
 * the trail for a document. Each correction is also written to the system audit
 * log so the two views stay consistent.
 */
@Injectable()
export class CorrectionService {
  constructor(
    private readonly db: TenantDbService,
    private readonly audit: AuditService,
  ) {}

  /** Every correction with the person who recorded it by name. */
  list(tenantId: string, filters: { documentType?: string; documentId?: string } = {}, limit?: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const where: Record<string, unknown> = {};
      if (filters.documentType) where.documentType = filters.documentType;
      if (filters.documentId) where.documentId = filters.documentId;
      const rows = await m.getRepository(DocumentCorrection).find({ where, order: { createdAt: 'DESC' }, take: listLimit(limit) });
      const ids = [...new Set(rows.map((r) => r.correctedBy).filter((x): x is string => Boolean(x)))];
      const users: Array<{ id: string; name: string | null; email: string | null }> = ids.length
        ? await m.query(`SELECT id, name, email FROM users WHERE id = ANY($1::uuid[])`, [ids])
        : [];
      const by = new Map(users.map((u) => [u.id, u.name || u.email || null]));
      return rows.map((r) => ({ ...r, correctedByName: r.correctedBy ? by.get(r.correctedBy) ?? null : null }));
    });
  }

  async record(tenantId: string, dto: Record<string, unknown>, userId: string) {
    const documentType = String(dto.documentType ?? '').trim();
    const documentId = String(dto.documentId ?? '').trim();
    const field = String(dto.field ?? '').trim();
    if (!documentType) throw badReq('documentType required');
    if (!documentId) throw badReq('documentId required');
    if (!field) throw badReq('field required');

    const saved = await this.db.runInTenant(tenantId, (m) => {
      const repo = m.getRepository(DocumentCorrection);
      return repo.save(
        repo.create({
          tenantId, documentType, documentId,
          documentLabel: (dto.documentLabel as string) ?? null,
          field,
          oldValue: dto.oldValue === undefined || dto.oldValue === null ? null : String(dto.oldValue),
          newValue: dto.newValue === undefined || dto.newValue === null ? null : String(dto.newValue),
          reason: (dto.reason as string) ?? null,
          correctedBy: userId ?? null,
        }),
      );
    });

    await this.audit.record({
      tenantId, actorUserId: userId, action: AUDIT_ACTIONS.DOCUMENT_CORRECTION,
      entityType: documentType, entityId: documentId, entityLabel: saved.documentLabel ?? documentId,
      summary: `Corrected ${field} on ${documentType} ${saved.documentLabel ?? documentId}${saved.reason ? ` — ${saved.reason}` : ''}`,
      details: { field, oldValue: saved.oldValue, newValue: saved.newValue },
    });
    return saved;
  }
}
