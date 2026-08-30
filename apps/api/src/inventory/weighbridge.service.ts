import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantDbService } from '../core/database/tenant-db.service';
import { leavesTerminal } from '../common/state-machine.util';
import { Company, Material, MaterialInward, Supplier, UomConversion, WeighbridgeEntry } from '../core/database/entities';
import { nullifyEmpty } from '../common/sanitize';
import { NumberingService } from '../sales/numbering.service';
import { weighbridgeQuantity } from './weighbridge-uom.util';
import type { WeighbridgePdfData } from '../sales/pdf.service';

const round2 = (n: number): number => Math.round(n * 100) / 100;

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
      const derived = gross - tare;
      const net = dto.netWeight !== undefined ? num(dto.netWeight) : derived;
      if (net < 0) throw badReq('Net weight cannot be negative — check the gross and tare weights');
      // When the slip carries a real gross weight, the net must reconcile with
      // gross − tare — that integrity is the whole point of a weighbridge slip,
      // and this net later becomes stock. A hand-keyed net that contradicts the
      // weighed figures (or a tare above the gross) is rejected; a net-only entry
      // with no gross weighed is left alone.
      if (gross > 0) {
        if (tare > gross) throw badReq('Tare weight cannot exceed gross weight.');
        const tol = Math.max(1, gross * 0.005);
        if (Math.abs(net - derived) > tol) {
          throw badReq(`Net weight (${net}) does not reconcile with gross − tare (${derived}). Check the weights.`);
        }
      }
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
      // A matched entry has been converted to an inward, a cancelled one is
      // void — neither may be re-opened (that would enable a re-conversion).
      if (leavesTerminal(entry.status, status, ['matched', 'cancelled'])) {
        throw badReq(`A ${entry.status} weighbridge entry cannot change status`);
      }
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

      // One inward per weighbridge entry: block a repeat conversion that would
      // post the same truck's material into stock twice. Checks the inward table
      // (not the entry's status) so it holds even if the entry status is changed.
      const existingInward = await m.getRepository(MaterialInward).findOne({ where: { weighbridgeEntryId: id } });
      if (existingInward && existingInward.status !== 'cancelled') {
        throw badReq(`This weighbridge entry is already converted (inward ${existingInward.inwardNo})`);
      }

      const material = await m.getRepository(Material).findOne({ where: { id: entry.materialId } });
      // The weighbridge weighs in kg, but stock is kept in the material's UOM
      // (bulk material is usually the tonne) — convert so a 25 t load is not
      // booked as 25000. See weighbridgeQuantity.
      const conversions = (await m.getRepository(UomConversion).find()).map((c) => ({
        from: c.fromUom, to: c.toUom, factor: num(c.factor),
      }));
      const qty = weighbridgeQuantity(net, material?.uom, conversions);
      const rate = num(dto.rate);
      const inwardNo = await this.numbering.next(m, tenantId, 'material_inward', 'INW-');
      const repo = m.getRepository(MaterialInward);
      const inward = await repo.save(
        repo.create({
          tenantId, inwardNo, plantId: entry.plantId, supplierId: entry.supplierId,
          materialId: entry.materialId, materialLabel: entry.materialLabel ?? material?.materialName ?? null,
          uom: material?.uom ?? null, vehicleNo: entry.vehicleNo, supplierChallanNo: entry.supplierChallanNo,
          weighbridgeEntryId: entry.id, quantityReceived: String(qty), quantityAccepted: String(qty),
          rate: String(rate), amount: String(round2(qty * rate)), status: 'draft',
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
