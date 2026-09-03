import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantDbService } from '../core/database/tenant-db.service';
import { Material, MaterialInward } from '../core/database/entities';
import { nullifyEmpty } from '../common/sanitize';
import { NumberingService } from '../sales/numbering.service';
import { StockService } from '../production/stock.service';

const notFound = () => new NotFoundException({ code: 'RECORD_NOT_FOUND', message: 'Inward not found' });
const badReq = (message: string) => new BadRequestException({ code: 'VALIDATION_ERROR', message });
const num = (v: unknown): number => Number(v ?? 0) || 0;

/**
 * Material inward / GRN (Design Doc 6 §12.3). Draft → posted; posting increases
 * stock via the ledger. Billing/valuation stays basic (rate × accepted qty).
 */
@Injectable()
export class MaterialInwardService {
  constructor(
    private readonly db: TenantDbService,
    private readonly numbering: NumberingService,
    private readonly stock: StockService,
  ) {}

  list(tenantId: string, status?: string) {
    return this.db.runInTenant(tenantId, (m) =>
      m.getRepository(MaterialInward).find({ where: status ? { status } : {}, order: { createdAt: 'DESC' } }),
    );
  }

  get(tenantId: string, id: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const row = await m.getRepository(MaterialInward).findOne({ where: { id } });
      if (!row) throw notFound();
      return row;
    });
  }

  create(tenantId: string, dto: Record<string, unknown>) {
    if (!String(dto.materialId ?? '')) throw badReq('materialId required');
    return this.db.runInTenant(tenantId, async (m) => {
      const material = await m.getRepository(Material).findOne({ where: { id: String(dto.materialId) } });
      const inwardNo = await this.numbering.next(m, tenantId, 'material_inward', 'INW-');
      const received = num(dto.quantityReceived);
      if (received <= 0) throw badReq('Received quantity must be greater than zero');
      const accepted = dto.quantityAccepted !== undefined ? num(dto.quantityAccepted) : received;
      if (accepted < 0 || accepted > received + 0.0005) throw badReq('Accepted quantity must be between 0 and received');
      const rate = num(dto.rate);
      if (rate < 0) throw badReq('Rate cannot be negative');
      const rest = nullifyEmpty(dto);
      for (const k of ['id', 'tenantId', 'inwardNo', 'status', 'amount']) delete rest[k];
      const repo = m.getRepository(MaterialInward);
      const inward = await repo.save(
        repo.create({
          ...rest, tenantId, inwardNo,
          materialLabel: (dto.materialLabel as string) ?? material?.materialName ?? null,
          uom: (dto.uom as string) ?? material?.uom ?? null,
          quantityReceived: String(received), quantityAccepted: String(accepted),
          rate: String(rate), amount: String(accepted * rate), status: 'draft',
        } as Record<string, unknown>),
      );
      return repo.findOne({ where: { id: inward.id } });
    });
  }

  /** Post the inward: add accepted quantity to stock. */
  post(tenantId: string, id: string, userId: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(MaterialInward);
      // Lock the inward row so a double-submit serializes: the second post blocks
      // until the first commits, then sees status='posted' and is rejected —
      // otherwise it would add the accepted quantity to stock twice for one load.
      const inward = await repo.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!inward) throw notFound();
      if (inward.status !== 'draft') throw badReq(`Inward already ${inward.status}`);
      if (!inward.materialId) throw badReq('Inward has no material');
      const accepted = num(inward.quantityAccepted);
      if (accepted <= 0) throw badReq('Accepted quantity must be greater than zero');

      const balanceAfter = await this.stock.applyDeltaWithin(m, tenantId, {
        plantId: inward.plantId, materialId: inward.materialId, materialLabel: inward.materialLabel,
        uom: inward.uom, delta: accepted, txnType: 'inward',
        referenceType: 'material_inward', referenceId: inward.id,
        remarks: `Inward ${inward.inwardNo}`, createdBy: userId,
      });
      await repo.update(id, { status: 'posted' });
      return { ...(await repo.findOne({ where: { id } })), balanceAfter };
    });
  }

  cancel(tenantId: string, id: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(MaterialInward);
      const inward = await repo.findOne({ where: { id } });
      if (!inward) throw notFound();
      if (inward.status === 'posted') throw badReq('Posted inward cannot be cancelled');
      await repo.update(id, { status: 'cancelled' });
      return repo.findOne({ where: { id } });
    });
  }
}
