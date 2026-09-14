/**
 * An amount of money in words, the Indian way: "Rupees Twelve Lakh Thirty-Four
 * Thousand Five Hundred Sixty-Seven and Paise Fifty Only".
 *
 * Every Indian invoice and receipt carries the amount in words beside the
 * figure — it is what a signatory reads back and what an auditor checks the
 * figure against — and neither of ours did. Lakh and crore, not million and
 * billion: a customer reading "One Million Two Hundred Thousand" on a receipt
 * from a Tamil Nadu plant would not recognise it as their own money.
 */

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function belowHundred(n: number): string {
  if (n < 20) return ONES[n] ?? '';
  const t = TENS[Math.floor(n / 10)] ?? '';
  const o = ONES[n % 10] ?? '';
  return o ? `${t}-${o}` : t;
}

function belowThousand(n: number): string {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (h) parts.push(`${ONES[h]} Hundred`);
  if (rest) parts.push(belowHundred(rest));
  return parts.join(' ');
}

/** A whole number in the Indian system (thousand, lakh, crore; crores of crores recurse). */
export function integerInWords(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '';
  if (n === 0) return 'Zero';
  const parts: string[] = [];
  const crore = Math.floor(n / 1e7);
  const lakh = Math.floor((n % 1e7) / 1e5);
  const thousand = Math.floor((n % 1e5) / 1e3);
  const rest = n % 1e3;
  if (crore) parts.push(`${integerInWords(crore)} Crore`);
  if (lakh) parts.push(`${belowHundred(lakh)} Lakh`);
  if (thousand) parts.push(`${belowHundred(thousand)} Thousand`);
  if (rest) parts.push(belowThousand(rest));
  return parts.join(' ');
}

/**
 * "Rupees … and Paise … Only". Rounded to the paise, as the figure it sits
 * beside is. A negative amount (a credit note's total, a reversal) reads
 * "Minus Rupees …". Anything that is not a number reads as nothing rather
 * than as a wrong amount.
 */
export function amountInWords(value: string | number | null | undefined): string {
  const n = Number(value);
  if (value == null || value === '' || !Number.isFinite(n)) return '';
  const paiseTotal = Math.round(Math.abs(n) * 100);
  const rupees = Math.floor(paiseTotal / 100);
  const paise = paiseTotal % 100;
  const sign = n < 0 && paiseTotal > 0 ? 'Minus ' : '';
  const words = paise
    ? `Rupees ${integerInWords(rupees)} and Paise ${integerInWords(paise)} Only`
    : `Rupees ${integerInWords(rupees)} Only`;
  return sign + words;
}
