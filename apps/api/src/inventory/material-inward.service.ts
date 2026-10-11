import { listLimit } from '../common/list-limit.util';
import { round2 } from '../common/money.util';
import { resolveRef } from '../common/resolve-ref';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { TenantDbService } from '../core/database/tenant-db.service';
import { Material, MaterialInward, Plant, Supplier, WeighbridgeEntry } from '../core/database/entities';
import { nullifyEmpty } from '../common/sanitize';
import { NumberingService } from '../sales/numbering.service';
import { StockService } from '../production/stock.service';
import { resolveEnteredQuantity, uomConversionRows } from './entered-uom.util';
import { validateAttachment } from './inward-attachment';
import type { UomConversionRow } from '../masters/uom.util';

const notFound = () => new NotFoundException({ code: 'RECORD_NOT_FOUND', message: 'Inward not found' });
const badReq = (message: string) => new BadRequestException({ code: 'VALIDATION_ERROR', message });
const num = (v: unknown): number => Number(v ?? 0) || 0;
const text = (v: unknown): string | null => {
  const s = String(v ?? '').trim();
  return s ? s : null;
};

/** Columns the caller never sets directly: numbering, status, money, who posted, the attachment. */
const RESERVED = [
  'id', 'tenantId', 'inwardNo', 'status', 'amount', 'createdAt', 'updatedAt',
  'postedByUserId', 'attachmentName', 'attachmentMime', 'attachmentData',
  'uom', 'enteredUom', 'enteredQuantity', 'quantityReceived', 'quantityAccepted', 'rate',
];

/**
 * Material inward / GRN (Design Doc 6 §12.3). Draft → posted; posting increases
 * stock via the ledger and records who posted it. Billing/valuation stays
 * basic (rate × accepted qty). A truck carrying several materials is keyed as
 * one batch — a shared header, one inward per line, numbered in one go — and
 * the supplier's invoice can be attached to any live inward.
 */
@Injectable()
export class MaterialInwardService {
  constructor(
    private readonly db: TenantDbService,
    private readonly numbering: NumberingService,
    private readonly stock: StockService,
  ) {}

