import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { Customer, Order } from '../core/database/entities';

export interface CreditAssessment {
  /** Whether a credit limit is configured (limit > 0). If false, control is off. */
  enforced: boolean;
  creditLimit: number;
  /** opening_balance + value of already-committed (confirmed) orders. */
  outstandingBefore: number;
  requestedAmount: number;
  exposureAfter: number;
  availableBefore: number;
  withinLimit: boolean;
}

/**
 * Credit assessment at booking (Design Doc 2 credit rules, DEV-PLAN B8).
 *
 * Phase-1 exposure model (billing/invoicing arrives in Sprint 9): a customer's
 * outstanding is opening_balance + the value of their already-CONFIRMED orders.
 * A new booking is within limit when outstanding + this order value <= limit.
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
    let creditLimit = 0;
    let outstandingBefore = 0;

    if (customerId) {
      const customer = await m.getRepository(Customer).findOne({ where: { id: customerId } });
      creditLimit = Number(customer?.creditLimit ?? 0);
      outstandingBefore = Number(customer?.openingBalance ?? 0);

      // Sum value of this customer's already-committed (confirmed) orders.
      // GST-inclusive exposure so outstanding reconciles with the invoice; fall
      // back to the ex-GST value for legacy rows created before that column.
      const rows: Array<{ total: string | null }> = await m
        .getRepository(Order)
        .createQueryBuilder('o')
        .select('COALESCE(SUM(COALESCE(o.estimated_order_value_incl_gst, o.estimated_order_value)), 0)', 'total')
        .where('o.customer_id = :customerId', { customerId })
        .andWhere('o.order_status = :status', { status: 'confirmed' })
        .andWhere(excludeOrderId ? 'o.id != :excludeOrderId' : '1=1', { excludeOrderId })
        .getRawOne<{ total: string | null }>()
        .then((r) => [r ?? { total: '0' }]);
      outstandingBefore += Number(rows[0]?.total ?? 0);
    }

    const enforced = creditLimit > 0;
    const exposureAfter = outstandingBefore + amount;
    const withinLimit = !enforced || exposureAfter <= creditLimit;

    return {
      enforced,
      creditLimit,
      outstandingBefore,
      requestedAmount: amount,
      exposureAfter,
      availableBefore: Math.max(0, creditLimit - outstandingBefore),
      withinLimit,
    };
  }
}
