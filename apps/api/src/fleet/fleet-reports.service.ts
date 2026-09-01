import { Injectable } from '@nestjs/common';
import { TenantDbService } from '../core/database/tenant-db.service';
import {
  buildFleetRunningCost,
  type MaintCostRow,
  type FuelCostRow,
} from './fleet-running-cost.util';

/** Fleet analytics reports (Tier-5C). */
@Injectable()
export class FleetReportsService {
  constructor(private readonly db: TenantDbService) {}

  /**
   * Fleet running cost per vehicle over [from, to]: completed maintenance jobs
   * (labour + parts) and the diesel fuel log, merged into a running cost with
   * cost/km and km/litre. Maintenance is dated on completed_date, fuel on
   * fuel_date; both are RLS-scoped.
   */
  runningCost(tenantId: string, from?: string, to?: string) {
    return this.db.runInTenant(tenantId, async (m) => {
      const params = [from ?? null, to ?? null];
      const maintRows: MaintCostRow[] = await m.query(
        `SELECT j.vehicle_id AS "vehicleId",
                MAX(v.vehicle_no) AS "vehicleNo",
                MAX(v.vehicle_type) AS "vehicleType",
                COALESCE(SUM(j.total_cost), 0)::float AS "maintenanceCost",
                COUNT(*)::int AS jobs
           FROM vehicle_maintenance_jobs j
           JOIN vehicles v ON v.id = j.vehicle_id
          WHERE j.status = 'completed'
            AND ($1::date IS NULL OR j.completed_date >= $1::date)
            AND ($2::date IS NULL OR j.completed_date <= $2::date)
          GROUP BY j.vehicle_id`,
        params,
      );
      const fuelRows: FuelCostRow[] = await m.query(
        `SELECT f.vehicle_id AS "vehicleId",
                MAX(v.vehicle_no) AS "vehicleNo",
                MAX(v.vehicle_type) AS "vehicleType",
                COALESCE(SUM(f.amount), 0)::float AS "fuelCost",
                COALESCE(SUM(f.quantity_litres), 0)::float AS "litres",
                COALESCE(SUM(f.distance_km), 0)::float AS "distanceKm"
           FROM vehicle_fuel_logs f
           JOIN vehicles v ON v.id = f.vehicle_id
          WHERE ($1::date IS NULL OR f.fuel_date >= $1::date)
            AND ($2::date IS NULL OR f.fuel_date <= $2::date)
          GROUP BY f.vehicle_id`,
        params,
      );
      return { ...buildFleetRunningCost(maintRows, fuelRows), from: from ?? null, to: to ?? null };
    });
  }
}
