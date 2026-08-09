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

  list(tenantId: string) {
    return this.db.runInTenant(tenantId, (m) =>
      m.getRepository(Lead).find({ order: { createdAt: 'DESC' } }),
    );
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
