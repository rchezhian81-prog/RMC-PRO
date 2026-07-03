/**
 * Normalise a DTO coming from web forms: empty strings become null. Web inputs
 * submit "" for untouched optional fields, which Postgres rejects for date /
 * numeric / uuid columns. Storing null instead is correct for every nullable
 * sales column. Mutates a shallow copy, not the input.
 */
export function nullifyEmpty(dto: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(dto)) {
    out[k] = v === '' ? null : v;
  }
  return out;
}