  /**
   * The inward list with what the gate reads it by: the supplier's name, the
   * material's code and standard rate (to judge the rate keyed), the plant,
   * the weighbridge slip the inward came from, who posted it, and whether an
   * invoice is attached (never the bytes). Batched lookups.
   */
  list(tenantId: string, status?: string, limit?: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const rows = await m.getRepository(MaterialInward).find({ where: status ? { status } : {}, order: { createdAt: 'DESC' }, take: listLimit(limit) });
      return this.decorate(m, rows);
    });
  }

  private async decorate(m: EntityManager, rows: MaterialInward[]) {
    const ids = (pick: (r: MaterialInward) => string | null) => [...new Set(rows.map(pick).filter((v): v is string => !!v))];
    const supplierIds = ids((r) => r.supplierId);
    const materialIds = ids((r) => r.materialId);
    const plantIds = ids((r) => r.plantId);
    const slipIds = ids((r) => r.weighbridgeEntryId);
    const userIds = ids((r) => r.postedByUserId);
    const [suppliers, materials, plants, slips, users] = await Promise.all([
      supplierIds.length ? (m.query(`SELECT id, supplier_name AS "supplierName" FROM suppliers WHERE id = ANY($1)`, [supplierIds]) as Promise<Array<{ id: string; supplierName: string }>>) : Promise.resolve([]),
      materialIds.length ? (m.query(`SELECT id, material_code AS "materialCode", standard_rate AS "standardRate" FROM materials WHERE id = ANY($1)`, [materialIds]) as Promise<Array<{ id: string; materialCode: string; standardRate: string }>>) : Promise.resolve([]),
      plantIds.length ? (m.query(`SELECT id, plant_name AS "plantName" FROM plants WHERE id = ANY($1)`, [plantIds]) as Promise<Array<{ id: string; plantName: string }>>) : Promise.resolve([]),
      slipIds.length ? (m.query(`SELECT id, slip_no AS "slipNo" FROM weighbridge_entries WHERE id = ANY($1)`, [slipIds]) as Promise<Array<{ id: string; slipNo: string }>>) : Promise.resolve([]),
      userIds.length ? (m.query(`SELECT id, name FROM users WHERE id = ANY($1)`, [userIds]) as Promise<Array<{ id: string; name: string }>>) : Promise.resolve([]),
    ]);
    const supplier = new Map(suppliers.map((s) => [s.id, s.supplierName]));
    const material = new Map(materials.map((x) => [x.id, x]));
    const plant = new Map(plants.map((p) => [p.id, p.plantName]));
    const slip = new Map(slips.map((w) => [w.id, w.slipNo]));
    const user = new Map(users.map((u) => [u.id, u.name]));
    return rows.map((r) => ({
      ...r,
      supplierName: r.supplierId ? supplier.get(r.supplierId) ?? null : null,
      materialCode: r.materialId ? material.get(r.materialId)?.materialCode ?? null : null,
      standardRate: r.materialId ? Number(material.get(r.materialId)?.standardRate ?? 0) : 0,
      plantName: r.plantId ? plant.get(r.plantId) ?? null : null,
      slipNo: r.weighbridgeEntryId ? slip.get(r.weighbridgeEntryId) ?? null : null,
      postedByName: r.postedByUserId ? user.get(r.postedByUserId) ?? null : null,
      hasAttachment: !!r.attachmentMime,
    }));
  }

  get(tenantId: string, id: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const row = await m.getRepository(MaterialInward).findOne({ where: { id } });
      if (!row) throw notFound();
      return (await this.decorate(m, [row]))[0];
    });
  }

  create(tenantId: string, dto: Record<string, unknown>) {
    if (!String(dto.materialId ?? '')) throw badReq('materialId required');
    return this.db.runInTenant(tenantId, async (m) => {
      const inward = await this.createWithin(m, tenantId, dto, null);
      return m.getRepository(MaterialInward).findOne({ where: { id: inward.id } });
    });
  }

  /**
   * One truck, several materials: a shared header (plant, supplier, vehicle,
   * challan and bill numbers) and a line per material. Each line becomes its
   * own numbered inward — stock, posting and the valuation stay per material —
   * and all of them are written in one transaction, so a bad line leaves
   * nothing behind.
   */
  createBatch(tenantId: string, dto: Record<string, unknown>) {
    const lines = Array.isArray(dto.lines) ? (dto.lines as Record<string, unknown>[]) : [];
    if (!lines.length) throw badReq('At least one line is required');
    if (lines.some((l) => !String(l?.materialId ?? ''))) throw badReq('Each line needs a material');
    return this.db.runInTenant(tenantId, async (m) => {
      const plantId = text(dto.plantId);
      const supplierId = text(dto.supplierId);
      if (plantId) await resolveRef(m, Plant, plantId, 'Plant');
      if (supplierId) await resolveRef(m, Supplier, supplierId, 'Supplier');
      const header = {
        plantId, supplierId,
        vehicleNo: text(dto.vehicleNo),
        supplierChallanNo: text(dto.supplierChallanNo),
        supplierBillNo: text(dto.supplierBillNo),
      };
      const conversions = lines.some((l) => l.enteredUom) ? await uomConversionRows(m) : [];
      const created: MaterialInward[] = [];
      for (const line of lines) {
        created.push(await this.createWithin(m, tenantId, { ...header, ...line }, conversions));
      }
      return this.decorate(m, created);
    });
  }

  /** The one write path: validates, converts the entered unit, numbers and saves a draft. */
  private async createWithin(m: EntityManager, tenantId: string, dto: Record<string, unknown>, conversions: UomConversionRow[] | null): Promise<MaterialInward> {
    const material = await m.getRepository(Material).findOne({ where: { id: String(dto.materialId) } });
    if (!material) throw badReq('Material not found');
    const uom = text(dto.uom) ?? material.uom ?? null;
    // Keyed in another unit (bags for a tonne material)? Convert through the
    // tenant's conversion table; the keyed unit and figure are kept too.
    const rows = dto.enteredUom ? (conversions ?? (await uomConversionRows(m))) : [];
    const resolved = resolveEnteredQuantity({ quantity: dto.quantityReceived, enteredUom: dto.enteredUom, enteredQuantity: dto.enteredQuantity }, uom, rows);
    if (!resolved.ok) throw badReq(resolved.reason);
    const received = resolved.quantity;
    if (received <= 0) throw badReq('Received quantity must be greater than zero');
    // Accepted is keyed in the same unit as received; convert it the same way.
    let accepted = received;
    if (dto.quantityAccepted !== undefined && dto.quantityAccepted !== null && dto.quantityAccepted !== '') {
      const acc = resolveEnteredQuantity({ quantity: dto.quantityAccepted, enteredUom: dto.enteredUom, enteredQuantity: dto.quantityAccepted }, uom, rows);
      if (!acc.ok) throw badReq(acc.reason);
      accepted = acc.quantity;
    }
    if (accepted < 0 || accepted > received + 0.0005) throw badReq('Accepted quantity must be between 0 and received');
    const rate = round2(num(dto.rate));
    if (rate < 0) throw badReq('Rate cannot be negative');
    const inwardNo = await this.numbering.next(m, tenantId, 'material_inward', 'INW-');
    const rest = nullifyEmpty(dto);
    for (const k of RESERVED) delete rest[k];
    const repo = m.getRepository(MaterialInward);
    const inward = await repo.save(
      repo.create({
        ...rest, tenantId, inwardNo,
        materialLabel: text(dto.materialLabel) ?? material.materialName ?? null,
        uom,
        enteredUom: resolved.enteredUom,
        enteredQuantity: resolved.enteredQuantity == null ? null : String(resolved.enteredQuantity),
        quantityReceived: String(received), quantityAccepted: String(accepted),
        rate: String(rate), amount: String(round2(accepted * rate)), status: 'draft',
      } as Record<string, unknown>),
    );
    return (await repo.findOne({ where: { id: inward.id } })) ?? inward;
  }

  /** Post the inward: add accepted quantity to stock, recording who did it. */
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
      await repo.update(id, { status: 'posted', postedByUserId: userId });
      const row = await repo.findOne({ where: { id } });
      return { ...(row ? (await this.decorate(m, [row]))[0] : {}), balanceAfter };
    });
  }

  cancel(tenantId: string, id: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(MaterialInward);
      // Lock, exactly as post() does. Without it cancel read the pre-post MVCC
      // snapshot, saw 'draft', passed the guard below, and its UPDATE then waited
      // on post()'s row lock and landed AFTER the post committed — leaving the
      // inward cancelled with its quantity already added to stock, so the ledger
      // and the document disagreed permanently. FOR UPDATE re-reads the row after
      // the wait, so the second caller now sees 'posted' and is refused.
      const inward = await repo.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!inward) throw notFound();
      if (inward.status === 'posted') throw badReq('Posted inward cannot be cancelled');
      if (inward.status === 'cancelled') return inward;
      await repo.update(id, { status: 'cancelled' });
      // Release the weighbridge slip this draft came from so the truck can be
      // converted again: 'matched' is terminal on the entry and the web hides
      // "To inward" for it, so a cancelled draft left the slip stuck forever.
      if (inward.weighbridgeEntryId) {
        const [others] = await m.query(
          `SELECT count(*)::int AS n FROM material_inwards WHERE weighbridge_entry_id = $1 AND status <> 'cancelled' AND id <> $2`,
          [inward.weighbridgeEntryId, id],
        );
        if (Number(others?.n ?? 0) === 0) {
          await m
            .getRepository(WeighbridgeEntry)
            .update({ id: inward.weighbridgeEntryId, status: 'matched' }, { status: 'completed' });
        }
      }
      return repo.findOne({ where: { id } });
    });
  }

  /** Attach (or replace) the supplier's invoice on a live inward. Returns the row without the bytes. */
  setAttachment(tenantId: string, id: string, dto: Record<string, unknown>) {
    const file = validateAttachment(dto.name, dto.mime, dto.data);
    return this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(MaterialInward);
      const inward = await repo.findOne({ where: { id } });
      if (!inward) throw notFound();
      if (inward.status === 'cancelled') throw badReq('A cancelled inward cannot carry an invoice');
      await repo.update(id, { attachmentName: file.name, attachmentMime: file.mime, attachmentData: file.data });
      const row = await repo.findOne({ where: { id } });
      return row ? (await this.decorate(m, [row]))[0] : null;
    });
  }

  removeAttachment(tenantId: string, id: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const repo = m.getRepository(MaterialInward);
      const inward = await repo.findOne({ where: { id } });
      if (!inward) throw notFound();
      await repo.update(id, { attachmentName: null, attachmentMime: null, attachmentData: null });
      const row = await repo.findOne({ where: { id } });
      return row ? (await this.decorate(m, [row]))[0] : null;
    });
  }

  /** The attached invoice's bytes, for streaming. 404 when there is none. */
  getAttachment(tenantId: string, id: string): Promise<{ name: string; mime: string; buffer: Buffer }> {
    return this.db.runInTenant(tenantId, async (m) => {
      const row = await m.getRepository(MaterialInward)
        .createQueryBuilder('i')
        .addSelect('i.attachmentData')
        .where('i.id = :id', { id })
        .getOne();
      if (!row) throw notFound();
      if (!row.attachmentMime || !row.attachmentData) {
        throw new NotFoundException({ code: 'RECORD_NOT_FOUND', message: 'This inward has no invoice attached' });
      }
      return { name: row.attachmentName ?? 'invoice', mime: row.attachmentMime, buffer: Buffer.from(row.attachmentData, 'base64') };
    });
  }
}
