import { listLimit } from '../common/list-limit.util';
import { round2 } from '../common/money.util';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantDbService } from '../core/database/tenant-db.service';
import { leavesTerminal } from '../common/state-machine.util';
import { Company, Material, MaterialInward, Supplier, TenantSetting, UomConversion, WeighbridgeEntry } from '../core/database/entities';
import { INDICATOR_ONLY_SETTING_KEY, INDICATOR_READING_WINDOW_MINUTES, indicatorOnlyWeighing } from '@rmc/shared';
import type { EntityManager } from 'typeorm';
import { nullifyEmpty } from '../common/sanitize';
import { NumberingService } from '../sales/numbering.service';
import { weighbridgeQuantity } from './weighbridge-uom.util';
import { plantDateTime } from '../common/business-date.util';
import { companyBlock, type WeighbridgePdfData } from '../sales/pdf.service';


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

  /**
   * The slip list with what the gate reads it by: the supplier's name, the
   * indicator the weights came off, the material's stock unit, and the inward
   * a converted slip became. Batched lookups.
   */
  list(tenantId: string, status?: string, limit?: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const rows = await m.getRepository(WeighbridgeEntry).find({ where: status ? { status } : {}, order: { createdAt: 'DESC' }, take: listLimit(limit) });
      const ids = (pick: (r: WeighbridgeEntry) => string | null) => [...new Set(rows.map(pick).filter((v): v is string => !!v))];
      const supplierIds = ids((r) => r.supplierId);
      const indicatorIds = ids((r) => r.indicatorId);
      const materialIds = ids((r) => r.materialId);
      const entryIds = rows.map((r) => r.id);
      const [suppliers, indicators, materials, inwards] = await Promise.all([
        supplierIds.length ? (m.query(`SELECT id, supplier_name AS "supplierName" FROM suppliers WHERE id = ANY($1)`, [supplierIds]) as Promise<Array<{ id: string; supplierName: string }>>) : Promise.resolve([]),
        indicatorIds.length ? (m.query(`SELECT id, name FROM weighbridge_indicators WHERE id = ANY($1)`, [indicatorIds]) as Promise<Array<{ id: string; name: string }>>) : Promise.resolve([]),
        materialIds.length ? (m.query(`SELECT id, uom FROM materials WHERE id = ANY($1)`, [materialIds]) as Promise<Array<{ id: string; uom: string | null }>>) : Promise.resolve([]),
        entryIds.length
          ? (m.query(
              `SELECT DISTINCT ON (weighbridge_entry_id) weighbridge_entry_id AS "entryId", id AS "inwardId", inward_no AS "inwardNo", status AS "inwardStatus"
                 FROM material_inwards WHERE weighbridge_entry_id = ANY($1)
                ORDER BY weighbridge_entry_id, (status = 'cancelled'), created_at DESC`,
              [entryIds],
            ) as Promise<Array<{ entryId: string; inwardId: string; inwardNo: string; inwardStatus: string }>>)
          : Promise.resolve([]),
      ]);
      const supplier = new Map(suppliers.map((s) => [s.id, s.supplierName]));
      const indicator = new Map(indicators.map((i) => [i.id, i.name]));
      const uom = new Map(materials.map((x) => [x.id, x.uom]));
      const inward = new Map(inwards.map((i) => [i.entryId, i]));
      return rows.map((r) => {
        const inw = inward.get(r.id);
        return {
          ...r,
          supplierName: r.supplierId ? supplier.get(r.supplierId) ?? null : null,
          indicatorName: r.indicatorId ? indicator.get(r.indicatorId) ?? null : null,
          materialUom: r.materialId ? uom.get(r.materialId) ?? null : null,
          inwardId: inw?.inwardId ?? null,
          inwardNo: inw?.inwardNo ?? null,
          inwardStatus: inw?.inwardStatus ?? null,
        };
      });
    });
  }

  get(tenantId: string, id: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const row = await m.getRepository(WeighbridgeEntry).findOne({ where: { id } });
      if (!row) throw notFound();
      return row;
    });
  }

  /** The gate's weighing policy: whether weights must come off an indicator, and how fresh a reading has to be. */
  policy(tenantId: string) {
    return this.db.runInTenant(tenantId, async (m) => ({
      indicatorOnly: await this.indicatorOnly(m),
      readingWindowMinutes: INDICATOR_READING_WINDOW_MINUTES,
    }));
  }

  private async indicatorOnly(m: EntityManager): Promise<boolean> {
    const row = await m.getRepository(TenantSetting).findOne({ where: { settingKey: INDICATOR_ONLY_SETTING_KEY } });
    return indicatorOnlyWeighing(row?.settingValue);
  }

  /**
   * Indicator-only weighing: every weight on the slip must be one the named
   * indicator actually gave, stable, within the last few minutes. The client
   * saying "device" is not enough — the figure is matched against the reading
   * log, within the indicator's own rounding (5 kg or 0.2%, whichever is more).
   * Nothing typed, edited or invented at the gate becomes stock.
   */
  private async assertIndicatorWeights(m: EntityManager, dto: Record<string, unknown>, weights: number[]): Promise<void> {
    if (!(await this.indicatorOnly(m))) return;
    const refuse = (why: string) => badReq(`Indicator-only weighing is on: ${why}`);
    if (dto.weightSource !== 'device' || !dto.indicatorId) throw refuse('press Get to read the weight off the indicator; weights cannot be keyed by hand.');
    if (dto.manualOverride === true) throw refuse('a reading taken off the indicator cannot be edited.');
    const indicatorId = String(dto.indicatorId);
    const recent: Array<{ weightKg: string }> = await m.query(
      `SELECT weight_kg AS "weightKg" FROM weighbridge_readings
        WHERE indicator_id = $1 AND stable AND read_at >= now() - ($2 || ' minutes')::interval
        ORDER BY read_at DESC LIMIT 200`,
      [indicatorId, String(INDICATOR_READING_WINDOW_MINUTES)],
    );
    for (const w of weights) {
      if (!(w > 0)) continue;
      const tol = Math.max(5, w * 0.002);
      if (!recent.some((r) => Math.abs(num(r.weightKg) - w) <= tol)) {
        throw refuse(`${w} kg is not a reading this indicator gave in the last ${INDICATOR_READING_WINDOW_MINUTES} minutes. Press Get again with the truck on the bridge.`);
      }
    }
  }

  create(tenantId: string, dto: Record<string, unknown>, userId: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const material = dto.materialId ? await m.getRepository(Material).findOne({ where: { id: String(dto.materialId) } }) : null;
      if (dto.materialId && !material) throw badReq('Material not found');
      const gross = num(dto.grossWeight);
      const tare = num(dto.tareWeight);
      await this.assertIndicatorWeights(m, dto, [gross, tare]);
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

  /**
   * The second weighing of a truck whose first weight is already on a draft
   * slip. A supplier truck is weighed loaded first and empty on the way out; a
   * transit mixer is weighed empty first and loaded on the way out — so the
   * slip does not care which came first: the heavier reading is the gross,
   * the lighter the tare, and the net is the difference. Completes the slip.
   */
  secondWeight(tenantId: string, id: string, dto: Record<string, unknown>) {
    const weight = num(dto.weight);
    if (!(weight > 0)) throw badReq('Enter the second weight in kg.');
    return this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(WeighbridgeEntry);
      const entry = await repo.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!entry) throw notFound();
      if (entry.status !== 'draft') throw badReq(`A ${entry.status} slip cannot take a second weight.`);
      await this.assertIndicatorWeights(m, dto, [weight]);
      const first = num(entry.grossWeight) > 0 ? num(entry.grossWeight) : num(entry.tareWeight);
      if (!(first > 0)) throw badReq('The slip has no first weight.');
      if (num(entry.tareWeight) > 0 && num(entry.grossWeight) > 0) throw badReq('Both weights are already on the slip; press Complete weighing.');
      const gross = Math.max(first, weight);
      const tare = Math.min(first, weight);
      const net = gross - tare;
      if (!(net > 0)) throw badReq('The two weights are the same, so the net would be zero. Check the reading.');
      const fromDevice = dto.weightSource === 'device';
      await repo.update(
        { id, status: 'draft' },
        {
          grossWeight: String(gross), tareWeight: String(tare), netWeight: String(net), status: 'completed',
          // One device read on either weighing marks the slip as device-captured;
          // a hand-keyed second weight on a device-read first is an override.
          weightSource: fromDevice || entry.weightSource === 'device' ? 'device' : 'manual',
          indicatorId: fromDevice && dto.indicatorId ? String(dto.indicatorId) : entry.indicatorId,
          manualOverride: entry.manualOverride || (!fromDevice && entry.weightSource === 'device') || dto.manualOverride === true,
        },
      );
      return repo.findOne({ where: { id } });
    });
  }

  setStatus(tenantId: string, id: string, status: string) {
    const allowed = ['draft', 'completed', 'matched', 'mismatch', 'cancelled'];
    if (!allowed.includes(status)) throw badReq(`Invalid status ${status}`);
    return this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(WeighbridgeEntry);
      // Lock the row: two transitions at once both read the same status, both
      // clear the terminal check below, and the later write silently wins — which
      // is how a 'matched' entry gets re-opened and re-converted.
      const entry = await repo.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!entry) throw notFound();
      // A matched entry has been converted to an inward, a cancelled one is
      // void — neither may be re-opened (that would enable a re-conversion).
      if (leavesTerminal(entry.status, status, ['matched', 'cancelled'])) {
        throw badReq(`A ${entry.status} weighbridge entry cannot change status`);
      }
      const res = await repo.update({ id, status: entry.status }, { status });
      if (!res.affected) throw badReq('Weighbridge entry changed status concurrently — retry');
      return repo.findOne({ where: { id } });
    });
  }

  /** Convert a weighbridge entry into a draft material inward (net → received). */
  toInward(tenantId: string, id: string, dto: Record<string, unknown>, _userId: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const entry = await m.getRepository(WeighbridgeEntry).findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!entry) throw notFound();
      if (entry.status === 'cancelled') throw badReq('Cancelled entry cannot be converted');
      // Only a finished weighing becomes stock. A 'draft' slip is still being
      // keyed — its gross/tare may yet change — so converting one posted a
      // provisional weight into the GRN and then into the stock ledger. ('matched'
      // stays convertible so the duplicate-inward guard below owns that message.)
      if (!['completed', 'mismatch', 'matched'].includes(entry.status)) {
        throw badReq(`A ${entry.status} weighbridge entry cannot be converted — complete the weighing first`);
      }
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
      // Mirror material-inward's guard — a negative rate would post a negative
      // amount into the GRN / valuation.
      if (rate < 0) throw badReq('Rate cannot be negative');
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
        ...companyBlock(company),
        slipNo: entry.slipNo,
        // The slip's time is what a supplier dispute is settled on; print it
        // on the plant clock, not UTC.
        entryDatetime: plantDateTime(entry.entryDatetime),
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
