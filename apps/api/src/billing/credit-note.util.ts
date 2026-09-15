/**
 * Credit / debit note arithmetic, pure.
 *
 * A note's lines are taxed like an invoice's (the same GST split), its total is
 * rounded to the rupee the same way, and a credit note may not credit more
 * than the invoice still carries. Kept apart from the service so the rules can
 * be tested without a database.
 */
import { computeLineTax, round2 } from './tax.util';

export const NOTE_TYPES = ['credit', 'debit'] as const;
export type NoteType = (typeof NOTE_TYPES)[number];

/** Why a note is raised — printed on it and expected by an auditor. */
export const NOTE_REASONS: Record<string, string> = {
  rate_difference: 'Rate difference',
  quantity_shortfall: 'Quantity short-supplied',
  return: 'Goods returned',
  quality: 'Quality deficiency',
  discount: 'Post-sale discount',
  additional_charge: 'Additional charge',
  correction: 'Correction of an error in the invoice',
  other: 'Other',
};

export interface NoteLineInput {
  description?: string | null;
  hsnSac?: string | null;
  uom?: string | null;
  quantity: number | string;
  rate: number | string;
  gstRate: number | string;
  cessRate?: number | string | null;
}

export interface NoteLine {
  description: string | null;
  hsnSac: string | null;
  uom: string | null;
  quantity: number;
  rate: number;
  taxableAmount: number;
  gstRate: number;
  cgstRate: number; cgstAmount: number;
  sgstRate: number; sgstAmount: number;
  igstRate: number; igstAmount: number;
  cessRate: number; cessAmount: number;
  lineTotal: number;
}

export interface NoteTotals {
  taxableAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  cessAmount: number;
  roundOff: number;
  totalAmount: number;
}

const num = (v: unknown): number => Number(v ?? 0) || 0;

/** Tax every line the way the invoice was taxed (intra vs inter-state). */
export function computeNoteLines(lines: NoteLineInput[], isInterstate: boolean): NoteLine[] {
  return lines.map((l) => {
    const quantity = round2(Math.abs(num(l.quantity)));
    const rate = round2(Math.abs(num(l.rate)));
    const gstRate = num(l.gstRate);
    const cessRate = num(l.cessRate);
    const t = computeLineTax(quantity, rate, gstRate, cessRate, isInterstate);
    return {
      description: l.description?.toString().trim() || null,
      hsnSac: l.hsnSac?.toString().trim() || null,
      uom: l.uom?.toString().trim() || null,
      quantity, rate, gstRate,
      ...t,
    };
  });
}

/** Sum the lines; round the grand total to the rupee as the invoice does. */
export function noteTotals(lines: NoteLine[]): NoteTotals {
  const sum = (k: keyof NoteLine) => round2(lines.reduce((s, l) => s + num(l[k]), 0));
  const taxableAmount = sum('taxableAmount');
  const cgstAmount = sum('cgstAmount');
  const sgstAmount = sum('sgstAmount');
  const igstAmount = sum('igstAmount');
  const cessAmount = sum('cessAmount');
  const grand = round2(taxableAmount + cgstAmount + sgstAmount + igstAmount + cessAmount);
  const totalAmount = Math.round(grand);
  return { taxableAmount, cgstAmount, sgstAmount, igstAmount, cessAmount, roundOff: round2(totalAmount - grand), totalAmount };
}

/**
 * What a credit note may still credit on an invoice: the invoice's total less
 * what earlier issued credit notes already took. Independent of receipts — a
 * credit note is about what was billed, not what was paid; if the customer
 * has already paid, the credit leaves them owed money (see the service).
 */
export function creditHeadroom(invoiceTotal: number | string, alreadyCredited: number | string, debited: number | string = 0): number {
  return round2(num(invoiceTotal) + num(debited) - num(alreadyCredited));
}
