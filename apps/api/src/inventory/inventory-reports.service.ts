import { Injectable } from '@nestjs/common';
import { TenantDbService } from '../core/database/tenant-db.service';
import { StockBalance, StockTransaction } from '../core/database/entities';

/** Basic inventory reports + low/negative-stock visibility (DEV-PLAN B11). */
@Injectable()
export class InventoryReportsService {
  constructor(private readonly db: TenantDbService) {}

  /** Balances at or below the material reorder level. */
  lowStock(tenantId: string) {
    return this.db.runInTenant(tenantId, (m) =>
      m
        .getRepository(StockBalance)
        .createQueryBuilder('b')
        .innerJoin('materials', 'mt', 'mt.id = b.material_id')
        .select(['b.material_label AS material', 'b.current_quantity AS "currentQuantity"', 'mt.reorder_level AS "reorderLevel"', 'b.uom AS uom'])
        .where('mt.reorder_level > 0 AND b.current_quantity <= mt.reorder_level')
        .orderBy('b.current_quantity', 'ASC')
        .getRawMany(),
    );
  }

  /** Balances currently below zero. */
  negativeStock(tenantId: string) {
    return this.db.runInTenant(tenantId, (m) =>
      m.getRepository(StockBalance).find({ where: {}, order: { currentQuantity: 'ASC' } }).then((rows) =>
        rows.filter((r) => Number(r.currentQuantity) < 0),
      ),
    );
  }

  /** Stock value = current_quantity × material standard_rate. */
  valuation(tenantId: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const rows = await m
        .getRepository(StockBalance)
        .createQueryBuilder('b')
        .innerJoin('materials', 'mt', 'mt.id = b.material_id')
        .select([
          'b.material_label AS material',
          'b.current_quantity AS "currentQuantity"',
          'mt.standard_rate AS "standardRate"',
          '(b.current_quantity * mt.standard_rate) AS value',
        ])
        .orderBy('value', 'DESC')
        .getRawMany();
      const total = rows.reduce((s, r) => s + Number(r.value ?? 0), 0);
      return { rows, total };
    });
  }

  /** Total in/out movement by material from the ledger, optionally bounded to
   *  [from, to] on the transaction date. */
  movement(tenantId: string, from?: string, to?: string) {
    return this.db.runInTenant(tenantId, (m) => {
      const qb = m
        .getRepository(StockTransaction)
        .createQueryBuilder('s')
        .select('COALESCE(s.material_label, :none)', 'material')
        .addSelect('COALESCE(SUM(s.in_quantity), 0)', 'totalIn')
        .addSelect('COALESCE(SUM(s.out_quantity), 0)', 'totalOut')
        .setParameter('none', 'Unspecified');
      if (from) qb.andWhere('s.created_at::date >= :from', { from });
      if (to) qb.andWhere('s.created_at::date <= :to', { to });
      return qb.groupBy('s.material_label').orderBy('material', 'ASC').getRawMany();
    });
  }
}
