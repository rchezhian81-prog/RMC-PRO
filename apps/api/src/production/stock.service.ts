import { BadRequestException, Injectable } from '@nestjs/common';
import { IsNull, type EntityManager } from 'typeorm';
import { TenantDbService } from '../core/database/tenant-db.service';
import { Material, StockBalance, StockTransaction } from '../core/database/entities';

const num = (v: unknown): number => Number(v ?? 0) || 0;

interface TxnInput {
  plantId: string | null;
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
    const plantId = (dto.plantId as string) ?? null;
    const quantity = num(dto.quantity);
    if (!materialId) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'materialId required' });
    return this.db.runInTenant(tenantId, async (m) => {
      const material = await m.getRepository(Material).findOne({ where: { id: materialId } });
      const label = material?.materialName ?? null;
      const uom = material?.uom ?? null;
      const bal = await this.upsertBalance(m, tenantId, plantId, materialId, label, uom, quantity, true);
      await this.writeTxn(m, tenantId, {
        plantId, materialId, materialLabel: label, transactionType: 'opening',
        inQuantity: quantity, outQuantity: 0, balanceAfter: num(bal.currentQuantity),
        referenceType: 'opening', referenceId: null, remarks: 'Opening balance', createdBy: userId,
      });
      return bal;
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
    const bal = await this.upsertBalance(m, tenantId, p.plantId, p.materialId, p.materialLabel, p.uom, p.delta, false);
    const balanceAfter = num(bal.currentQuantity);
    const auto = p.delta >= 0 ? 'inward' : balanceAfter < 0 ? 'negative_stock' : 'batch_consumption';
    await this.writeTxn(m, tenantId, {
      plantId: p.plantId, materialId: p.materialId, materialLabel: p.materialLabel,
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

  private async upsertBalance(
    m: EntityManager,
    tenantId: string,
    plantId: string | null,
    materialId: string,
    materialLabel: string | null,
    uom: string | null,
    delta: number,
    isAbsolute: boolean,
  ): Promise<StockBalance> {
    const repo = m.getRepository(StockBalance);
    const existing = await repo.findOne({
      where: { plantId: plantId ?? IsNull(), materialId },
    });
    if (!existing) {
      return repo.save(
        repo.create({
          tenantId, plantId, materialId, materialLabel, uom,
          currentQuantity: String(isAbsolute ? delta : delta),
          lastUpdatedAt: new Date(),
        }),
      );
    }
    const next = isAbsolute ? delta : num(existing.currentQuantity) + delta;
    await repo.update(existing.id, { currentQuantity: String(next), lastUpdatedAt: new Date(), materialLabel: existing.materialLabel ?? materialLabel });
    return (await repo.findOne({ where: { id: existing.id } })) as StockBalance;
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
