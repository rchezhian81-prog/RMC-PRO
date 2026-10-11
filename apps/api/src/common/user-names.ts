import type { EntityManager } from 'typeorm';

/**
 * Display names for a set of user ids, as a lookup. One query for the lot;
 * an id that is not visible (another tenant's, or deleted) resolves to null,
 * so a document never fails to render because its approver has left.
 */
export async function userNames(m: EntityManager, ids: Array<string | null | undefined>): Promise<(id: string | null | undefined) => string | null> {
  const wanted = [...new Set(ids.filter((v): v is string => !!v))];
  const names = new Map<string, string>();
  if (wanted.length) {
    const rows: Array<{ id: string; name: string }> = await m.query(`SELECT id, name FROM users WHERE id = ANY($1::uuid[])`, [wanted]);
    for (const r of rows) names.set(r.id, r.name);
  }
  return (id) => (id ? names.get(id) ?? null : null);
}

/** `11 Oct 2026` — the date as it is printed on a signed document. */
export function documentDay(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${String(d.getDate()).padStart(2, '0')} ${months[d.getMonth()]} ${d.getFullYear()}`;
}
