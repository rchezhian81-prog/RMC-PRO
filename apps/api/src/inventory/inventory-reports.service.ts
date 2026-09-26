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
        .select(['b.material_label AS material', 'mt.material_code AS "materialCode"', 'b.current_quantity AS "currentQuantity"', 'mt.reorder_level AS "reorderLevel"', 'b.uom AS uom'])
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
          'mt.material_code AS "materialCode"',
          'b.uom AS uom',
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

  /**
   * Movement by material from the ledger, optionally bounded to [from, to] on
   * the transaction date: the total in and out, and the same split by what
   * moved it (received, opening, adjusted up; batched, adjusted down,
   * negative-stock issues) so the report reads as a story, not two sums.
   */
  movement(tenantId: string, from?: string, to?: string) {
    return this.db.runInTenant(tenantId, (m) => {
      const qb = m
        .getRepository(StockTransaction)
        .createQueryBuilder('s')
        .select('COALESCE(s.material_label, :none)', 'material')
        .addSelect('MAX(mt.material_code)', 'materialCode')
        .addSelect('MAX(mt.uom)', 'uom')
        .addSelect('COALESCE(SUM(s.in_quantity), 0)::float', 'totalIn')
        .addSelect('COALESCE(SUM(s.out_quantity), 0)::float', 'totalOut')
        .addSelect(`COALESCE(SUM(s.in_quantity) FILTER (WHERE s.transaction_type = 'inward'), 0)::float`, 'received')
        .addSelect(`COALESCE(SUM(s.in_quantity) FILTER (WHERE s.transaction_type = 'opening'), 0)::float`, 'opening')
        .addSelect(`COALESCE(SUM(s.in_quantity) FILTER (WHERE s.transaction_type = 'adjustment'), 0)::float`, 'adjustedUp')
        .addSelect(`COALESCE(SUM(s.out_quantity) FILTER (WHERE s.transaction_type = 'batch_consumption'), 0)::float`, 'batched')
        .addSelect(`COALESCE(SUM(s.out_quantity) FILTER (WHERE s.transaction_type = 'adjustment'), 0)::float`, 'adjustedDown')
        .addSelect(`COALESCE(SUM(s.out_quantity) FILTER (WHERE s.transaction_type = 'negative_stock'), 0)::float`, 'negativeIssued')
        .addSelect('COUNT(*)::int', 'movements')
        .leftJoin('materials', 'mt', 'mt.id = s.material_id')
        .setParameter('none', 'Unspecified');
      if (from) qb.andWhere('s.created_at::date >= :from', { from });
      if (to) qb.andWhere('s.created_at::date <= :to', { to });
      return qb.groupBy('s.material_label').orderBy('material', 'ASC').getRawMany();
    });
  }
}
