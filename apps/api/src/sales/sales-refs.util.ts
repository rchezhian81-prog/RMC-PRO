import { BadRequestException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { Customer, Lead, Site } from '../core/database/entities';
import { resolveOptionalRef } from '../common/resolve-ref';

/**
 * Header references on a quotation / rate contract must resolve inside the
 * tenant (see resolveRef — FK checks bypass RLS, so a foreign UUID used to be
 * accepted and the document could never be converted or invoiced), and a site
 * must belong to the document's customer: a site of customer X attached to
 * customer Y's quote mis-derives the place of supply and delivers to the wrong
 * party's address. Only keys present in the body are checked, so a partial
 * update that does not touch a reference is unaffected.
 */
export async function assertSalesRefs(
  m: EntityManager,
  rest: Record<string, unknown>,
  currentCustomerId: string | null = null,
): Promise<void> {
  const customer = 'customerId' in rest ? await resolveOptionalRef(m, Customer, rest.customerId, 'Customer') : null;
  const site = 'siteId' in rest ? await resolveOptionalRef(m, Site, rest.siteId, 'Site') : null;
  if ('leadId' in rest) await resolveOptionalRef(m, Lead, rest.leadId, 'Lead');
  const customerId = customer?.id ?? ('customerId' in rest ? null : currentCustomerId);
  if (site && site.customerId && customerId && site.customerId !== customerId) {
    throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Site belongs to a different customer' });
  }
}
