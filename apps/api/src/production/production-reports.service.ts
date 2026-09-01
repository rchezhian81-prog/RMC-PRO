import { Injectable } from '@nestjs/common';
import { TenantDbService } from '../core/database/tenant-db.service';
import { BatchTicket, BatchTicketMaterial, StockTransaction } from '../core/database/entities';
import { buildPlanVsActual } from './plan-vs-actual.util';
import { buildMaterialReconciliation, type DoseAggRow, type StockAggRow } from './material-reconciliation.util';

/** Basic production reports (Design Doc 12 §reports, DEV-PLAN B9). */
@Injectable()
export class ProductionReportsService {
  constructor(private readonly db: TenantDbService) {}

  /** Produced m³ by grade + batch counts from CONFIRMED tickets, optionally
   *  bounded to [from, to] on the batch date. */
  productionSummary(tenantId: string, from?: string, to?: string) {
    // Batch date is the start time; fall back to the row's created date.
    const dated = <T extends { andWhere: (s: string, p?: object) => T }>(qb: T): T => {
      if (from) qb.andWhere('COALESCE(t.batch_start_time, t.created_at)::date >= :from', { from });
      if (to) qb.andWhere('COALESCE(t.batch_start_time, t.created_at)::date <= :to', { to });
      return qb;
    };
    return this.db.runInTenant(tenantId, async (m) => {
      const byGrade = await dated(
        m
          .getRepository(BatchTicket)
          .createQueryBuilder('t')
          .select('COALESCE(t.grade_label, :none)', 'grade')
          .addSelect('COUNT(*)', 'batches')
          .addSelect('COALESCE(SUM(t.batch_quantity_m3), 0)', 'producedM3')
          .addSelect('SUM(CASE WHEN t.variance_exceeded THEN 1 ELSE 0 END)', 'varianceBatches')
          .where('t.status = :status', { status: 'confirmed' })
          .setParameter('none', 'Unspecified'),
      )
        .groupBy('t.grade_label')
        .orderBy('grade', 'ASC')
        .getRawMany();

      const totals = await dated(
        m
          .getRepository(BatchTicket)
          .createQueryBuilder('t')
          .select('COUNT(*)', 'batches')
          .addSelect('COALESCE(SUM(t.batch_quantity_m3), 0)', 'producedM3')
          .where('t.status = :status', { status: 'confirmed' }),
      ).getRawOne<{ batches: string; producedM3: string }>();

      return { byGrade, totals };
    });
  }

