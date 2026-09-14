/**
 * The WhatsApp / SMS texts a customer receives when a document is shared.
 *
 * They used to read "Invoice INV0017 for ₹56640.00. Status: issued. Thank you."
 * and "Quotation QT-1 (rev 0) from us. Status: approved." — no sender, a raw
 * number, and an internal status word. A message a customer gets on their
 * phone names who it is from, formats the money the Indian way, gives the
 * dates, and says in plain words what the document means — including when it
 * has been cancelled or reversed, which is the message that matters most.
 *
 * Pure functions over plain inputs, so the words can be tested without a
 * database; the services load the rows and call these.
 */

/** ₹ with Indian grouping: 1,23,456.00 */
export function inr(value: string | number | null | undefined): string {
  return (Number(value) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** "2026-09-14" → "14/09/2026"; anything else passes through untouched. */
export function dmy(ymd: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd ?? ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(ymd ?? '');
}

export function invoiceShareMessage(i: {
  companyName: string; invoiceNo: string; invoiceDate?: string | null; dueDate?: string | null;
  totalAmount: string | number; invoiceStatus: string;
}): string {
  const dated = i.invoiceDate ? ` dated ${dmy(i.invoiceDate)}` : '';
  if (i.invoiceStatus === 'cancelled') {
    return `${i.companyName}: Invoice ${i.invoiceNo}${dated} has been CANCELLED. Please disregard it.`;
  }
  const due = i.dueDate ? `, due ${dmy(i.dueDate)}` : '';
  return `${i.companyName}: Invoice ${i.invoiceNo}${dated} for ₹${inr(i.totalAmount)}${due}. Thank you.`;
}

export function receiptShareMessage(r: {
  companyName: string; receiptNo: string; receiptDate?: string | null; amount: string | number;
  paymentMode?: string | null; bankReference?: string | null; status: string; clearingStatus?: string | null;
}): string {
  const on = r.receiptDate ? ` on ${dmy(r.receiptDate)}` : '';
  if (r.status === 'reversed' || r.clearingStatus === 'bounced') {
    const why = r.clearingStatus === 'bounced' ? ' — the cheque was returned by the bank' : '';
    return `${r.companyName}: Receipt ${r.receiptNo} for ₹${inr(r.amount)}${on} has been REVERSED${why}. The amount remains due.`;
  }
  const by = r.paymentMode ? ` by ${r.paymentMode}` : '';
  const ref = r.bankReference ? ` (${r.bankReference})` : '';
  const caveat = r.clearingStatus === 'pending' ? ' Subject to realisation of the cheque.' : '';
  return `${r.companyName}: Receipt ${r.receiptNo} — ₹${inr(r.amount)} received${on}${by}${ref}.${caveat} Thank you.`;
}

export function challanShareMessage(c: {
  companyName: string; challanNo: string; gradeLabel?: string | null; quantityM3: string | number;
  vehicleNo?: string | null; dispatchedAt?: string | null; useBy?: string | null; challanStatus: string;
}): string {
  const load = `${c.gradeLabel ? `${c.gradeLabel} ` : ''}${Number(c.quantityM3) || 0} m³`;
  if (c.challanStatus === 'cancelled') {
    return `${c.companyName}: Delivery challan ${c.challanNo} (${load}) has been cancelled.`;
  }
  const on = c.vehicleNo ? ` on ${c.vehicleNo}` : '';
  const left = c.dispatchedAt ? `, left the plant at ${c.dispatchedAt}` : '';
  const useBy = c.useBy ? ` Please place by ${c.useBy}.` : '';
  return `${c.companyName}: Delivery challan ${c.challanNo} — ${load}${on}${left}.${useBy}`;
}

export function quotationShareMessage(q: {
  companyName: string; quotationNo: string; revisionNo?: number | null; quotationDate?: string | null; validUntil?: string | null;
}): string {
  const rev = Number(q.revisionNo) > 0 ? ` (revision ${q.revisionNo})` : '';
  const dated = q.quotationDate ? ` dated ${dmy(q.quotationDate)}` : '';
  const valid = q.validUntil ? `, valid until ${dmy(q.validUntil)}` : '';
  return `${q.companyName}: Quotation ${q.quotationNo}${rev}${dated}${valid}. Please review and confirm.`;
}

export function purchaseOrderShareMessage(o: {
  companyName: string; poNo: string; orderDate?: string | null; expectedDate?: string | null;
  totalAmount: string | number; status: string; lines: string[];
}): string {
  const dated = o.orderDate ? ` dated ${dmy(o.orderDate)}` : '';
  if (o.status === 'cancelled') {
    return `${o.companyName}: Purchase order ${o.poNo}${dated} has been CANCELLED. Please do not supply against it.`;
  }
  const by = o.expectedDate ? `, deliver by ${dmy(o.expectedDate)}` : '';
  const what = o.lines.length ? ` — ${o.lines.join('; ')}` : '';
  return `${o.companyName}: Purchase order ${o.poNo}${dated}${what}, total ₹${inr(o.totalAmount)}${by}. Please quote the PO number on your challan and invoice.`;
}
