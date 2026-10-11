import { BadRequestException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import {
  CHARGE_BASIS,
  TRUCK_M3_SETTING_KEY,
  WAITING_FREE_MINUTES_SETTING_KEY,
  isPumpBasis,
  isTransportBasis,
  isWaitingBasis,
  truckM3Setting,
  waitingFreeMinutesSetting,
  type LineEstimateInput,
} from '@rmc/shared';

/** The tenant's billing terms the basis maths read: the truck load for trip estimates and the free waiting period. */
export interface BillingTerms {
  truckM3: number;
  waitingFreeMinutes: number;
}

/** Read the two billing settings inside the tenant transaction (defaults when unset). */
export async function readBillingTerms(m: EntityManager): Promise<BillingTerms> {
  const rows: Array<{ key: string; value: string | null }> = await m.query(
    `SELECT setting_key AS key, setting_value AS value FROM tenant_settings WHERE setting_key = ANY($1)`,
    [[TRUCK_M3_SETTING_KEY, WAITING_FREE_MINUTES_SETTING_KEY]],
  );
  const by = new Map(rows.map((r) => [r.key, r.value]));
  return {
    truckM3: truckM3Setting(by.get(TRUCK_M3_SETTING_KEY)),
    waitingFreeMinutes: waitingFreeMinutesSetting(by.get(WAITING_FREE_MINUTES_SETTING_KEY)),
  };
}

export const BASIS_FIELDS = ['transportBasis', 'pumpBasis', 'waitingBasis'] as const;

const badReq = (message: string) => new BadRequestException({ code: 'VALIDATION_ERROR', message });

/**
 * Validate the three basis fields of a line body. A missing or blank basis
 * is left to the column default (per m³); a value outside the allowed set
 * is refused with the choices named.
 */
export function pickChargeBases(raw: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  const check = (field: (typeof BASIS_FIELDS)[number], ok: (v: unknown) => boolean, choices: string) => {
    const v = raw[field];
    if (v === undefined) return;
    if (v === null || String(v).trim() === '') { out[field] = CHARGE_BASIS.PER_M3; return; }
    if (!ok(v)) throw badReq(`${field} must be one of: ${choices}`);
    out[field] = String(v);
  };
  check('transportBasis', isTransportBasis, 'per_m3, per_trip, lump_sum');
  check('pumpBasis', isPumpBasis, 'per_m3, per_job, per_hour');
  check('waitingBasis', isWaitingBasis, 'per_m3, per_hour');
  return out;
}

/** A priced line (quotation, contract or order item) as the shared estimate reads it. */
export interface PricedLine {
  ratePerM3: unknown;
  transportCharge: unknown;
  pumpCharge: unknown;
  waitingCharge: unknown;
  transportBasis?: unknown;
  pumpBasis?: unknown;
  waitingBasis?: unknown;
}

export function lineEstimateInput(line: PricedLine, qty: unknown, truckM3: number): LineEstimateInput {
  return {
    qty,
    rate: line.ratePerM3,
    transport: line.transportCharge,
    transportBasis: line.transportBasis,
    pump: line.pumpCharge,
    pumpBasis: line.pumpBasis,
    waiting: line.waitingCharge,
    waitingBasis: line.waitingBasis,
    truckM3,
  };
}
