export const round2 = (v: number): number => Math.round((Number(v) || 0) * 100) / 100;

export interface LineTax {
  taxableAmount: number;
  cgstRate: number; cgstAmount: number;
  sgstRate: number; sgstAmount: number;
  igstRate: number; igstAmount: number;
  cessRate: number; cessAmount: number;
  lineTotal: number;
}

/**
 * GST computation for an invoice line (Design Doc 6 §13, Doc 10 tax rules).
 * Intra-state supply splits gstRate into CGST + SGST; inter-state uses IGST.
 */
export function computeLineTax(
  quantity: number,
  rate: number,
  gstRate: number,
  cessRate: number,
  isInterstate: boolean,
): LineTax {
  const taxableAmount = round2(quantity * rate);
  const cessAmount = round2((taxableAmount * cessRate) / 100);
  let cgstRate = 0, sgstRate = 0, igstRate = 0, cgstAmount = 0, sgstAmount = 0, igstAmount = 0;
  if (isInterstate) {
    igstRate = gstRate;
    igstAmount = round2((taxableAmount * gstRate) / 100);
  } else {
    cgstRate = sgstRate = gstRate / 2;
    cgstAmount = round2((taxableAmount * (gstRate / 2)) / 100);
    sgstAmount = cgstAmount;
  }
  const lineTotal = round2(taxableAmount + cgstAmount + sgstAmount + igstAmount + cessAmount);
  return { taxableAmount, cgstRate, cgstAmount, sgstRate, sgstAmount, igstRate, igstAmount, cessRate, cessAmount, lineTotal };
}
