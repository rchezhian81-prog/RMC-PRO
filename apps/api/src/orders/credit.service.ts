import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { round2 } from '../billing/tax.util';
import { computeCustomerExposure } from './exposure.util';

export interface CreditAssessment {
  /** Whether a credit limit is configured (limit > 0). If false, control is off. */
  enforced: boolean;
  creditLimit: number;
  /**
   * The customer's live exposure BEFORE this booking — the unified figure:
   * opening_balance + un-invoiced confirmed orders + issued-invoice outstanding
   * − unapplied advances. May be negative when advances exceed what is owed.
   */
  outstandingBefore: number;
  requestedAmount: number;
  exposureAfter: number;
  availableBefore: number;
  withinLimit: boolean;
}

/**
 * Credit assessment at booking (Design Doc 2 credit rules, DEV-PLAN B8).
 *
 * Reads the single source of truth, `computeCustomerExposure` (design plan §3):
 * a customer's exposure is opening_balance + the un-invoiced value of their
 * CONFIRMED orders + issued-invoice outstanding − unapplied advances (advances
 * auto-net). A new booking is within limit when that exposure + this order's
 * value <= limit. Because the order under assessment is still a draft (or is
 * passed as excludeOrderId), its value is counted once — via requestedAmount,
 * never also in the confirmed-order sum.
 *
 * Convention: credit_limit = 0 means "no limit configured" → credit control is
 * NOT enforced for that customer (booking passes). A positive limit is enforced.
 */
@Injectable()
export class CreditService {
  async assess(
    m: EntityManager,
    customerId: string | null,
    requestedAmount: number,
    excludeOrderId?: string,
  ): Promise<CreditAssessment> {
    const amount = Number(requestedAmount) || 0;
    const exposure = await computeCustomerExposure(m, customerId, excludeOrderId);
    const creditLimit = exposure.creditLimit;
    const outstandingBefore = exposure.exposure;

    const enforced = creditLimit > 0;
    const exposureAfter = round2(outstandingBefore + amount);
    const withinLimit = !enforced || exposureAfter <= creditLimit;

    return {
      enforced,
      creditLimit,
      outstandingBefore,
      requestedAmount: amount,
      exposureAfter,
      availableBefore: Math.max(0, round2(creditLimit - outstandingBefore)),
      withinLimit,
    };
  }
}