  /** Confirmed tickets that breached tolerance, with material detail. */
  varianceReport(tenantId: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const tickets = await m
        .getRepository(BatchTicket)
        .find({ where: { status: 'confirmed', varianceExceeded: true }, order: { createdAt: 'DESC' } });
      const withMaterials = [];
      for (const t of tickets) {
        const materials = await m
          .getRepository(BatchTicketMaterial)
          .find({ where: { batchTicketId: t.id, withinTolerance: false } });
        withMaterials.push({
          batchTicketNo: t.batchTicketNo,
          gradeLabel: t.gradeLabel,
          batchQuantityM3: t.batchQuantityM3,
          breaches: materials.map((mm) => ({
            material: mm.materialLabel,
            target: mm.targetQuantity,
            actual: mm.actualQuantity,
            variancePercentage: mm.variancePercentage,
            tolerancePercentage: mm.tolerancePercentage,
          })),
        });
      }
      return withMaterials;
    });
  }

  /** Batch-wise production register — each confirmed ticket (date, grade, m³),
   *  optionally bounded to [from, to] on the batch date. */
  batchRegister(tenantId: string, from?: string, to?: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const qb = m
        .getRepository(BatchTicket)
        .createQueryBuilder('t')
        .select('t.batch_ticket_no', 'batchTicketNo')
        .addSelect('COALESCE(t.batch_start_time::date, t.created_at::date)', 'date')
        .addSelect('t.grade_label', 'gradeLabel')
        .addSelect('t.batch_quantity_m3::float', 'm3')
        .where("t.status = 'confirmed'");
      if (from) qb.andWhere('COALESCE(t.batch_start_time, t.created_at)::date >= :from', { from });
      if (to) qb.andWhere('COALESCE(t.batch_start_time, t.created_at)::date <= :to', { to });
      const rows: Array<{ m3: number | string }> = await qb.orderBy('date', 'DESC').getRawMany();
      const totalM3 = Math.round(rows.reduce((s, r) => s + (Number(r.m3) || 0), 0) * 1000) / 1000;
      return { rows, totalM3, count: rows.length };
    });
  }

  /**
   * Plan vs actual — planned m³ (from production plans) against actually-batched
   * m³ (confirmed tickets), by grade, over [from, to]. Plans are bounded by
   * plan_date; batches by their batch date. RLS scopes both to the tenant.
   */
  planVsActual(tenantId: string, from?: string, to?: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const params = [from ?? null, to ?? null];
      const planned: Array<{ gradeLabel: string | null; plannedM3: number }> = await m.query(
        `SELECT pi.grade_label AS "gradeLabel",
                COALESCE(SUM(pi.planned_quantity_m3), 0)::float AS "plannedM3"
           FROM production_plan_items pi
           JOIN production_plans p ON p.id = pi.production_plan_id
          WHERE ($1::date IS NULL OR p.plan_date >= $1::date)
            AND ($2::date IS NULL OR p.plan_date <= $2::date)
          GROUP BY pi.grade_label`,
        params,
      );
      const actual: Array<{ gradeLabel: string | null; actualM3: number }> = await m.query(
        `SELECT t.grade_label AS "gradeLabel",
                COALESCE(SUM(t.batch_quantity_m3), 0)::float AS "actualM3"
           FROM batch_tickets t
          WHERE t.status = 'confirmed'
            AND ($1::date IS NULL OR COALESCE(t.batch_start_time, t.created_at)::date >= $1::date)
            AND ($2::date IS NULL OR COALESCE(t.batch_start_time, t.created_at)::date <= $2::date)
          GROUP BY t.grade_label`,
        params,
      );
      return buildPlanVsActual(planned, actual);
    });
  }

  /**
   * Material reconciliation — per material over [from, to] (optionally one plant):
   * theoretical (mix-design target) vs actually-dosed (controller weighed) vs
   * stock-consumed (ledger drawdown), with the dosing and stock variances. The
   * dosing gap flags recipe over/under-dosing; the stock gap flags ledger
   * drawdown that doesn't match the controller (untracked issue / leakage).
   */
  materialReconciliation(tenantId: string, from?: string, to?: string, plantId?: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const params = [from ?? null, to ?? null, plantId ?? null];
      const doseRows: DoseAggRow[] = await m.query(
        `SELECT btm.material_label AS material,
                MAX(btm.uom) AS uom,
                COALESCE(SUM(btm.target_quantity), 0)::float AS theoretical,
                COALESCE(SUM(btm.actual_quantity), 0)::float AS "actualDosed"
           FROM batch_ticket_materials btm
           JOIN batch_tickets t ON t.id = btm.batch_ticket_id
          WHERE t.status = 'confirmed'
            AND ($1::date IS NULL OR COALESCE(t.batch_start_time, t.created_at)::date >= $1::date)
            AND ($2::date IS NULL OR COALESCE(t.batch_start_time, t.created_at)::date <= $2::date)
            AND ($3::uuid IS NULL OR t.plant_id = $3::uuid)
          GROUP BY btm.material_label`,
        params,
      );
      const stockRows: StockAggRow[] = await m.query(
        `SELECT s.material_label AS material,
                COALESCE(SUM(s.out_quantity), 0)::float AS "stockConsumed"
           FROM stock_transactions s
          WHERE s.transaction_type IN ('batch_consumption', 'negative_stock')
            AND ($1::date IS NULL OR s.created_at::date >= $1::date)
            AND ($2::date IS NULL OR s.created_at::date <= $2::date)
            AND ($3::uuid IS NULL OR s.plant_id = $3::uuid)
          GROUP BY s.material_label`,
        params,
      );
      return { ...buildMaterialReconciliation(doseRows, stockRows), from: from ?? null, to: to ?? null };
    });
  }

  /** Total consumed quantity by material (from the stock ledger), optionally
   *  bounded to [from, to] on the transaction date. */
  materialConsumption(tenantId: string, from?: string, to?: string) {
    return this.db.runInTenant(tenantId, (m) => {
      const qb = m
        .getRepository(StockTransaction)
        .createQueryBuilder('s')
        .select('COALESCE(s.material_label, :none)', 'material')
        .addSelect('COALESCE(SUM(s.out_quantity), 0)', 'consumed')
        .where('s.transaction_type IN (:...types)', { types: ['batch_consumption', 'negative_stock'] })
        .setParameter('none', 'Unspecified');
      if (from) qb.andWhere('s.created_at::date >= :from', { from });
      if (to) qb.andWhere('s.created_at::date <= :to', { to });
      return qb.groupBy('s.material_label').orderBy('consumed', 'DESC').getRawMany();
    });
  }
}
