import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantDbService } from '../core/database/tenant-db.service';
import { Company, Material, MaterialInward, Supplier, WeighbridgeEntry } from '../core/database/entities';
import { nullifyEmpty } from '../common/sanitize';
import { NumberingService } from '../sales/numbering.service';
import type { WeighbridgePdfData } from '../sales/pdf.service';

const notFound = () => new NotFoundException({ code: 'RECORD_NOT_FOUND', message: 'Weighbridge entry not found' });
const badReq = (message: string) => new BadRequestException({ code: 'VALIDATION_ERROR', message });
const num = (v: unknown): number => Number(v ?? 0) || 0;

/**
 * Weighbridge entries (Design Doc 6 §12.4) — MANUAL entry only (no hardware
 * link). net = gross − tare. A completed entry can be converted to a material
 * inward (draft) that is then posted to increase stock.
 */
@Injectable()
export class WeighbridgeService {
  constructor(
    private readonly db: TenantDbService,
    private readonly numbering: NumberingService,
  ) {}

  list(tenantId: string, status?: string) {
    return this.db.runInTenant(tenantId, (m) =>
      m.getRepository(WeighbridgeEntry).find({ where: status ? { status } : {}, order: { createdAt: 'DESC' } }),
    );
  }

  get(tenantId: string, id: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const row = await m.getRepository(WeighbridgeEntry).findOne({ where: { id } });
      if (!row) throw notFound();
      return row;
    });
  }

  create(tenantId: string, dto: Record<string, unknown>, userId: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const material = dto.materialId ? await m.getRepository(Material).findOne({ where: { id: String(dto.materialId) } }) : null;
      const gross = num(dto.grossWeight);
      const tare = num(dto.tareWeight);
      const net = dto.netWeight !== undefined ? num(dto.netWeight) : gross - tare;
      const slipNo = await this.numbering.next(m, tenantId, 'weighbridge', 'WB-');
      const rest = nullifyEmpty(dto);
      for (const k of ['id', 'tenantId', 'slipNo', 'status', 'netWeight', 'weightSource', 'indicatorId', 'manualOverride'])
        delete rest[k];
      // Provenance (Plan E1): a hand-keyed entry is 'manual'; the web "Get weight"
      // action stamps 'device' and the indicator it read from. manualOverride
      // records that an operator edited a device-captured weight before saving.
      const weightSource = dto.weightSource === 'device' ? 'device' : 'manual';
      const indicatorId = weightSource === 'device' && dto.indicatorId ? String(dto.indicatorId) : null;
      const manualOverride = weightSource === 'device' && dto.manualOverride === true;
      const repo = m.getRepository(WeighbridgeEntry);
      const entry = await repo.save(
        repo.create({
          ...rest, tenantId, slipNo,
          materialLabel: (dto.materialLabel as string) ?? material?.materialName ?? null,
          grossWeight: String(gross), tareWeight: String(tare), netWeight: String(net),
          entryDatetime: new Date(), operatorUserId: userId, status: 'draft',
          weightSource, indicatorId, manualOverride,
        } as Record<string, unknown>),
      );
      return repo.findOne({ where: { id: entry.id } });
    });
  }

  setStatus(tenantId: string, id: string, status: string) {
    const allowed = ['draft', 'completed', 'matched', 'mismatch', 'cancelled'];
    if (!allowed.includes(status)) throw badReq(`Invalid status ${status}`);
    return this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(WeighbridgeEntry);
      const entry = await repo.findOne({ where: { id } });
      if (!entry) throw notFound();
      await repo.update(id, { status });
      return repo.findOne({ where: { id } });
    });
  }

  /** Convert a weighbridge entry into a draft material inward (net → received). */
  toInward(tenantId: string, id: string, dto: Record<string, unknown>, _userId: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const entry = await m.getRepository(WeighbridgeEntry).findOne({ where: { id } });
      if (!entry) throw notFound();
      if (entry.status === 'cancelled') throw badReq('Cancelled entry cannot be converted');
      if (!entry.materialId) throw badReq('Weighbridge entry has no material');
      const net = num(entry.netWeight);
      if (net <= 0) throw badReq('Net weight must be greater than zero');

      const material = await m.getRepository(Material).findOne({ where: { id: entry.materialId } });
      const rate = num(dto.rate);
      const inwardNo = await this.numbering.next(m, tenantId, 'material_inward', 'INW-');
      const repo = m.getRepository(MaterialInward);
      const inward = await repo.save(
        repo.create({
          tenantId, inwardNo, plantId: entry.plantId, supplierId: entry.supplierId,
          materialId: entry.materialId, materialLabel: entry.materialLabel ?? material?.materialName ?? null,
          uom: material?.uom ?? null, vehicleNo: entry.vehicleNo, supplierChallanNo: entry.supplierChallanNo,
          weighbridgeEntryId: entry.id, quantityReceived: String(net), quantityAccepted: String(net),
          rate: String(rate), amount: String(net * rate), status: 'draft',
        }),
      );
      await m.getRepository(WeighbridgeEntry).update(id, { status: 'matched' });
      return { weighbridge: await m.getRepository(WeighbridgeEntry).findOne({ where: { id } }), inward };
    });
  }

  async pdfData(tenantId: string, id: string): Promise<{ data: WeighbridgePdfData; slipNo: string }> {
    return this.db.runInTenant(tenantId, async (m) => {
      const entry = await m.getRepository(WeighbridgeEntry).findOne({ where: { id } });
      if (!entry) throw notFound();
      const company = (await m.getRepository(Company).find({ take: 1 }))[0];
      const supplier = entry.supplierId ? await m.getRepository(Supplier).findOne({ where: { id: entry.supplierId } }) : null;
      const data: WeighbridgePdfData = {
        companyName: company?.companyName ?? 'Company',
        slipNo: entry.slipNo,
        entryDatetime: entry.entryDatetime ? entry.entryDatetime.toISOString().slice(0, 16).replace('T', ' ') : null,
        vehicleNo: entry.vehicleNo ?? null,
        supplierName: supplier?.supplierName ?? null,
        materialLabel: entry.materialLabel ?? null,
        grossWeight: entry.grossWeight, tareWeight: entry.tareWeight, netWeight: entry.netWeight,
        supplierChallanNo: entry.supplierChallanNo ?? null,
        status: entry.status,
      };
      return { data, slipNo: entry.slipNo };
    });
  }
}
