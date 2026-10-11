import { listLimit } from '../common/list-limit.util';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { validateMasterFields } from '@rmc/shared';
import { TenantDbService } from '../core/database/tenant-db.service';
import { Customer, Lead, LeadFollowup, Site, User } from '../core/database/entities';
import { nullifyEmpty } from '../common/sanitize';
import { assertFields } from '../common/validation';
import { AuditService, AUDIT_ACTIONS } from '../audit/audit.service';
import { NumberingService, defaultPrefixFor } from './numbering.service';

const notFound = () => new NotFoundException({ code: 'RECORD_NOT_FOUND', message: 'Not found' });

/** What a lead carries beside its own columns: the marketing person's name and the customer it became. */
interface LeadRefs {
  assignedSalesUserName: string | null;
  linkedCustomerName: string | null;
  linkedCustomerCode: string | null;
}

/** Sales leads + follow-ups (Design Doc 6 §8.1). */
@Injectable()
export class LeadsService {
  constructor(
    private readonly db: TenantDbService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Resolve the marketing person (a user of this company) and the linked
   * customer for a set of leads: two grouped queries, not one per lead.
   * Keyed by lead id.
   */
  private async refsFor(m: EntityManager, leads: Lead[]): Promise<Map<string, LeadRefs>> {
    const out = new Map<string, LeadRefs>();
    const userIds = [...new Set(leads.map((l) => l.assignedSalesUserId).filter((x): x is string => Boolean(x)))];
    const customerIds = [...new Set(leads.map((l) => l.customerId).filter((x): x is string => Boolean(x)))];
    const users = userIds.length
      ? ((await m.query(`SELECT id, name FROM users WHERE id = ANY($1::uuid[])`, [userIds])) as Array<{ id: string; name: string }>)
      : [];
    const customers = customerIds.length
      ? ((await m.query(`SELECT id, customer_code AS code, customer_name AS name FROM customers WHERE id = ANY($1::uuid[])`, [customerIds])) as Array<{ id: string; code: string; name: string }>)
      : [];
    const userName = new Map(users.map((u) => [u.id, u.name]));
    const customer = new Map(customers.map((c) => [c.id, c]));
    for (const l of leads) {
      const c = l.customerId ? customer.get(l.customerId) : undefined;
      out.set(l.id, {
        assignedSalesUserName: (l.assignedSalesUserId && userName.get(l.assignedSalesUserId)) || null,
        linkedCustomerName: c?.name ?? null,
        linkedCustomerCode: c?.code ?? null,
      });
    }
    return out;
  }

  /**
   * The marketing person must be a user of THIS company. Postgres checks no FK
   * here, and a foreign id would show as nobody on every screen.
   */
  private async assertAssignee(m: EntityManager, dto: Record<string, unknown>): Promise<void> {
    if (dto.assignedSalesUserId === undefined || dto.assignedSalesUserId === null) return;
    const user = await m.getRepository(User).findOne({ where: { id: String(dto.assignedSalesUserId) } });
    if (!user || user.userType !== 'tenant_user') {
      assertFields({ assignedSalesUserId: 'Choose a person from Setup → Users.' });
    }
  }

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
      const refs = await this.refsFor(m, leads);
      return leads.map((l) => {
        const f = fu.get(l.id);
        const q = qu.get(l.id);
        return {
          ...l,
          ...refs.get(l.id),
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
      const refs = await this.refsFor(m, [lead]);
      return { ...lead, ...refs.get(lead.id), followups };
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
      // The customer link is made by createCustomer, never typed in.
      delete rest.customerId;
      await this.assertAssignee(m, rest);
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
      delete rest.customerId;
      await this.assertAssignee(m, rest);
      await repo.update(id, rest as Record<string, unknown>);
      return repo.findOne({ where: { id } });
    });
  }

  /**
   * Turn a lead into a customer under Masters: the customer (name, contact,
   * mobile, email; code from the `customer` series) and, when the lead names a
   * site location, a site for that customer (code from the `site` series).
   * One transaction, so a refused site leaves no half-made customer. Runs
   * once per lead: a lead that already has a customer is refused.
   */
  async createCustomer(tenantId: string, leadId: string, userId?: string | null) {
    const result = await this.db.runInTenant(tenantId, async (m) => {
      const lead = await m.getRepository(Lead).findOne({ where: { id: leadId } });
      if (!lead) throw notFound();
      if (lead.customerId) {
        const existing = await m.getRepository(Customer).findOne({ where: { id: lead.customerId } });
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: `This lead already has a customer${existing ? `: ${existing.customerName} (${existing.customerCode})` : ''}. Open it under Masters → Customers.`,
        });
      }
      const customerDto = {
        customerName: lead.customerName,
        contactPerson: lead.contactPerson,
        mobile: lead.mobile,
        email: lead.email,
      };
      // Same field rules as a customer typed in by hand, so a bad mobile on the
      // lead is fixed on the lead rather than copied into the master.
      const problems = validateMasterFields(customerDto);
      if (Object.keys(problems).length) {
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: `Fix the lead first: ${Object.values(problems).join(' ')}`,
          fields: problems,
        });
      }
      const customers = m.getRepository(Customer);
      const customer = await customers.save(
        customers.create({
          ...customerDto,
          tenantId,
          customerCode: await this.numbering.next(m, tenantId, 'customer', defaultPrefixFor('customer')),
        }),
      );
      let site: Site | null = null;
      const location = (lead.siteLocation ?? '').trim();
      if (location) {
        const sites = m.getRepository(Site);
        site = await sites.save(
          sites.create({
            tenantId,
            customerId: customer.id,
            siteCode: await this.numbering.next(m, tenantId, 'site', defaultPrefixFor('site')),
            siteName: location,
            address: location,
            contactPerson: lead.contactPerson,
            mobile: lead.mobile,
          }),
        );
      }
      await m.getRepository(Lead).update(leadId, { customerId: customer.id });
      return { lead, customer, site };
    });
    const { lead, customer, site } = result;
    await this.audit.record({
      tenantId,
      actorUserId: userId ?? null,
      action: AUDIT_ACTIONS.MASTER_CREATE,
      entityType: 'customer',
      entityId: customer.id,
      entityLabel: customer.customerName,
      summary: `Created customer ${customer.customerName} (${customer.customerCode}) from lead ${lead.leadNo}`,
      details: { leadId: lead.id, leadNo: lead.leadNo, siteId: site?.id ?? null },
    });
    if (site) {
      await this.audit.record({
        tenantId,
        actorUserId: userId ?? null,
        action: AUDIT_ACTIONS.MASTER_CREATE,
        entityType: 'site',
        entityId: site.id,
        entityLabel: site.siteName,
        summary: `Created site ${site.siteName} (${site.siteCode}) from lead ${lead.leadNo}`,
        details: { leadId: lead.id, leadNo: lead.leadNo, customerId: customer.id },
      });
    }
    return {
      customerId: customer.id,
      customerCode: customer.customerCode,
      customerName: customer.customerName,
      siteId: site?.id ?? null,
      siteCode: site?.siteCode ?? null,
    };
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
