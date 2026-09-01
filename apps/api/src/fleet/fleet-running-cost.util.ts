/**
 * Pure fleet running-cost maths.
 *
 * Two cost sources per vehicle over a period — completed maintenance jobs
 * (labour + parts, i.e. total_cost) and the diesel fuel log (amount, litres,
 * distance) — merged by vehicle into a running cost, with cost/km and km/litre.
 * The service supplies the two pre-aggregated SQL result sets; this merges and
 * does the arithmetic, so it is trivially unit-testable.
 */

export interface MaintCostRow {
  vehicleId: string | null;
  vehicleNo?: string | null;
  vehicleType?: string | null;
  maintenanceCost: number | string;
  jobs?: number | string;
}

export interface FuelCostRow {
  vehicleId: string | null;
  vehicleNo?: string | null;
  vehicleType?: string | null;
  fuelCost: number | string;
  litres: number | string;
  distanceKm: number | string;
}

export interface FleetCostRow {
  vehicleId: string | null;
  vehicleNo: string;
  vehicleType: string | null;
  maintenanceCost: number;
  jobs: number;
  fuelCost: number;
  litres: number;
  distanceKm: number;
  totalCost: number;
  /** null when there is no distance to spread the cost over. */
  costPerKm: number | null;
  /** null when no fuel was logged. */
  kmPerLitre: number | null;
}

export interface FleetCostTotals {
  vehicles: number;
  maintenanceCost: number;
  fuelCost: number;
  totalCost: number;
  litres: number;
  distanceKm: number;
  costPerKm: number | null;
  kmPerLitre: number | null;
}

export interface FleetRunningCostResult {
  rows: FleetCostRow[];
  totals: FleetCostTotals;
}

const r2 = (n: number): number => Math.round(n * 100) / 100;
const r1 = (n: number): number => Math.round(n * 10) / 10;
const num = (v: number | string | null | undefined): number =>
  typeof v === 'number' ? v : Number(v ?? 0) || 0;

interface Acc {
  vehicleId: string | null;
  vehicleNo: string | null;
  vehicleType: string | null;
  maintenanceCost: number;
  jobs: number;
  fuelCost: number;
  litres: number;
  distanceKm: number;
}

export function buildFleetRunningCost(
  maintRows: MaintCostRow[],
  fuelRows: FuelCostRow[],
): FleetRunningCostResult {
  const byVehicle = new Map<string, Acc>();
  const get = (id: string | null, no?: string | null, type?: string | null): Acc => {
    const key = id ?? '∅';
    let acc = byVehicle.get(key);
    if (!acc) {
      acc = {
        vehicleId: id,
        vehicleNo: no ?? null,
        vehicleType: type ?? null,
        maintenanceCost: 0,
        jobs: 0,
        fuelCost: 0,
        litres: 0,
        distanceKm: 0,
      };
      byVehicle.set(key, acc);
    }
    if (!acc.vehicleNo && no) acc.vehicleNo = no;
    if (!acc.vehicleType && type) acc.vehicleType = type;
    return acc;
  };

  for (const mrow of maintRows) {
    const acc = get(mrow.vehicleId, mrow.vehicleNo, mrow.vehicleType);
    acc.maintenanceCost += num(mrow.maintenanceCost);
    acc.jobs += num(mrow.jobs);
  }
  for (const f of fuelRows) {
    const acc = get(f.vehicleId, f.vehicleNo, f.vehicleType);
    acc.fuelCost += num(f.fuelCost);
    acc.litres += num(f.litres);
    acc.distanceKm += num(f.distanceKm);
  }

  const rows: FleetCostRow[] = [...byVehicle.values()].map((a) => {
    const totalCost = a.maintenanceCost + a.fuelCost;
    return {
      vehicleId: a.vehicleId,
      vehicleNo: a.vehicleNo ?? '—',
      vehicleType: a.vehicleType,
      maintenanceCost: r2(a.maintenanceCost),
      jobs: a.jobs,
      fuelCost: r2(a.fuelCost),
      litres: r2(a.litres),
      distanceKm: r1(a.distanceKm),
      totalCost: r2(totalCost),
      costPerKm: a.distanceKm > 0 ? r2(totalCost / a.distanceKm) : null,
      kmPerLitre: a.litres > 0 ? r2(a.distanceKm / a.litres) : null,
    };
  });

  // Costliest vehicle first.
  rows.sort((a, b) => b.totalCost - a.totalCost || a.vehicleNo.localeCompare(b.vehicleNo));

  const sums = rows.reduce(
    (t, r) => ({
      maintenanceCost: t.maintenanceCost + r.maintenanceCost,
      fuelCost: t.fuelCost + r.fuelCost,
      totalCost: t.totalCost + r.totalCost,
      litres: t.litres + r.litres,
      distanceKm: t.distanceKm + r.distanceKm,
    }),
    { maintenanceCost: 0, fuelCost: 0, totalCost: 0, litres: 0, distanceKm: 0 },
  );

  return {
    rows,
    totals: {
      vehicles: rows.length,
      maintenanceCost: r2(sums.maintenanceCost),
      fuelCost: r2(sums.fuelCost),
      totalCost: r2(sums.totalCost),
      litres: r2(sums.litres),
      distanceKm: r1(sums.distanceKm),
      costPerKm: sums.distanceKm > 0 ? r2(sums.totalCost / sums.distanceKm) : null,
      kmPerLitre: sums.litres > 0 ? r2(sums.distanceKm / sums.litres) : null,
    },
  };
}
