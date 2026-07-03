import { Injectable } from '@nestjs/common';
import { TenantDbService } from '../core/database/tenant-db.service';
import { BatchTicket, BatchTicketMaterial, StockTransaction } from '../core/database/entities';

/** Basic production reports (Design Doc 12 §reports, DEV-PLAN B9). */
@Injectable()
export class ProductionReportsService {
  constructor(private readonly db: TenantDbService) {}

  /** Produced m³ by grade + batch counts from CONFIRMED tickets. */
  productionSummary(tenantId: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const byGrade = await m
        .getRepository(BatchTicket)
        .createQueryBuilder('t')
        .select('COALESCE(t.grade_label, :none)', 'grade')
        .addSelect('COUNT(*)', 'batches')
        .addSelect('COALESCE(SUM(t.batch_quantity_m3), 0)', 'producedM3')
        .addSelect('SUM(CASE WHEN t.variance_exceeded THEN 1 ELSE 0 END)', 'varianceBatches')
        .where('t.status = :status', { status: 'confirmed' })
        .setParameter('none', 'Unspecified')
        .groupBy('t.grade_label')
        .orderBy('grade', 'ASC')
        .getRawMany();

      const totals = await m
        .getRepository(BatchTicket)
        .createQueryBuilder('t')
        .select('COUNT(*)', 'batches')
        .addSelect('COALESCE(SUM(t.batch_quantity_m3), 0)', 'producedM3')
        .where('t.status = :status', { status: 'confirmed' })
        .getRawOne<{ batches: string; producedM3: string }>();

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

  /** Total consumed quantity by material (from the stock ledger). */
  materialConsumption(tenantId: string) {
    return this.db.runInTenant(tenantId, (m) =>
      m
        .getRepository(StockTransaction)
        .createQueryBuilder('s')
        .select('COALESCE(s.material_label, :none)', 'material')
        .addSelect('COALESCE(SUM(s.out_quantity), 0)', 'consumed')
        .where('s.transaction_type IN (:...types)', { types: ['batch_consumption', 'negative_stock'] })
        .setParameter('none', 'Unspecified')
        .groupBy('s.material_label')
        .orderBy('consumed', 'DESC')
        .getRawMany(),
    );
  }
}
