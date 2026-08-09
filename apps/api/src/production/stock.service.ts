import { BadRequestException, Injectable } from '@nestjs/common';
import { IsNull, type EntityManager } from 'typeorm';
import { TenantDbService } from '../core/database/tenant-db.service';
import { Material, Plant, StockBalance, StockTransaction } from '../core/database/entities';

const num = (v: unknown): number => Number(v ?? 0) || 0;

interface TxnInput {
  plantId: string; // always resolved (non-null) before a ledger row is written
  materialId: string;
  materialLabel: string | null;
  transactionType: string;
  referenceType: string | null;
  referenceId: string | null;
  inQuantity: number;
  outQuantity: number;
  balanceAfter: number;
  remarks: string | null;
  createdBy: string | null;
}

/**
 * Minimal inventory ledger for Sprint 6 (Design Doc 6 §12). Supports opening
 * balances (bootstrap until Sprint 8 material inward) and batch-consumption
 * reductions. Every movement writes a stock_transactions row and updates the
 * stock_balances snapshot. Negative-stock APPROVAL is Sprint 8 — Sprint 6 lets
 * a consumption drive stock negative but records it as such.
 */
@Injectable()
export class StockService {
  constructor(private readonly db: TenantDbService) {}

  listBalances(tenantId: string) {
    return this.db.runInTenant(tenantId, (m) =>
      m.getRepository(StockBalance).find({ order: { materialLabel: 'ASC' } }),
    );
  }

  ledger(tenantId: string, materialId?: string) {
    return this.db.runInTenant(tenantId, (m) =>
      m.getRepository(StockTransaction).find({
        where: materialId ? { materialId } : {},
        order: { createdAt: 'DESC' },
        take: 200,
      }),
    );
  }

