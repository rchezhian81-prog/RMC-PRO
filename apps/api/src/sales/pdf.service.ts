import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { amountInWords } from '../common/amount-in-words.util';
import type { Company } from '../core/database/entities';
import SVGtoPDF from 'svg-to-pdfkit';
import { qrMatrix } from './qr.util';

export interface QuotationPdfItem {
  gradeLabel: string;
  estimatedQuantity: string | number;
  ratePerM3: string | number;
  transportCharge: string | number;
  pumpCharge: string | number;
  waitingCharge: string | number;
  gstApplicable: boolean;
}

export interface QuotationPdfData extends CompanyBlock {
  quotationNo: string;
  quotationDate?: string | null;
  validUntil?: string | null;
  revisionNo: number;
  approvalStatus: string;
  customerName: string;
  customerAddress?: string | null;
  siteName?: string | null;
  paymentTerms?: string | null;
  remarks?: string | null;
  items: QuotationPdfItem[];
}

export interface ChallanPdfData extends CompanyBlock {
  challanNo: string;
  challanStatus: string;
  dispatchTime?: string | null;
  /** When the load was batched — the start of its working life. */
  batchedAt?: string | null;
  /** Batched time plus the concrete's working life: place it by then. */
  useBy?: string | null;
  customerName: string;
  siteName?: string | null;
  /** Where the truck is going, and who to call at the gate. */
  siteAddress?: string | null;
  siteContact?: string | null;
  vehicleNo?: string | null;
  driverName?: string | null;
  gradeLabel: string;
  quantityM3: string | number;
  slump?: string | null;
  receiverName?: string | null;
  /** e-way bill (from the linked invoice) — printed on the dispatch document. */
  ewayBillNo?: string | null;
  ewayValidUntil?: string | null;
}

export interface WeighbridgePdfData extends CompanyBlock {
  slipNo: string;
  entryDatetime?: string | null;
  vehicleNo?: string | null;
  supplierName?: string | null;
  materialLabel?: string | null;
  grossWeight: string | number;
  tareWeight: string | number;
  netWeight: string | number;
  supplierChallanNo?: string | null;
  status: string;
}

export interface InvoicePdfItem {
  description: string;
  hsnSac: string;
  uom: string;
  quantity: string | number;
  rate: string | number;
  taxableAmount: string | number;
  gstRate: string | number;
  cgstAmount: string | number;
  sgstAmount: string | number;
  igstAmount: string | number;
  lineTotal: string | number;
}
export interface CompanyBlock {
  companyName: string;
  legalName?: string | null;
  companyGstin?: string | null;
  companyState?: string | null;
  companyPan?: string | null;
  companyAddress?: string | null;
  companyPhone?: string | null;
  companyEmail?: string | null;
  bankName?: string | null;
  bankAccountNo?: string | null;
  bankIfsc?: string | null;
  bankBranch?: string | null;
  /** Optional invoice logo: validated MIME + base64 bytes. Null → text header. */
  logoMime?: string | null;
  logoData?: string | null;
}
export interface InvoicePdfData extends CompanyBlock {
  companyName: string;
  companyGstin?: string | null;
  companyState?: string | null;
  invoiceNo: string;
  invoiceDate?: string | null;
  dueDate?: string | null;
  invoiceStatus: string;
  customerName: string;
  customerGstin?: string | null;
  /** The recipient's address — CGST Rule 46 requires it on every tax invoice. */
  customerAddress?: string | null;
  /** Where the concrete went: the site, when the invoice has one. */
  shipToName?: string | null;
  shipToAddress?: string | null;
  placeOfSupply?: string | null;
  /** Two-digit GST state code for the place of supply, when the state is known. */
  placeOfSupplyCode?: string | null;
  isInterstate: boolean;
  items: InvoicePdfItem[];
  taxableAmount: string | number;
  cgstAmount: string | number;
  sgstAmount: string | number;
  igstAmount: string | number;
  cessAmount: string | number;
  roundOff: string | number;
  totalAmount: string | number;
  /** e-invoice (IRP) fields — drawn as a signed-QR block when present. */
  irn?: string | null;
  signedQrCode?: string | null;
  ackNo?: string | null;
  ackDate?: string | null;
}

export interface ReceiptPdfAllocation {
  invoiceNo: string;
  invoiceDate?: string | null;
  amount: string | number;
}
/** A receipt (money in) — the customer's evidence that they paid. */
export interface ReceiptPdfData extends CompanyBlock {
  receiptNo: string;
  receiptDate?: string | null;
  /** posted | reversed */
  status: string;
  /** null for instant modes; pending → realised | bounced for cheques. */
  clearingStatus?: string | null;
  customerName: string;
  customerGstin?: string | null;
  customerAddress?: string | null;
  amount: string | number;
  paymentMode?: string | null;
  bankReference?: string | null;
  remarks?: string | null;
  allocations: ReceiptPdfAllocation[];
  unallocatedAmount: string | number;
  isAdvance?: boolean;
}

export interface PurchaseOrderPdfItem {
  materialLabel: string;
  uom?: string | null;
  quantity: string | number;
  rate: string | number;
  gstRate: string | number;
  taxableAmount: string | number;
  taxAmount: string | number;
  lineTotal: string | number;
}
/** A purchase order — the document a supplier is asked to deliver against. */
export interface PurchaseOrderPdfData extends CompanyBlock {
  poNo: string;
  orderDate?: string | null;
  expectedDate?: string | null;
  status: string;
  supplierName: string;
  supplierGstin?: string | null;
  supplierContact?: string | null;
  deliverTo?: string | null;
  items: PurchaseOrderPdfItem[];
  taxableAmount: string | number;
  taxAmount: string | number;
  totalAmount: string | number;
  remarks?: string | null;
}

export interface ExpenseVoucherPdfLine {
  head: string;
  description?: string | null;
  allocation?: string | null;
  amount: string | number;
}
/** A payment voucher — cash or bank paid out, signed by the payee. */
export interface ExpenseVoucherPdfData extends CompanyBlock {
  voucherNo: string;
  voucherDate?: string | null;
  status: string;
  payee?: string | null;
  paymentMode?: string | null;
  plantName?: string | null;
  narration?: string | null;
  remarks?: string | null;
  lines: ExpenseVoucherPdfLine[];
  totalAmount: string | number;
}

export interface VendorPaymentPdfBill {
  billNo: string;
  supplierBillNo?: string | null;
  billDate?: string | null;
  amount: string | number;
}
/** A payment advice — what was paid to a supplier and against which bills. */
export interface VendorPaymentPdfData extends CompanyBlock {
  paymentNo: string;
  paymentDate?: string | null;
  status: string;
  supplierName: string;
  supplierGstin?: string | null;
  amount: string | number;
  paymentMode?: string | null;
  bankReference?: string | null;
  remarks?: string | null;
  bills: VendorPaymentPdfBill[];
  unallocatedAmount: string | number;
}

