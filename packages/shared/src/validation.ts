/**
 * Shared field validators — the single source of truth for master-data rules,
 * used by both the API (authoritative) and the web client (immediate feedback),
 * so the two can never drift.
 */

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
  for (const k of ['creditLimit', 'creditDays', 'capacityM3', 'openingBalance']) {
    if (dto[k] !== undefined && dto[k] !== null && dto[k] !== '' && !isNonNegativeNumber(dto[k])) {
      errors[k] = 'Enter a number of 0 or more.';
    }
  }
  return errors;
}