  /** Set / reset the opening balance for a material at a plant (bootstrap). */
  setOpening(tenantId: string, dto: Record<string, unknown>, userId: string) {
    const materialId = String(dto.materialId ?? '');
    const plantIdIn = (dto.plantId as string) ?? null;
    const quantity = num(dto.quantity);
    if (!materialId) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'materialId required' });
    return this.db.runInTenant(tenantId, async (m) => {
      const plantId = await this.resolvePlant(m, plantIdIn);
      const material = await m.getRepository(Material).findOne({ where: { id: materialId } });
      const label = material?.materialName ?? null;
      const uom = material?.uom ?? null;
      const balanceAfter = await this.upsertBalance(m, tenantId, plantId, materialId, label, uom, quantity, true);
      await this.writeTxn(m, tenantId, {
        plantId, materialId, materialLabel: label, transactionType: 'opening',
        inQuantity: quantity, outQuantity: 0, balanceAfter,
        referenceType: 'opening', referenceId: null, remarks: 'Opening balance', createdBy: userId,
      });
      return m.getRepository(StockBalance).findOne({ where: { plantId, materialId } });
    });
  }

  /**
   * Resolve the plant a stock movement belongs to. A stock balance is only
   * meaningful scoped to a plant, so a null must never reach the ledger — that
   * is what produced the duplicate "ghost" balance rows. If the caller has a
   * plant, use it; otherwise fall back to the tenant's single plant (the common
   * single-plant case), and refuse clearly when it cannot be determined rather
   * than silently writing an unscoped row.
   */
  private async resolvePlant(m: EntityManager, plantId: string | null): Promise<string> {
    if (plantId) return plantId;
    const plants = await m.getRepository(Plant).find({ order: { createdAt: 'ASC' }, take: 2 });
    const [first] = plants;
    if (plants.length === 1 && first) return first.id;
    if (plants.length === 0) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'No plant is configured for this tenant. Create a plant before recording stock.',
      });
    }
    throw new BadRequestException({
      code: 'VALIDATION_ERROR',
      message: 'This stock movement is not tied to a plant, and the tenant has more than one. The order/batch must specify a plant.',
    });
  }

  /** Reduce stock for a batch consumption. Runs inside the caller's tenant tx. */
  async consumeWithin(
    m: EntityManager,
    tenantId: string,
    plantId: string | null,
    materialId: string,
    materialLabel: string | null,
    uom: string | null,
    quantity: number,
    referenceId: string,
    userId: string | null,
  ): Promise<number> {
    const balanceAfter = await this.applyDeltaWithin(m, tenantId, {
      plantId, materialId, materialLabel, uom, delta: -quantity,
      referenceType: 'batch_ticket', referenceId, remarks: 'Batch consumption', createdBy: userId,
    });
    return balanceAfter;
  }

  /**
   * Apply a signed delta to a material balance (positive = in, negative = out)
   * and write the matching ledger row. `txnType` overrides the auto type
   * (in→'inward', out→'batch_consumption' unless the result is negative). Shared
   * by batch consumption, material inward and stock adjustment.
   */
  async applyDeltaWithin(
    m: EntityManager,
    tenantId: string,
    p: {
      plantId: string | null; materialId: string; materialLabel: string | null; uom: string | null;
      delta: number; txnType?: string; referenceType: string | null; referenceId: string | null;
      remarks: string | null; createdBy: string | null;
    },
  ): Promise<number> {
    const plantId = await this.resolvePlant(m, p.plantId);
    const balanceAfter = await this.upsertBalance(m, tenantId, plantId, p.materialId, p.materialLabel, p.uom, p.delta, false);
    const auto = p.delta >= 0 ? 'inward' : balanceAfter < 0 ? 'negative_stock' : 'batch_consumption';
    await this.writeTxn(m, tenantId, {
      plantId, materialId: p.materialId, materialLabel: p.materialLabel,
      transactionType: p.txnType ?? auto,
      inQuantity: p.delta > 0 ? p.delta : 0,
      outQuantity: p.delta < 0 ? -p.delta : 0,
      balanceAfter, referenceType: p.referenceType, referenceId: p.referenceId,
      remarks: p.remarks, createdBy: p.createdBy,
    });
    return balanceAfter;
  }

  /** Current balance for a material at a plant (0 if none). */
  async balanceOf(m: EntityManager, plantId: string | null, materialId: string): Promise<number> {
    const bal = await m.getRepository(StockBalance).findOne({ where: { plantId: plantId ?? IsNull(), materialId } });
    return num(bal?.currentQuantity);
  }

  /**
   * Apply a change to a material balance atomically. Uses a single
   * INSERT … ON CONFLICT keyed on the (tenant_id, plant_id, material_id) unique
   * index, so concurrent movements can never race into two rows or a duplicate.
   * `isAbsolute` sets the quantity (opening balance); otherwise the delta is
   * added to the current quantity. `plantId` is always non-null here (resolved
   * by the callers), which is what makes the ON CONFLICT reliably match.
   */
  private async upsertBalance(
    m: EntityManager,
    tenantId: string,
    plantId: string,
    materialId: string,
    materialLabel: string | null,
    uom: string | null,
    delta: number,
    isAbsolute: boolean,
  ): Promise<number> {
    const qtyExpr = isAbsolute
      ? 'EXCLUDED.current_quantity'
      : 'stock_balances.current_quantity + EXCLUDED.current_quantity';
    const rows: Array<{ current_quantity: string }> = await m.query(
      `INSERT INTO stock_balances
         (tenant_id, plant_id, material_id, material_label, uom, current_quantity, last_updated_at)
       VALUES ($1, $2, $3, $4, $5, $6::numeric, now())
       ON CONFLICT ON CONSTRAINT uq_stock_balances_plant_material
       DO UPDATE SET
         current_quantity = ${qtyExpr},
         uom              = COALESCE(stock_balances.uom, EXCLUDED.uom),
         material_label   = COALESCE(stock_balances.material_label, EXCLUDED.material_label),
         last_updated_at  = now()
       RETURNING current_quantity`,
      [tenantId, plantId, materialId, materialLabel, uom, String(delta)],
    );
    return num(rows[0]?.current_quantity);
  }

  private async writeTxn(m: EntityManager, tenantId: string, data: TxnInput): Promise<void> {
    const repo = m.getRepository(StockTransaction);
    await repo.save(
      repo.create({
        tenantId,
        plantId: data.plantId,
        materialId: data.materialId,
        materialLabel: data.materialLabel,
        transactionType: data.transactionType,
        referenceType: data.referenceType,
        referenceId: data.referenceId,
        remarks: data.remarks,
        createdBy: data.createdBy,
        inQuantity: String(data.inQuantity),
        outQuantity: String(data.outQuantity),
        balanceAfter: String(data.balanceAfter),
      }),
    );
  }
}