export interface StatementPdfRow {
  date?: string | null;
  particulars: string;
  ref: string;
  debit: string | number;
  credit: string | number;
  balance: string | number;
}
/** A customer's statement of account — the ledger a customer reconciles against. */
export interface StatementPdfData extends CompanyBlock {
  customerName: string;
  customerGstin?: string | null;
  customerAddress?: string | null;
  from?: string | null;
  to?: string | null;
  opening: string | number;
  rows: StatementPdfRow[];
  totalDebit: string | number;
  totalCredit: string | number;
  closing: string | number;
}

const money = (v: string | number): string =>
  Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Draw the company logo as a band at the top-left, then advance the cursor below
 * it so the existing text header flows underneath. Purely additive: on any
 * problem (missing/invalid bytes, an SVG pdfkit can't draw) it does nothing and
 * returns false, leaving the caller's text header exactly where it was. A logo
 * must never be the reason an invoice fails to render.
 */
function drawLogoBand(
  doc: PDFKit.PDFDocument,
  logo: CompanyBlock,
  left: number,
  top: number,
): boolean {
  if (!logo.logoData || !logo.logoMime) return false;
  const maxW = 150;
  const maxH = 54;
  try {
    if (logo.logoMime === 'image/svg+xml') {
      const svg = Buffer.from(logo.logoData, 'base64').toString('utf8');
      SVGtoPDF(doc, svg, left, top, { width: maxW, height: maxH, preserveAspectRatio: 'xMinYMin meet' });
    } else {
      const buf = Buffer.from(logo.logoData, 'base64');
      // fit scales within the box; the default top-left anchor is what we want.
      doc.image(buf, left, top, { fit: [maxW, maxH] });
    }
    doc.x = left;
    doc.y = top + maxH + 8;
    return true;
  } catch {
    // Fall back to the text header — reset the cursor to where it started.
    doc.x = left;
    doc.y = top;
    return false;
  }
}

/**
 * The supplier block every document opens with, built once from the company
 * master. CGST Rule 46 (tax invoice) and Rule 55 (delivery challan) both
 * require the supplier's name, address and GSTIN; the challan and quotation
 * used to print the name and GSTIN only, each service assembling its own
 * subset by hand.
 */
export function companyBlock(company: Company | null | undefined): CompanyBlock {
  const addr = [
    company?.addressLine1, company?.addressLine2,
    [company?.city, company?.state, company?.pincode].filter(Boolean).join(', '),
  ].filter((v) => v && String(v).trim()).join(', ');
  return {
    companyName: company?.companyName ?? 'Company',
    legalName: company?.legalName ?? null,
    companyGstin: company?.gstin ?? null,
    companyPan: company?.pan ?? null,
    companyState: company?.state ?? null,
    companyAddress: addr || null,
    companyPhone: company?.phone ?? null,
    companyEmail: company?.email ?? null,
    bankName: company?.bankName ?? null,
    bankAccountNo: company?.bankAccountNo ?? null,
    bankIfsc: company?.bankIfsc ?? null,
    bankBranch: company?.bankBranch ?? null,
    logoMime: company?.logoMime ?? null,
    logoData: company?.logoData ?? null,
  };
}

/** Logo band, then name, legal name, address, GSTIN / PAN (or state), phone / email. */
function drawCompanyHeader(doc: PDFKit.PDFDocument, data: CompanyBlock, left: number): void {
  drawLogoBand(doc, data, left, doc.page.margins.top);
  doc.fontSize(17).font('Helvetica-Bold').fillColor('#000').text(data.companyName);
  doc.fontSize(9).font('Helvetica').fillColor('#555');
  if (data.legalName && data.legalName !== data.companyName) doc.text(data.legalName);
  if (data.companyAddress) doc.text(data.companyAddress);
  const idLine = [
    data.companyGstin ? `GSTIN: ${data.companyGstin}` : null,
    data.companyPan ? `PAN: ${data.companyPan}` : null,
  ].filter(Boolean).join('   ');
  if (idLine) doc.text(idLine);
  else if (data.companyState) doc.text(`State: ${data.companyState}`);
  const contactLine = [
    data.companyPhone ? `Ph: ${data.companyPhone}` : null,
    data.companyEmail ? data.companyEmail : null,
  ].filter(Boolean).join('   ');
  if (contactLine) doc.text(contactLine);
  doc.fillColor('#000');
}

/**
 * "For <company> / Authorised Signatory" — the signature block every Indian
 * commercial document closes with. CGST Rule 46(q) requires the supplier's
 * signature (or that of an authorised representative) on a tax invoice that
 * is not an e-invoice, and a customer expects it on a quotation and a receipt
 * as much as on an invoice. Drawn right-aligned with room to sign; the caller
 * decides where on the page it sits.
 */
function drawSignatoryBlock(doc: PDFKit.PDFDocument, companyName: string, left: number, right: number): void {
  doc.x = left;
  doc.moveDown(1.2);
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#000').text(`For ${companyName}`, left, doc.y, { width: right - left, align: 'right' });
  doc.moveDown(2.4);
  doc.font('Helvetica').fontSize(9).fillColor('#555').text('Authorised Signatory', left, doc.y, { width: right - left, align: 'right' });
  doc.fillColor('#000');
}

/**
 * Draw the e-invoice signed-QR block (runbook 01 §5): the government QR printed
 * as pdfkit rectangles from the module matrix, with the IRN / Ack details beside
 * it. Purely additive and never fatal — like the logo, a QR problem must never be
 * the reason an invoice fails to render: on any error it falls back to printing
 * the IRN as text so the e-invoice is still identifiable.
 */
function drawEinvoiceBlock(
  doc: PDFKit.PDFDocument,
  data: InvoicePdfData,
  left: number,
  right: number,
): void {
  if (!data.signedQrCode) return;
  const details = (x: number, startY: number): void => {
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#000').text('e-Invoice (IRP)', x, startY, { width: right - x });
    doc.font('Helvetica').fontSize(7.5).fillColor('#333');
    if (data.irn) doc.text(`IRN: ${data.irn}`, x, doc.y, { width: right - x });
    if (data.ackNo) doc.text(`Ack No: ${data.ackNo}`, x, doc.y, { width: right - x });
    if (data.ackDate) doc.text(`Ack Date: ${data.ackDate}`, x, doc.y, { width: right - x });
    doc.fillColor('#000');
  };
  try {
    const matrix = qrMatrix(data.signedQrCode, 'M');
    const modules = matrix.length;
    const cell = Math.max(1, Math.floor(96 / modules)); // aim for a ~96pt box
    const size = cell * modules;
    // Keep the block whole: start a new page if it wouldn't fit above the footer.
    if (doc.y + size + 24 > doc.page.height - doc.page.margins.bottom) doc.addPage();
    doc.moveDown(0.8);
    const topY = doc.y;
    doc.fillColor('#000');
    for (let r = 0; r < modules; r++) {
      const row = matrix[r];
      if (!row) continue;
      for (let c = 0; c < modules; c++) {
        if (row[c]) doc.rect(left + c * cell, topY + r * cell, cell, cell).fill();
      }
    }
    details(left + size + 14, topY);
    doc.x = left;
    doc.y = Math.max(doc.y, topY + size);
  } catch {
    // QR could not be built — still show the IRN so the e-invoice is traceable.
    doc.moveDown(0.8);
    doc.x = left;
    details(left, doc.y);
    doc.x = left;
  }
}

/**
 * Quotation PDF generation (Design Doc 6 §8.5) using pdfkit — pure JS, no native
 * deps, no headless browser. Returns a Buffer the controller streams as
 * application/pdf.
 */
@Injectable()
export class PdfService {
  quotationPdf(data: QuotationPdfData): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 44 });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const left = doc.page.margins.left;
      const right = doc.page.width - doc.page.margins.right;

      // Header — company block.
      drawCompanyHeader(doc, data, left);

      doc.moveDown(0.5);
      doc.fontSize(15).font('Helvetica-Bold').text('QUOTATION', { align: 'right' });
      doc.fontSize(9).font('Helvetica');
      doc.text(`No: ${data.quotationNo}`, { align: 'right' });
      if (data.revisionNo > 0) doc.text(`Revision: ${data.revisionNo}`, { align: 'right' });
      doc.text(`Status: ${data.approvalStatus}`, { align: 'right' });
      if (data.quotationDate) doc.text(`Date: ${data.quotationDate}`, { align: 'right' });
      if (data.validUntil) doc.text(`Valid until: ${data.validUntil}`, { align: 'right' });

      // Divider.
      doc.moveDown(0.6);
      doc.moveTo(left, doc.y).lineTo(right, doc.y).strokeColor('#cccccc').stroke().strokeColor('#000');
      doc.moveDown(0.6);

      // Bill-to block.
      doc.fontSize(10).font('Helvetica-Bold').text('Customer');
      doc.font('Helvetica').text(data.customerName);
      if (data.customerAddress) doc.font('Helvetica').fontSize(9).text(data.customerAddress);
      if (data.siteName) {
        doc.moveDown(0.2);
        doc.font('Helvetica-Bold').text('Site / Project');
        doc.font('Helvetica').text(data.siteName);
      }
      doc.moveDown(0.8);

      // Items table.
      const cols = [
        { key: 'grade', label: 'Grade', w: 92, align: 'left' as const },
        { key: 'qty', label: 'Qty (m³)', w: 62, align: 'right' as const },
        { key: 'rate', label: 'Rate/m³', w: 74, align: 'right' as const },
        { key: 'transport', label: 'Transport', w: 70, align: 'right' as const },
        { key: 'pump', label: 'Pump', w: 62, align: 'right' as const },
        { key: 'waiting', label: 'Waiting', w: 62, align: 'right' as const },
        { key: 'gst', label: 'GST', w: 40, align: 'center' as const },
      ];
      const startX = left;
      let y = doc.y;

      const drawRow = (cells: string[], bold: boolean, fill?: string) => {
        const rowH = 20;
        if (fill) doc.rect(startX, y - 3, right - left, rowH).fill(fill).fillColor('#000');
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).fillColor('#000');
        let x = startX;
        cols.forEach((c, i) => {
          doc.text(cells[i] ?? '', x + 4, y + 2, { width: c.w - 8, align: c.align });
          x += c.w;
        });
        y += rowH;
      };

      drawRow(cols.map((c) => c.label), true, '#eef1f6');
      for (const it of data.items) {
        drawRow(
          [
            it.gradeLabel || '-',
            money(it.estimatedQuantity),
            money(it.ratePerM3),
            money(it.transportCharge),
            money(it.pumpCharge),
            money(it.waitingCharge),
            it.gstApplicable ? 'Yes' : 'No',
          ],
          false,
        );
        if (y > doc.page.height - 120) {
          doc.addPage();
          y = doc.page.margins.top;
        }
      }

      doc.y = y + 10;
      doc.x = left;
      if (data.paymentTerms) {
        doc.font('Helvetica-Bold').fontSize(9).text('Payment terms: ', { continued: true });
        doc.font('Helvetica').text(data.paymentTerms);
      }
      if (data.remarks) {
        doc.moveDown(0.3);
        doc.font('Helvetica-Bold').fontSize(9).text('Remarks: ', { continued: true });
        doc.font('Helvetica').text(data.remarks);
      }

      drawSignatoryBlock(doc, data.companyName, left, right);
      doc.moveDown(1.5);
      doc.fontSize(8).fillColor('#777').text(
        'This is a system-generated quotation. Rates are exclusive of GST unless stated otherwise.',
        { align: 'center' },
      );

      doc.end();
    });
  }

  /** Delivery challan PDF (Design Doc 6 §11.2, Doc 12) — pdfkit. */
  challanPdf(data: ChallanPdfData): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 44 });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const left = doc.page.margins.left;
      const right = doc.page.width - doc.page.margins.right;

      drawCompanyHeader(doc, data, left);

      doc.moveDown(0.4);
      doc.fontSize(15).font('Helvetica-Bold').text('DELIVERY CHALLAN', { align: 'right' });
      doc.fontSize(9).font('Helvetica');
      doc.text(`No: ${data.challanNo}`, { align: 'right' });
      doc.text(`Status: ${data.challanStatus}`, { align: 'right' });
      if (data.batchedAt) doc.text(`Batched: ${data.batchedAt}`, { align: 'right' });
      if (data.dispatchTime) doc.text(`Dispatched: ${data.dispatchTime}`, { align: 'right' });

      doc.moveDown(0.6);
      doc.moveTo(left, doc.y).lineTo(right, doc.y).strokeColor('#cccccc').stroke().strokeColor('#000');
      doc.moveDown(0.6);

      const row = (label: string, value: string) => {
        doc.font('Helvetica-Bold').fontSize(10).text(`${label}: `, { continued: true });
        doc.font('Helvetica').text(value || '-');
      };
      row('Customer', data.customerName);
      row('Site / Project', data.siteName ?? '-');
      // The driver's copy is the one that has to find the site.
      if (data.siteAddress) row('Site address', data.siteAddress);
      if (data.siteContact) row('Site contact', data.siteContact);
      row('Vehicle', data.vehicleNo ?? '-');
      row('Driver', data.driverName ?? '-');
      // The one line the site engineer must read: the concrete's working life
      // runs from batching, and pouring after it is a rejected pour.
      if (data.useBy) {
        doc.font('Helvetica-Bold').fontSize(11).fillColor('#b91c1c').text(`Use by: ${data.useBy}`);
        doc.fillColor('#000').fontSize(10);
      }
      // E-way bill must travel with the goods — print it on the dispatch document.
      if (data.ewayBillNo) {
        const validity = data.ewayValidUntil ? ` (valid till ${data.ewayValidUntil})` : '';
        row('E-Way Bill', `${data.ewayBillNo}${validity}`);
      }
      doc.moveDown(0.6);

      // Delivery details box.
      const cells: Array<[string, string]> = [
        ['Grade', data.gradeLabel || '-'],
        ['Quantity (m³)', money(data.quantityM3)],
        ['Slump', data.slump ?? '-'],
      ];
      let y = doc.y;
      for (const [k, v] of cells) {
        doc.rect(left, y - 2, right - left, 22).fill('#f4f6fa').fillColor('#000');
        doc.font('Helvetica-Bold').fontSize(10).text(k, left + 6, y + 3, { width: 160 });
        doc.font('Helvetica').text(v, left + 180, y + 3);
        y += 24;
      }

      doc.y = y + 24;
      doc.x = left;
      doc.font('Helvetica-Bold').fontSize(10).text(`Received by: ${data.receiverName ?? '________________'}`);
      doc.moveDown(2);
      // Two signatures: the plant's on the left, the receiver's on the right.
      const sigY = doc.y;
      doc.font('Helvetica').fontSize(9).fillColor('#555').text(`For ${data.companyName}: ____________________`, left, sigY, { width: (right - left) / 2, align: 'left' });
      doc.text('Receiver signature: ____________________', left + (right - left) / 2, sigY, { width: (right - left) / 2, align: 'right' });
      doc.x = left;
      doc.fillColor('#000');

      doc.moveDown(1.5);
      doc.fontSize(8).fillColor('#777').text('System-generated delivery challan.', { align: 'center' });
      doc.end();
    });
  }

  /** Weighbridge slip PDF (Design Doc 6 §12.4) — pdfkit. */
  weighbridgePdf(data: WeighbridgePdfData): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 44 });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const left = doc.page.margins.left;
      const right = doc.page.width - doc.page.margins.right;

      drawCompanyHeader(doc, data, left);
      doc.moveDown(0.3);
      doc.fontSize(15).font('Helvetica-Bold').text('WEIGHBRIDGE SLIP', { align: 'right' });
      doc.fontSize(9).font('Helvetica');
      doc.text(`Slip No: ${data.slipNo}`, { align: 'right' });
      doc.text(`Status: ${data.status}`, { align: 'right' });
      if (data.entryDatetime) doc.text(`Date/time: ${data.entryDatetime}`, { align: 'right' });

      doc.moveDown(0.6);
      doc.moveTo(left, doc.y).lineTo(right, doc.y).strokeColor('#cccccc').stroke().strokeColor('#000');
      doc.moveDown(0.6);

      const row = (label: string, value: string) => {
        doc.font('Helvetica-Bold').fontSize(10).text(`${label}: `, { continued: true });
        doc.font('Helvetica').text(value || '-');
      };
      row('Vehicle', data.vehicleNo ?? '-');
      row('Supplier', data.supplierName ?? '-');
      row('Material', data.materialLabel ?? '-');
      row('Supplier challan', data.supplierChallanNo ?? '-');
      doc.moveDown(0.6);

      const weights: Array<[string, string]> = [
        ['Gross weight', money(data.grossWeight)],
        ['Tare weight', money(data.tareWeight)],
        ['Net weight', money(data.netWeight)],
      ];
      let y = doc.y;
      for (const [k, v] of weights) {
        const bold = k === 'Net weight';
        doc.rect(left, y - 2, right - left, 24).fill(bold ? '#eef1f6' : '#f8f9fc').fillColor('#000');
        doc.font('Helvetica-Bold').fontSize(bold ? 12 : 10).text(k, left + 6, y + 4, { width: 200 });
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').text(v, left + 220, y + 4);
        y += 26;
      }

      doc.y = y + 24;
      doc.x = left;
      doc.fontSize(8).fillColor('#777').text('System-generated weighbridge slip (manual entry).', { align: 'center' });
      doc.end();
    });
  }

  /** Tax invoice PDF (Design Doc 6 §13, Doc 12) — pdfkit. */
  invoicePdf(data: InvoicePdfData): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 40 });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const left = doc.page.margins.left;
      const right = doc.page.width - doc.page.margins.right;

      // Optional logo band at the very top; the text header below is unchanged
      // and always drawn, so every required detail still appears with or without.
      drawCompanyHeader(doc, data, left);

      doc.moveDown(0.3);
      doc.fontSize(14).font('Helvetica-Bold').text('TAX INVOICE', { align: 'right' });
      doc.fontSize(9).font('Helvetica');
      doc.text(`No: ${data.invoiceNo}`, { align: 'right' });
      doc.text(`Status: ${data.invoiceStatus}`, { align: 'right' });
      if (data.invoiceDate) doc.text(`Date: ${data.invoiceDate}`, { align: 'right' });
      if (data.dueDate) doc.text(`Due: ${data.dueDate}`, { align: 'right' });

      doc.moveDown(0.5);
      doc.moveTo(left, doc.y).lineTo(right, doc.y).strokeColor('#cccccc').stroke().strokeColor('#000');
      doc.moveDown(0.5);
      doc.font('Helvetica-Bold').fontSize(10).text('Bill to: ', { continued: true });
      doc.font('Helvetica').text(data.customerName);
      // Name, address and GSTIN of the recipient — CGST Rule 46(c)/(d). The
      // address used to be missing from every invoice.
      if (data.customerAddress) doc.font('Helvetica').fontSize(9).text(data.customerAddress);
      if (data.customerGstin) doc.font('Helvetica').fontSize(9).text(`GSTIN: ${data.customerGstin}`);
      if (data.shipToName || data.shipToAddress) {
        doc.moveDown(0.3);
        doc.font('Helvetica-Bold').fontSize(10).text('Ship to: ', { continued: true });
        doc.font('Helvetica').text(data.shipToName ?? '-');
        if (data.shipToAddress) doc.fontSize(9).text(data.shipToAddress);
      }
      const pos = data.placeOfSupply ?? '-';
      doc.font('Helvetica').fontSize(9).text(`Place of supply: ${pos}${data.placeOfSupplyCode ? ` (${data.placeOfSupplyCode})` : ''} — ${data.isInterstate ? 'Inter-state / IGST' : 'Intra-state / CGST+SGST'}`);
      doc.moveDown(0.6);

      const cols = [
        { key: 'desc', label: 'Description', w: 150, align: 'left' as const },
        { key: 'hsn', label: 'HSN/SAC', w: 60, align: 'left' as const },
        { key: 'uom', label: 'UOM', w: 40, align: 'left' as const },
        { key: 'qty', label: 'Qty', w: 52, align: 'right' as const },
        { key: 'rate', label: 'Rate', w: 58, align: 'right' as const },
        { key: 'taxable', label: 'Taxable', w: 70, align: 'right' as const },
        { key: 'gst', label: 'GST%', w: 40, align: 'right' as const },
        { key: 'total', label: 'Total', w: 75, align: 'right' as const },
      ];
      const startX = left;
      let y = doc.y;
      const drawRow = (cells: string[], bold: boolean, fill?: string) => {
        const rowH = 18;
        if (fill) doc.rect(startX, y - 2, right - left, rowH).fill(fill).fillColor('#000');
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5).fillColor('#000');
        let x = startX;
        cols.forEach((c, i) => { doc.text(cells[i] ?? '', x + 3, y + 3, { width: c.w - 6, align: c.align }); x += c.w; });
        y += rowH;
      };
      drawRow(cols.map((c) => c.label), true, '#eef1f6');
      for (const it of data.items) {
        drawRow([
          it.description || '-', it.hsnSac || '-', it.uom || '-',
          money(it.quantity), money(it.rate), money(it.taxableAmount), String(Number(it.gstRate)), money(it.lineTotal),
        ], false);
        if (y > doc.page.height - 160) { doc.addPage(); y = doc.page.margins.top; }
      }

      doc.y = y + 10;
      doc.x = left;
      const totalLine = (label: string, value: string, bold = false) => {
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 9.5)
          .text(`${label}   ${value}`, { align: 'right' });
      };
      totalLine('Taxable', money(data.taxableAmount));
      if (Number(data.cgstAmount) > 0) totalLine('CGST', money(data.cgstAmount));
      if (Number(data.sgstAmount) > 0) totalLine('SGST', money(data.sgstAmount));
      if (Number(data.igstAmount) > 0) totalLine('IGST', money(data.igstAmount));
      if (Number(data.cessAmount) > 0) totalLine('Cess', money(data.cessAmount));
      if (Number(data.roundOff) !== 0) totalLine('Round off', money(data.roundOff));
      totalLine('Total', `INR ${money(data.totalAmount)}`, true);
      // The figure in words beside the figure: what a signatory reads back and
      // an auditor checks the figure against. Every Indian invoice carries it.
      doc.font('Helvetica').fontSize(9).text(`Amount in words: ${amountInWords(data.totalAmount)}`, { align: 'right' });

      // Bank details block — where the customer pays. Only drawn if provided.
      const bankBits = [
        data.bankName ? `Bank: ${data.bankName}` : null,
        data.bankAccountNo ? `A/c: ${data.bankAccountNo}` : null,
        data.bankIfsc ? `IFSC: ${data.bankIfsc}` : null,
        data.bankBranch ? `Branch: ${data.bankBranch}` : null,
      ].filter(Boolean);
      if (bankBits.length) {
        doc.moveDown(1);
        doc.x = left;
        doc.font('Helvetica-Bold').fontSize(9).fillColor('#000').text('Payment details', left, doc.y);
        doc.font('Helvetica').fontSize(9).fillColor('#555').text(bankBits.join('   '), { align: 'left' });
        doc.fillColor('#000');
      }

      // e-invoice signed QR + IRN (only when the invoice has an IRN).
      drawEinvoiceBlock(doc, data, left, right);

      drawSignatoryBlock(doc, data.companyName, left, right);
      doc.moveDown(1.5);
      doc.fontSize(8).fillColor('#777').text('System-generated tax invoice.', { align: 'center' });
      doc.end();
    });
  }

  /**
   * Receipt (money in). The customer's evidence that they paid, and the
   * plant's record of what the money was set against. A cheque receipt says
   * plainly that it is subject to realisation; a reversed or bounced receipt
   * says, in red, that it is no longer a receipt — the document a customer
   * holds must never claim a discharge the ledger has taken back.
   */
  receiptPdf(data: ReceiptPdfData): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 40 });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const left = doc.page.margins.left;
      const right = doc.page.width - doc.page.margins.right;

      drawCompanyHeader(doc, data, left);

      doc.moveDown(0.3);
      doc.fontSize(14).font('Helvetica-Bold').text('RECEIPT', { align: 'right' });
      doc.fontSize(9).font('Helvetica');
      doc.text(`No: ${data.receiptNo}`, { align: 'right' });
      if (data.receiptDate) doc.text(`Date: ${data.receiptDate}`, { align: 'right' });
      doc.text(`Status: ${data.status}${data.clearingStatus ? ` (${data.clearingStatus})` : ''}`, { align: 'right' });

      doc.moveDown(0.5);
      doc.moveTo(left, doc.y).lineTo(right, doc.y).strokeColor('#cccccc').stroke().strokeColor('#000');
      doc.moveDown(0.5);

      const reversed = data.status === 'reversed' || data.clearingStatus === 'bounced';
      if (reversed) {
        doc.font('Helvetica-Bold').fontSize(12).fillColor('#b91c1c')
          .text(data.clearingStatus === 'bounced'
            ? 'INSTRUMENT RETURNED — this receipt is reversed and does not discharge the amount below.'
            : 'REVERSED — this receipt is cancelled and does not discharge the amount below.');
        doc.fillColor('#000').moveDown(0.5);
      }

      doc.font('Helvetica-Bold').fontSize(10).text('Received from: ', { continued: true });
      doc.font('Helvetica').text(data.customerName);
      if (data.customerAddress) doc.fontSize(9).text(data.customerAddress);
      if (data.customerGstin) doc.fontSize(9).text(`GSTIN: ${data.customerGstin}`);
      doc.moveDown(0.6);
      doc.font('Helvetica-Bold').fontSize(13).text(`INR ${money(data.amount)}`);
      doc.font('Helvetica').fontSize(9.5).text(`Amount in words: ${amountInWords(data.amount)}`);
      doc.moveDown(0.4);
      const modeBits = [
        data.paymentMode ? `Mode: ${data.paymentMode}` : null,
        data.bankReference ? `Ref: ${data.bankReference}` : null,
      ].filter(Boolean).join('   ');
      if (modeBits) doc.fontSize(9).text(modeBits);
      if (data.remarks) doc.fontSize(9).fillColor('#555').text(`Remarks: ${data.remarks}`).fillColor('#000');
      doc.moveDown(0.8);

      if (data.allocations.length) {
        doc.font('Helvetica-Bold').fontSize(10).text('Set against');
        doc.moveDown(0.2);
        const cols = [
          { key: 'inv', label: 'Invoice No', w: 200, align: 'left' as const },
          { key: 'date', label: 'Invoice date', w: 120, align: 'left' as const },
          { key: 'amt', label: 'Amount', w: 120, align: 'right' as const },
        ];
        let y = doc.y;
        const drawRow = (cells: string[], bold: boolean, fill?: string) => {
          const rowH = 18;
          if (fill) doc.rect(left, y - 2, cols.reduce((a, c) => a + c.w, 0), rowH).fill(fill).fillColor('#000');
          doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5).fillColor('#000');
          let x = left;
          cols.forEach((c, i) => { doc.text(cells[i] ?? '', x + 3, y + 3, { width: c.w - 6, align: c.align }); x += c.w; });
          y += rowH;
        };
        drawRow(cols.map((c) => c.label), true, '#eef1f6');
        for (const a of data.allocations) {
          drawRow([a.invoiceNo, a.invoiceDate ?? '-', money(a.amount)], false);
          if (y > doc.page.height - 140) { doc.addPage(); y = doc.page.margins.top; }
        }
        doc.y = y + 6;
        doc.x = left;
      }
      if (Number(data.unallocatedAmount) > 0) {
        doc.font('Helvetica').fontSize(9.5)
          .text(`Unallocated: INR ${money(data.unallocatedAmount)} — held as an advance against future invoices.`, left, doc.y);
      } else if (!data.allocations.length && data.isAdvance) {
        doc.font('Helvetica').fontSize(9.5).text('Received as an advance against future invoices.', left, doc.y);
      }

      if (data.clearingStatus === 'pending') {
        doc.moveDown(0.8);
        doc.font('Helvetica-Bold').fontSize(9.5).text('Subject to realisation of the cheque / instrument.', left, doc.y);
      }

      drawSignatoryBlock(doc, data.companyName, left, right);
      doc.moveDown(1.5);
      doc.font('Helvetica').fontSize(8).fillColor('#777').text('System-generated receipt.', left, doc.y, { align: 'center' });
      doc.end();
    });
  }

  /**
   * Statement of account. Opening balance, then every invoice (debit) and
   * receipt (credit) in date order with a running balance, and the closing
   * balance the customer is asked to confirm. Long ledgers run to as many
   * pages as they need, with the column headings repeated on each.
   */
  statementPdf(data: StatementPdfData): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 40 });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const left = doc.page.margins.left;
      const right = doc.page.width - doc.page.margins.right;

      drawCompanyHeader(doc, data, left);
      doc.moveDown(0.3);
      doc.fontSize(14).font('Helvetica-Bold').text('STATEMENT OF ACCOUNT', { align: 'right' });
      doc.fontSize(9).font('Helvetica');
      if (data.from || data.to) doc.text(`Period: ${data.from ?? '…'} to ${data.to ?? '…'}`, { align: 'right' });

      doc.moveDown(0.5);
      doc.moveTo(left, doc.y).lineTo(right, doc.y).strokeColor('#cccccc').stroke().strokeColor('#000');
      doc.moveDown(0.5);
      doc.font('Helvetica-Bold').fontSize(10).text('Customer: ', { continued: true });
      doc.font('Helvetica').text(data.customerName);
      if (data.customerAddress) doc.fontSize(9).text(data.customerAddress);
      if (data.customerGstin) doc.fontSize(9).text(`GSTIN: ${data.customerGstin}`);
      doc.moveDown(0.6);

      const cols = [
        { key: 'date', label: 'Date', w: 66, align: 'left' as const },
        { key: 'particulars', label: 'Particulars', w: 190, align: 'left' as const },
        { key: 'ref', label: 'Ref', w: 95, align: 'left' as const },
        { key: 'debit', label: 'Debit', w: 55, align: 'right' as const },
        { key: 'credit', label: 'Credit', w: 55, align: 'right' as const },
        { key: 'balance', label: 'Balance', w: 54, align: 'right' as const },
      ];
      let y = doc.y;
      const rowH = 18;
      const drawRow = (cells: string[], bold: boolean, fill?: string) => {
        if (fill) doc.rect(left, y - 2, right - left, rowH).fill(fill).fillColor('#000');
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5).fillColor('#000');
        let x = left;
        cols.forEach((c, i) => { doc.text(cells[i] ?? '', x + 3, y + 3, { width: c.w - 6, align: c.align, lineBreak: false }); x += c.w; });
        y += rowH;
      };
      const header = () => drawRow(cols.map((c) => c.label), true, '#eef1f6');
      const pageBreakIfNeeded = () => {
        if (y > doc.page.height - 120) { doc.addPage(); y = doc.page.margins.top; header(); }
      };
      header();
      drawRow(['', 'Opening balance', '', '', '', money(data.opening)], true);
      for (const r of data.rows) {
        pageBreakIfNeeded();
        drawRow([r.date ?? '-', r.particulars, r.ref, Number(r.debit) ? money(r.debit) : '', Number(r.credit) ? money(r.credit) : '', money(r.balance)], false);
      }
      pageBreakIfNeeded();
      drawRow(['', 'Totals for the period', '', money(data.totalDebit), money(data.totalCredit), ''], true, '#f6f7f9');
      drawRow(['', 'Closing balance', '', '', '', money(data.closing)], true);

      doc.y = y + 8;
      doc.x = left;
      const closing = Number(data.closing) || 0;
      doc.font('Helvetica-Bold').fontSize(11).text(
        closing > 0
          ? `Amount due from you: INR ${money(closing)}`
          : closing < 0
            ? `Balance in your favour: INR ${money(-closing)}`
            : 'No balance outstanding.',
        left, doc.y,
      );
      doc.font('Helvetica').fontSize(9).fillColor('#555')
        .text('Please report any discrepancy within 7 days; the balance stands confirmed otherwise.', left, doc.y + 2);
      doc.fillColor('#000');

      drawSignatoryBlock(doc, data.companyName, left, right);
      doc.moveDown(1.5);
      doc.font('Helvetica').fontSize(8).fillColor('#777').text('System-generated statement of account.', left, doc.y, { align: 'center' });
      doc.end();
    });
  }

  /**
   * Purchase order. What the plant is buying, from whom, at what rate, to be
   * delivered where and by when — the document the supplier's dispatch works
   * from. A cancelled order says so in red rather than printing as an order.
   */
  purchaseOrderPdf(data: PurchaseOrderPdfData): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 40 });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const left = doc.page.margins.left;
      const right = doc.page.width - doc.page.margins.right;

      drawCompanyHeader(doc, data, left);
      doc.moveDown(0.3);
      doc.fontSize(14).font('Helvetica-Bold').text('PURCHASE ORDER', { align: 'right' });
      doc.fontSize(9).font('Helvetica');
      doc.text(`No: ${data.poNo}`, { align: 'right' });
      if (data.orderDate) doc.text(`Date: ${data.orderDate}`, { align: 'right' });
      if (data.expectedDate) doc.text(`Deliver by: ${data.expectedDate}`, { align: 'right' });
      doc.text(`Status: ${data.status}`, { align: 'right' });

      doc.moveDown(0.5);
      doc.moveTo(left, doc.y).lineTo(right, doc.y).strokeColor('#cccccc').stroke().strokeColor('#000');
      doc.moveDown(0.5);
      if (data.status === 'cancelled') {
        doc.font('Helvetica-Bold').fontSize(12).fillColor('#b91c1c').text('CANCELLED — this order is withdrawn. Please do not supply against it.');
        doc.fillColor('#000').moveDown(0.5);
      }
      doc.font('Helvetica-Bold').fontSize(10).text('To: ', { continued: true });
      doc.font('Helvetica').text(data.supplierName);
      if (data.supplierGstin) doc.fontSize(9).text(`GSTIN: ${data.supplierGstin}`);
      if (data.supplierContact) doc.fontSize(9).text(data.supplierContact);
      if (data.deliverTo) {
        doc.moveDown(0.3);
        doc.font('Helvetica-Bold').fontSize(10).text('Deliver to: ', { continued: true });
        doc.font('Helvetica').text(data.deliverTo);
      }
      doc.moveDown(0.6);

      const cols = [
        { key: 'material', label: 'Material', w: 170, align: 'left' as const },
        { key: 'uom', label: 'UOM', w: 45, align: 'left' as const },
        { key: 'qty', label: 'Qty', w: 60, align: 'right' as const },
        { key: 'rate', label: 'Rate', w: 65, align: 'right' as const },
        { key: 'gst', label: 'GST%', w: 40, align: 'right' as const },
        { key: 'taxable', label: 'Taxable', w: 70, align: 'right' as const },
        { key: 'total', label: 'Total', w: 65, align: 'right' as const },
      ];
      let y = doc.y;
      const rowH = 18;
      const drawRow = (cells: string[], bold: boolean, fill?: string) => {
        if (fill) doc.rect(left, y - 2, right - left, rowH).fill(fill).fillColor('#000');
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5).fillColor('#000');
        let x = left;
        cols.forEach((c, i) => { doc.text(cells[i] ?? '', x + 3, y + 3, { width: c.w - 6, align: c.align, lineBreak: false }); x += c.w; });
        y += rowH;
      };
      const header = () => drawRow(cols.map((c) => c.label), true, '#eef1f6');
      header();
      for (const it of data.items) {
        if (y > doc.page.height - 160) { doc.addPage(); y = doc.page.margins.top; header(); }
        drawRow([it.materialLabel || '-', it.uom || '-', money(it.quantity), money(it.rate), String(Number(it.gstRate) || 0), money(it.taxableAmount), money(it.lineTotal)], false);
      }
      doc.y = y + 10;
      doc.x = left;
      const totalLine = (label: string, value: string, bold = false) => {
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 9.5).text(`${label}   ${value}`, left, doc.y, { align: 'right' });
      };
      totalLine('Taxable', money(data.taxableAmount));
      totalLine('GST', money(data.taxAmount));
      totalLine('Total', `INR ${money(data.totalAmount)}`, true);
      doc.font('Helvetica').fontSize(9).text(`Amount in words: ${amountInWords(data.totalAmount)}`, left, doc.y, { align: 'right' });
      if (data.remarks) {
        doc.moveDown(0.6);
        doc.font('Helvetica-Bold').fontSize(9).text('Terms / remarks: ', left, doc.y, { continued: true });
        doc.font('Helvetica').text(data.remarks);
      }
      doc.moveDown(0.4);
      doc.font('Helvetica').fontSize(8.5).fillColor('#555')
        .text('Please quote the PO number on your delivery challan and invoice. Quantities are subject to weighbridge at our plant.', left, doc.y);
      doc.fillColor('#000');

      drawSignatoryBlock(doc, data.companyName, left, right);
      doc.moveDown(1.5);
      doc.font('Helvetica').fontSize(8).fillColor('#777').text('System-generated purchase order.', left, doc.y, { align: 'center' });
      doc.end();
    });
  }

  /**
   * Payment voucher (expenses). Cash or bank paid out of the plant: to whom,
   * for what, allocated where, and the three signatures a voucher carries —
   * prepared, authorised, received. A draft says it is not yet posted; a
   * cancelled one says so in red.
   */
  expenseVoucherPdf(data: ExpenseVoucherPdfData): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 40 });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      const left = doc.page.margins.left;
      const right = doc.page.width - doc.page.margins.right;

      drawCompanyHeader(doc, data, left);
      doc.moveDown(0.3);
      doc.fontSize(14).font('Helvetica-Bold').text('PAYMENT VOUCHER', { align: 'right' });
      doc.fontSize(9).font('Helvetica');
      doc.text(`No: ${data.voucherNo}`, { align: 'right' });
      if (data.voucherDate) doc.text(`Date: ${data.voucherDate}`, { align: 'right' });
      doc.text(`Status: ${data.status}`, { align: 'right' });
      doc.moveDown(0.5);
      doc.moveTo(left, doc.y).lineTo(right, doc.y).strokeColor('#cccccc').stroke().strokeColor('#000');
      doc.moveDown(0.5);
      if (data.status === 'cancelled') {
        doc.font('Helvetica-Bold').fontSize(12).fillColor('#b91c1c').text('CANCELLED — no payment was made against this voucher.');
        doc.fillColor('#000').moveDown(0.5);
      } else if (data.status === 'draft') {
        doc.font('Helvetica-Bold').fontSize(10).fillColor('#92400e').text('DRAFT — not yet posted; the amount is not booked until it is.');
        doc.fillColor('#000').moveDown(0.5);
      }
      doc.font('Helvetica-Bold').fontSize(10).text('Paid to: ', { continued: true });
      doc.font('Helvetica').text(data.payee ?? '-');
      const bits = [
        data.paymentMode ? `Mode: ${data.paymentMode}` : null,
        data.plantName ? `Plant: ${data.plantName}` : null,
      ].filter(Boolean).join('   ');
      if (bits) doc.fontSize(9).text(bits);
      doc.moveDown(0.5);
      doc.font('Helvetica-Bold').fontSize(13).text(`INR ${money(data.totalAmount)}`);
      doc.font('Helvetica').fontSize(9.5).text(`Amount in words: ${amountInWords(data.totalAmount)}`);
      doc.moveDown(0.6);

      const cols = [
        { key: 'head', label: 'Expense head', w: 150, align: 'left' as const },
        { key: 'desc', label: 'Description', w: 165, align: 'left' as const },
        { key: 'alloc', label: 'Allocated to', w: 120, align: 'left' as const },
        { key: 'amt', label: 'Amount', w: 80, align: 'right' as const },
      ];
      let y = doc.y;
      const rowH = 18;
      const drawRow = (cells: string[], bold: boolean, fill?: string) => {
        if (fill) doc.rect(left, y - 2, right - left, rowH).fill(fill).fillColor('#000');
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5).fillColor('#000');
        let x = left;
        cols.forEach((c, i) => { doc.text(cells[i] ?? '', x + 3, y + 3, { width: c.w - 6, align: c.align, lineBreak: false }); x += c.w; });
        y += rowH;
      };
      drawRow(cols.map((c) => c.label), true, '#eef1f6');
      for (const l of data.lines) {
        if (y > doc.page.height - 170) { doc.addPage(); y = doc.page.margins.top; drawRow(cols.map((c) => c.label), true, '#eef1f6'); }
        drawRow([l.head || '-', l.description ?? '', l.allocation ?? '-', money(l.amount)], false);
      }
      drawRow(['', '', 'Total', money(data.totalAmount)], true, '#f6f7f9');
      doc.y = y + 8;
      doc.x = left;
      if (data.narration) { doc.font('Helvetica-Bold').fontSize(9).text('Narration: ', left, doc.y, { continued: true }); doc.font('Helvetica').text(data.narration); }
      if (data.remarks) { doc.font('Helvetica-Bold').fontSize(9).text('Remarks: ', left, doc.y, { continued: true }); doc.font('Helvetica').text(data.remarks); }

      // The three signatures a voucher carries, on one line.
      doc.moveDown(3);
      const sigY = doc.y;
      const w = (right - left) / 3;
      doc.font('Helvetica').fontSize(9).fillColor('#555');
      doc.text('Prepared by: ______________', left, sigY, { width: w, align: 'left' });
      doc.text('Authorised by: ______________', left + w, sigY, { width: w, align: 'center' });
      doc.text('Received by (payee): ______________', left + 2 * w, sigY, { width: w, align: 'right' });
      doc.fillColor('#000');
      doc.x = left;
      doc.moveDown(2);
      doc.font('Helvetica').fontSize(8).fillColor('#777').text('System-generated payment voucher.', left, doc.y, { align: 'center' });
      doc.end();
    });
  }

  /**
   * Payment advice (vendor payment). What was paid to a supplier, how, and
   * against which of their bills — the document a supplier's accounts desk
   * asks for when a credit lands in their bank. A reversed payment says so
   * in red.
   */
  vendorPaymentPdf(data: VendorPaymentPdfData): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 40 });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      const left = doc.page.margins.left;
      const right = doc.page.width - doc.page.margins.right;

      drawCompanyHeader(doc, data, left);
      doc.moveDown(0.3);
      doc.fontSize(14).font('Helvetica-Bold').text('PAYMENT ADVICE', { align: 'right' });
      doc.fontSize(9).font('Helvetica');
      doc.text(`No: ${data.paymentNo}`, { align: 'right' });
      if (data.paymentDate) doc.text(`Date: ${data.paymentDate}`, { align: 'right' });
      doc.text(`Status: ${data.status}`, { align: 'right' });
      doc.moveDown(0.5);
      doc.moveTo(left, doc.y).lineTo(right, doc.y).strokeColor('#cccccc').stroke().strokeColor('#000');
      doc.moveDown(0.5);
      if (data.status === 'reversed') {
        doc.font('Helvetica-Bold').fontSize(12).fillColor('#b91c1c').text('REVERSED — this payment has been withdrawn and the bills below remain payable.');
        doc.fillColor('#000').moveDown(0.5);
      }
      doc.font('Helvetica-Bold').fontSize(10).text('Paid to: ', { continued: true });
      doc.font('Helvetica').text(data.supplierName);
      if (data.supplierGstin) doc.fontSize(9).text(`GSTIN: ${data.supplierGstin}`);
      doc.moveDown(0.5);
      doc.font('Helvetica-Bold').fontSize(13).text(`INR ${money(data.amount)}`);
      doc.font('Helvetica').fontSize(9.5).text(`Amount in words: ${amountInWords(data.amount)}`);
      const bits = [
        data.paymentMode ? `Mode: ${data.paymentMode}` : null,
        data.bankReference ? `Ref: ${data.bankReference}` : null,
      ].filter(Boolean).join('   ');
      if (bits) doc.fontSize(9).text(bits);
      if (data.remarks) doc.fontSize(9).fillColor('#555').text(`Remarks: ${data.remarks}`).fillColor('#000');
      doc.moveDown(0.8);

      if (data.bills.length) {
        doc.font('Helvetica-Bold').fontSize(10).text('Against your bills');
        doc.moveDown(0.2);
        const cols = [
          { key: 'our', label: 'Our bill no', w: 130, align: 'left' as const },
          { key: 'yours', label: 'Your invoice no', w: 150, align: 'left' as const },
          { key: 'date', label: 'Date', w: 100, align: 'left' as const },
          { key: 'amt', label: 'Amount', w: 100, align: 'right' as const },
        ];
        let y = doc.y;
        const rowH = 18;
        const drawRow = (cells: string[], bold: boolean, fill?: string) => {
          if (fill) doc.rect(left, y - 2, cols.reduce((a, c) => a + c.w, 0), rowH).fill(fill).fillColor('#000');
          doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5).fillColor('#000');
          let x = left;
          cols.forEach((c, i) => { doc.text(cells[i] ?? '', x + 3, y + 3, { width: c.w - 6, align: c.align, lineBreak: false }); x += c.w; });
          y += rowH;
        };
        drawRow(cols.map((c) => c.label), true, '#eef1f6');
        for (const b of data.bills) {
          if (y > doc.page.height - 150) { doc.addPage(); y = doc.page.margins.top; drawRow(cols.map((c) => c.label), true, '#eef1f6'); }
          drawRow([b.billNo, b.supplierBillNo ?? '-', b.billDate ?? '-', money(b.amount)], false);
        }
        doc.y = y + 6;
        doc.x = left;
      }
      if (Number(data.unallocatedAmount) > 0) {
        doc.font('Helvetica').fontSize(9.5).text(`Unallocated: INR ${money(data.unallocatedAmount)} — held as an advance against your future bills.`, left, doc.y);
      }

      drawSignatoryBlock(doc, data.companyName, left, right);
      doc.moveDown(1.5);
      doc.font('Helvetica').fontSize(8).fillColor('#777').text('System-generated payment advice.', left, doc.y, { align: 'center' });
      doc.end();
    });
  }
}
