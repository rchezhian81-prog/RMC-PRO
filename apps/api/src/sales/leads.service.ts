import { listLimit } from '../common/list-limit.util';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantDbService } from '../core/database/tenant-db.service';
import { Lead, LeadFollowup } from '../core/database/entities';
import { nullifyEmpty } from '../common/sanitize';
import { NumberingService } from './numbering.service';

const notFound = () => new NotFoundException({ code: 'RECORD_NOT_FOUND', message: 'Not found' });

/** Sales leads + follow-ups (Design Doc 6 §8.1). */
@Injectable()
export class LeadsService {
  constructor(
    private readonly db: TenantDbService,
    private readonly numbering: NumberingService,
  ) {}

  /**
   * The list carries what the pipeline screen needs beside each lead: how many
   * follow-ups it has had and what the last one said, and the latest quotation
   * raised from it (number and approval status). Two grouped queries over the
   * listed ids, not one per lead.
   */
  list(tenantId: string, limit?: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const leads = await m.getRepository(Lead).find({ order: { createdAt: 'DESC' }, take: listLimit(limit) });
      if (!leads.length) return leads;
      const ids = leads.map((l) => l.id);
      const followups: Array<{ leadId: string; followupCount: string; lastFollowupAt: Date; lastOutcome: string | null; lastNotes: string | null }> =
        await m.query(
          `SELECT DISTINCT ON (f.lead_id) f.lead_id AS "leadId",
                  COUNT(*) OVER (PARTITION BY f.lead_id) AS "followupCount",
                  f.created_at AS "lastFollowupAt", f.outcome AS "lastOutcome", f.notes AS "lastNotes"
             FROM lead_followups f
            WHERE f.lead_id = ANY($1::uuid[])
            ORDER BY f.lead_id, f.created_at DESC`,
          [ids],
        );
      const quotes: Array<{ leadId: string; quotationCount: string; quotationId: string; quotationNo: string; quotationStatus: string }> =
        await m.query(
          `SELECT DISTINCT ON (q.lead_id) q.lead_id AS "leadId",
                  COUNT(*) OVER (PARTITION BY q.lead_id) AS "quotationCount",
                  q.id AS "quotationId", q.quotation_no AS "quotationNo",
                  CASE WHEN q.status = 'converted' THEN 'converted' ELSE q.approval_status END AS "quotationStatus"
             FROM quotations q
            WHERE q.lead_id = ANY($1::uuid[])
            ORDER BY q.lead_id, q.created_at DESC`,
          [ids],
        );
      const fu = new Map(followups.map((f) => [f.leadId, f]));
      const qu = new Map(quotes.map((q) => [q.leadId, q]));
      return leads.map((l) => {
        const f = fu.get(l.id);
        const q = qu.get(l.id);
        return {
          ...l,
          followupCount: Number(f?.followupCount ?? 0),
          lastFollowupAt: f?.lastFollowupAt ?? null,
          lastOutcome: f?.lastOutcome ?? null,
          lastNotes: f?.lastNotes ?? null,
          quotationCount: Number(q?.quotationCount ?? 0),
          quotationId: q?.quotationId ?? null,
          quotationNo: q?.quotationNo ?? null,
          quotationStatus: q?.quotationStatus ?? null,
        };
      });
    });
  }

  get(tenantId: string, id: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const lead = await m.getRepository(Lead).findOne({ where: { id } });
      if (!lead) throw notFound();
      const followups = await m
        .getRepository(LeadFollowup)
        .find({ where: { leadId: id }, order: { createdAt: 'DESC' } });
      return { ...lead, followups };
    });
  }

  create(tenantId: string, dto: Record<string, unknown>) {
    if (!String(dto.customerName ?? '').trim()) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'customerName required' });
    }
    return this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(Lead);
      const leadNo = await this.numbering.next(m, tenantId, 'lead', 'LEAD-');
      const rest = nullifyEmpty(dto);
      delete rest.id;
      delete rest.tenantId;
      delete rest.leadNo;
      return repo.save(repo.create({ ...rest, tenantId, leadNo } as Record<string, unknown>));
    });
  }

  update(tenantId: string, id: string, dto: Record<string, unknown>) {
    return this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(Lead);
      const lead = await repo.findOne({ where: { id } });
      if (!lead) throw notFound();
      const rest = nullifyEmpty(dto);
      delete rest.id;
      delete rest.tenantId;
      delete rest.leadNo;
      await repo.update(id, rest as Record<string, unknown>);
      return repo.findOne({ where: { id } });
    });
  }

  addFollowup(tenantId: string, leadId: string, dto: Record<string, unknown>) {
    return this.db.runInTenant(tenantId, async (m) => {
      const leadRepo = m.getRepository(Lead);
      const lead = await leadRepo.findOne({ where: { id: leadId } });
      if (!lead) throw notFound();
      const clean = nullifyEmpty(dto);
      const repo = m.getRepository(LeadFollowup);
      const followup = await repo.save(
        repo.create({
          tenantId,
          leadId,
          followupDate: (clean.followupDate as string) ?? null,
          notes: (clean.notes as string) ?? null,
          outcome: (clean.outcome as string) ?? null,
          nextFollowupDate: (clean.nextFollowupDate as string) ?? null,
          status: (clean.status as string) ?? 'done',
        }),
      );
      // Roll the lead's next follow-up date and stage forward when supplied.
      const patch: Record<string, unknown> = {};
      if (clean.nextFollowupDate != null) patch.nextFollowupDate = clean.nextFollowupDate;
      if (clean.leadStage != null) patch.leadStage = clean.leadStage;
      if (Object.keys(patch).length) await leadRepo.update(leadId, patch);
      return followup;
    });
  }

  listFollowups(tenantId: string, leadId: string) {
    return this.db.runInTenant(tenantId, (m) =>
      m.getRepository(LeadFollowup).find({ where: { leadId }, order: { createdAt: 'DESC' } }),
    );
  }
}
