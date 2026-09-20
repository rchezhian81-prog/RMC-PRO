/** Rupee formatting shared by the list screens. */

/** Whole rupees with Indian digit grouping: ₹19,99,500. */
export const money = (v: unknown) => '₹' + Number(v ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });

/** Indian short form for summary pills: ₹9.8 L, ₹1.71 Cr; below a lakh, the full figure. */
export function moneyShort(v: number): string {
  if (v >= 1e7) return '₹' + (v / 1e7).toLocaleString('en-IN', { maximumFractionDigits: 2 }) + ' Cr';
  if (v >= 1e5) return '₹' + (v / 1e5).toLocaleString('en-IN', { maximumFractionDigits: 1 }) + ' L';
  return money(v);
}
