import { BadRequestException } from '@nestjs/common';
import type { EntityManager, EntityTarget, FindOptionsWhere, ObjectLiteral } from 'typeorm';

/**
 * Resolve a reference id INSIDE the tenant context, or refuse.
 *
 * Postgres evaluates foreign keys as the table owner, bypassing row security,
 * so a UUID that belongs to another tenant — or, on tables without an FK, any
 * well-formed UUID — satisfies the constraint while every RLS-scoped read in
 * this tenant returns null. Downstream code then tolerates the null (`?.`,
 * LEFT JOINs into blank names) and the row is committed with a dangling
 * reference: an order that can never be invoiced, a stock balance under a
 * plant this tenant cannot see, a payable with no supplier. Resolving through
 * the tenant-bound manager turns all of that into a 400 at the boundary.
 */
export async function resolveRef<T extends ObjectLiteral>(
  m: EntityManager,
  entity: EntityTarget<T>,
  id: unknown,
  label: string,
): Promise<T> {
  const key = String(id ?? '').trim();
  if (!key) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: `${label} is required` });
  const row = await m.getRepository(entity).findOne({ where: { id: key } as unknown as FindOptionsWhere<T> });
  if (!row) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: `${label} not found` });
  return row;
}

/** Like resolveRef, but a blank/absent id is simply "no reference" (null). */
export async function resolveOptionalRef<T extends ObjectLiteral>(
  m: EntityManager,
  entity: EntityTarget<T>,
  id: unknown,
  label: string,
): Promise<T | null> {
  if (id === undefined || id === null || String(id).trim() === '') return null;
  return resolveRef(m, entity, id, label);
}
