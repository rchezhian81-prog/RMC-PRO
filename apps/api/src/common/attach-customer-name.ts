import { In, type EntityManager } from 'typeorm';
import { Customer } from '../core/database/entities';

/**
 * Enrich list rows that carry a `customerId` with the customer's display name,
 * so a list response can show who each record is for without the client having
 * to fetch every customer and join by hand. One batched query for the whole
 * page; every existing field on the row is preserved and `customerName` is
 * added (null when there is no customer or it can't be found).
 */
export async function attachCustomerName<T extends { customerId?: string | null }>(
  m: EntityManager,
  rows: T[],
): Promise<(T & { customerName: string | null })[]> {
  const ids = [...new Set(rows.map((r) => r.customerId).filter((v): v is string => !!v))];
  const names = new Map<string, string>();
  if (ids.length) {
    const customers = await m.getRepository(Customer).find({ where: { id: In(ids) } });
    for (const c of customers) names.set(c.id, c.customerName);
  }
  return rows.map((r) => ({ ...r, customerName: r.customerId ? names.get(r.customerId) ?? null : null }));
}
