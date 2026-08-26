import { round2 } from './tax.util';

/**
 * Customer statement of account ("party ledger") — pure assembly.
 *
 * A statement is the customer's running balance over time: their pre-system
 * opening balance, then every issued invoice as a debit (they owe more) and
 * every non-reversed receipt as a credit (they owe less), in date order. When a
 * period [from, to] is given, everything before `from` is folded into the
 * period's opening balance so the listed rows still reconcile to the closing.
 *
 * Pure (no NestJS/DB) so it compiles to dist and is unit-testable; the service
 * gathers the transactions and calls this.
 */

const num = (v: unknown): number => Number(v ?? 0) || 0;

export interface StatementTxn {
  /** ISO date (yyyy-mm-dd) of the document, or null. */
  date: string | null;
  /** Stable tiebreak for same-date ordering (e.g. date + created-at). */
  sortKey: string;
  type: 'invoice' | 'receipt';
  ref: string;
  particulars: string;
  debit: number;
  credit: number;
}

export interface StatementRow extends StatementTxn {
  /** Running balance AFTER this row. */
  balance: number;
}

export interface Statement {
  /** Balance carried into the period (master opening + everything before `from`). */
  opening: number;
  rows: StatementRow[];
  totalDebit: number;
  totalCredit: number;
  /** Balance after the last listed row (opening + period debits − period credits). */
  closing: number;
}

export function buildStatement(opts: {
  openingBalance: number;
  txns: StatementTxn[];
  from?: string | null;
  to?: string | null;
}): Statement {
  const from = opts.from || null;
  const to = opts.to || null;
  const sorted = [...opts.txns].sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0));

  // Fold everything strictly before the period into the opening balance.
  let opening = round2(num(opts.openingBalance));
  for (const t of sorted) {
    if (from && (t.date ?? '') < from) opening = round2(opening + num(t.debit) - num(t.credit));
  }

  const period = sorted.filter((t) => (!from || (t.date ?? '') >= from) && (!to || (t.date ?? '') <= to));

  let bal = opening;
  let totalDebit = 0;
  let totalCredit = 0;
  const rows: StatementRow[] = period.map((t) => {
    const debit = num(t.debit);
    const credit = num(t.credit);
    bal = round2(bal + debit - credit);
    totalDebit = round2(totalDebit + debit);
    totalCredit = round2(totalCredit + credit);
    return { ...t, debit, credit, balance: bal };
  });

  return { opening, rows, totalDebit, totalCredit, closing: bal };
}
