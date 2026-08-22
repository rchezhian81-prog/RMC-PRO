/**
 * Shared field validators — the single source of truth for master-data rules,
 * used by both the API (authoritative) and the web client (immediate feedback),
 * so the two can never drift.
 */
import { MATERIAL_TYPES } from './enums';

/** Standard 15-character GSTIN: 2 state digits, PAN (5A+4N+1A), entity, Z, check. */
export const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** True for a well-formed GSTIN. Callers decide whether the field is required. */
export function isValidGstin(value: string): boolean {
  return GSTIN_REGEX.test(value.trim().toUpperCase());
}

/**
 * Basic Indian mobile check: 10 local digits starting 6–9, optionally with a
 * country code. Deliberately lenient (formatting/spaces allowed) — it rejects
 * junk like "12345", not legitimate numbers.
 */
export function isValidMobile(value: string): boolean {
  const cleaned = value.replace(/[\s\-()]/g, '').replace(/^\+/, '');
  if (!/^\d{10,13}$/.test(cleaned)) return false;
  const local = cleaned.length > 10 ? cleaned.slice(-10) : cleaned;
  return /^[6-9]\d{9}$/.test(local);
}

/** True when a value is a finite number ≥ 0 (for credit limit, days, capacity). */
export function isNonNegativeNumber(value: unknown): boolean {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n >= 0;
}

/** Indian PIN code: exactly 6 digits, first digit 1–9 (0 never starts a PIN). */
export const PINCODE_REGEX = /^[1-9][0-9]{5}$/;

/** Validate a 6-digit Indian PIN code (the GST buyer/seller `Pin`). */
export function isValidPincode(value: string): boolean {
  return PINCODE_REGEX.test(value.trim());
}

/**
 * GST Transporter ID (TRANSIN) or a transporter's GSTIN, as accepted by the NIC
 * e-way `TransId` field: 15 characters — 2 leading state-code digits then 13
 * alphanumerics. A regular GSTIN and an enrolled (non-GST) Transporter ID share
 * this shape, so both pass; the portal makes the finer distinction.
 */
export const TRANSPORTER_ID_REGEX = /^[0-9]{2}[0-9A-Z]{13}$/;

/** True for a well-formed 15-character GST Transporter ID / TRANSIN (or GSTIN). */
export function isValidTransporterId(value: string): boolean {
  return TRANSPORTER_ID_REGEX.test(value.trim().toUpperCase());
}

/**
 * Validate one master record's shared fields. Returns a map of field → message
 * for every problem found (empty object = valid). Field names match the DTO/API
 * keys. Only validates fields that are present and non-empty (except the numeric
 * ones, which are checked whenever provided) — "provided but wrong" is an error;
 * "absent" is governed by the required-fields rule elsewhere.
 */
export function validateMasterFields(dto: Record<string, unknown>): Record<string, string> {
  const errors: Record<string, string> = {};
  const str = (k: string): string | null => {
    const v = dto[k];
    return v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim();
  };

  const gstin = str('gstin');
  if (gstin && !isValidGstin(gstin)) {
    errors.gstin = 'Enter a valid 15-character GSTIN (e.g. 33ABCDE1234F1Z5).';
  }
  const mobile = str('mobile');
  if (mobile && !isValidMobile(mobile)) {
    errors.mobile = 'Enter a valid 10-digit mobile number.';
  }
  const pincode = str('pincode');
  if (pincode && !isValidPincode(pincode)) {
    errors.pincode = 'Enter a valid 6-digit PIN code.';
  }
  const transin = str('transin');
  if (transin && !isValidTransporterId(transin)) {
    errors.transin = 'Enter a valid 15-character GST Transporter ID / TRANSIN.';
  }
  for (const k of [
    'creditLimit',
    'creditDays',
    'capacityM3',
    'openingBalance',
    'specificGravity',
    'bulkDensity',
    'waterAbsorptionPct',
    'defaultMoisturePct',
  ]) {
    if (dto[k] !== undefined && dto[k] !== null && dto[k] !== '' && !isNonNegativeNumber(dto[k])) {
      errors[k] = 'Enter a number of 0 or more.';
    }
  }
  // A conversion factor must be strictly positive: 0 (and its 1/0 inverse) makes
  // a silently unusable row, so it is rejected rather than merely "≥ 0".
  if (dto.factor !== undefined && dto.factor !== null && dto.factor !== '' && !(Number(dto.factor) > 0)) {
    errors.factor = 'Enter a conversion factor greater than 0.';
  }
  // Percentages that cannot exceed 100 (aggregate absorption / free moisture).
  for (const k of ['waterAbsorptionPct', 'defaultMoisturePct']) {
    if (dto[k] !== undefined && dto[k] !== null && dto[k] !== '' && Number(dto[k]) > 100) {
      errors[k] = 'Enter a percentage between 0 and 100.';
    }
  }
  const materialType = str('materialType');
  if (materialType && !(MATERIAL_TYPES as readonly string[]).includes(materialType)) {
    errors.materialType = 'Choose a valid material type.';
  }
  return errors;
}
