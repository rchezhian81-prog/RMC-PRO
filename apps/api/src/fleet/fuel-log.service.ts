import { BadRequestException, Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { TenantDbService } from '../core/database/tenant-db.service';
import { Vehicle, VehicleFuelLog } from '../core/database/entities';
import { fuelEfficiency, summariseFuel, type FuelSummaryRow } from './fleet.util';

const badReq = (message: string) => new BadRequestException({ code: 'VALIDATION_ERROR', message });
const num = (v: unknown): number => Number(v ?? 0) || 0;
const round2 = (v: number): number => Math.round((Number(v) || 0) * 100) / 100;
const todayIso = (): string => new Date().toISOString().slice(0, 10);

/**
 * Vehicle fuel (diesel) log (Plan D3). Each fill records the odometer and litres;
 * on save, when the previous full-tank reading is known, the service fills in the
 * distance covered and km-per-litre so the per-vehicle mileage report is a plain
 * read. `summary` rolls the log into tank-to-tank mileage and cost-per-km.
 */
@Injectable()
export class FuelLogService {
  constructor(private readonly db: TenantDbService) {}

  list(tenantId: string, vehicleId?: string) {
    return this.db.runInTenant(tenantId, (m) => {
      const where: Record<string, unknown> = {};
      if (vehicleId) where.vehicleId = vehicleId;
      return m.getRepository(VehicleFuelLog).find({ where, order: { odometer: 'DESC', createdAt: 'DESC' } });
    });
  }

  /** The most recent full-tank fill for a vehicle strictly below `odometer`. */
  private async prevFullTank(m: EntityManager, vehicleId: string, odometer: number): Promise<VehicleFuelLog | null> {
    const rows = await m.getRepository(VehicleFuelLog).find({
      where: { vehicleId, isTankFull: true },
      order: { odometer: 'DESC' },
    });
    return rows.find((r) => Number(r.odometer) < odometer) ?? null;
  }

  create(tenantId: string, dto: Record<string, unknown>) {
    const vehicleId = String(dto.vehicleId ?? '');
    if (!vehicleId) throw badReq('vehicleId required');
    const odometer = num(dto.odometer);
    if (odometer <= 0) throw badReq('odometer required');
    const quantityLitres = num(dto.quantityLitres);
    if (quantityLitres <= 0) throw badReq('quantityLitres must be greater than zero');

    return this.db.runInTenant(tenantId, async (m) => {
      const vehicle = await m.getRepository(Vehicle).findOne({ where: { id: vehicleId } });
      if (!vehicle) throw badReq('Vehicle not found');

      const ratePerLitre = round2(num(dto.ratePerLitre));
      const amount = dto.amount !== undefined ? round2(num(dto.amount)) : round2(quantityLitres * ratePerLitre);
      const isTankFull = dto.isTankFull === undefined ? true : Boolean(dto.isTankFull);

      // Mileage only closes on a full tank measured against the previous full tank.
      let distanceKm: number | null = null;
      let kmPerLitre: number | null = null;
      if (isTankFull) {
        const prev = await this.prevFullTank(m, vehicleId, odometer);
        const eff = fuelEfficiency({ prevOdometer: prev ? Number(prev.odometer) : null, currOdometer: odometer, litres: quantityLitres });
        if (eff) {
          distanceKm = eff.distanceKm;
          kmPerLitre = eff.kmPerLitre;
        }
      }

      const repo = m.getRepository(VehicleFuelLog);
      const saved = await repo.save(
        repo.create({
          tenantId, vehicleId,
          fuelDate: (dto.fuelDate as string) ?? todayIso(),
          odometer: String(odometer),
          fuelType: (dto.fuelType as string) ?? 'diesel',
          quantityLitres: String(round2(quantityLitres)),
          ratePerLitre: String(ratePerLitre),
          amount: String(amount),
          isTankFull,
          station: (dto.station as string) ?? null,
          distanceKm: distanceKm === null ? null : String(distanceKm),
          kmPerLitre: kmPerLitre === null ? null : String(kmPerLitre),
          remarks: (dto.remarks as string) ?? null,
        }),
      );
      return saved;
    });
  }

  /** Per-vehicle fuel summary: totals + tank-to-tank mileage and cost-per-km. */
  summary(tenantId: string, vehicleId: string) {
    if (!vehicleId) throw badReq('vehicleId required');
    return this.db.runInTenant(tenantId, async (m) => {
      const entries = await m.getRepository(VehicleFuelLog).find({
        where: { vehicleId },
        order: { odometer: 'ASC', createdAt: 'ASC' },
      });
      const rows: FuelSummaryRow[] = entries.map((e) => ({
        quantityLitres: Number(e.quantityLitres),
        amount: Number(e.amount),
        distanceKm: e.distanceKm === null ? null : Number(e.distanceKm),
      }));
      return { vehicleId, summary: summariseFuel(rows), entries };
    });
  }
}
