import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';

export interface QuotationPdfItem {
  gradeLabel: string;
  estimatedQuantity: string | number;
  ratePerM3: string | number;
  transportCharge: string | number;
  pumpCharge: string | number;
  waitingCharge: string | number;
  gstApplicable: boolean;
}

export interface QuotationPdfData {
  companyName: string;
  companyGstin?: string | null;
  companyState?: string | null;
  quotationNo: string;
  quotationDate?: string | null;
  validUntil?: string | null;
  revisionNo: number;
  approvalStatus: string;
  customerName: string;
  siteName?: string | null;
  paymentTerms?: string | null;
  remarks?: string | null;
  items: QuotationPdfItem[];
}

export interface ChallanPdfData {
  companyName: string;
  companyGstin?: string | null;
  companyState?: string | null;
  challanNo: string;
  challanStatus: string;
  dispatchTime?: string | null;
  customerName: string;
  siteName?: string | null;
  vehicleNo?: string | null;
  driverName?: string | null;
  gradeLabel: string;
  quantityM3: string | number;
  slump?: string | null;
  receiverName?: string | null;
}

export interface WeighbridgePdfData {
  companyName: string;
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
export interface InvoicePdfData {
  companyName: string;
  companyGstin?: string | null;
  companyState?: string | null;
  invoiceNo: string;
  invoiceDate?: string | null;
  dueDate?: string | null;
  invoiceStatus: string;
  customerName: string;
  customerGstin?: string | null;
  placeOfSupply?: string | null;
  isInterstate: boolean;
  items: InvoicePdfItem[];
  taxableAmount: string | number;
  cgstAmount: string | number;
  sgstAmount: string | number;
  igstAmount: string | number;
  cessAmount: string | number;
  roundOff: string | number;
  totalAmount: string | number;
}

const money = (v: string | number): string =>
  Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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
      doc.fontSize(18).font('Helvetica-Bold').text(data.companyName, { align: 'left' });
      doc.fontSize(9).font('Helvetica').fillColor('#555');
      if (data.companyGstin) doc.text(`GSTIN: ${data.companyGstin}`);
      if (data.companyState) doc.text(`State: ${data.companyState}`);
      doc.fillColor('#000');

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

      doc.fontSize(18).font('Helvetica-Bold').text(data.companyName);
      doc.fontSize(9).font('Helvetica').fillColor('#555');
      if (data.companyGstin) doc.text(`GSTIN: ${data.companyGstin}`);
      if (data.companyState) doc.text(`State: ${data.companyState}`);
      doc.fillColor('#000');

      doc.moveDown(0.4);
      doc.fontSize(15).font('Helvetica-Bold').text('DELIVERY CHALLAN', { align: 'right' });
      doc.fontSize(9).font('Helvetica');
      doc.text(`No: ${data.challanNo}`, { align: 'right' });
      doc.text(`Status: ${data.challanStatus}`, { align: 'right' });
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
      row('Vehicle', data.vehicleNo ?? '-');
      row('Driver', data.driverName ?? '-');
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
      doc.font('Helvetica').fontSize(9).fillColor('#555').text('Receiver signature: ____________________', { align: 'right' });
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

      doc.fontSize(18).font('Helvetica-Bold').text(data.companyName);
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

      doc.fontSize(17).font('Helvetica-Bold').text(data.companyName);
      doc.fontSize(9).font('Helvetica').fillColor('#555');
      if (data.companyGstin) doc.text(`GSTIN: ${data.companyGstin}`);
      if (data.companyState) doc.text(`State: ${data.companyState}`);
      doc.fillColor('#000');

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
      if (data.customerGstin) doc.font('Helvetica').fontSize(9).text(`GSTIN: ${data.customerGstin}`);
      doc.fontSize(9).text(`Place of supply: ${data.placeOfSupply ?? '-'} (${data.isInterstate ? 'Inter-state / IGST' : 'Intra-state / CGST+SGST'})`);
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

      doc.moveDown(1.5);
      doc.fontSize(8).fillColor('#777').text('System-generated tax invoice.', { align: 'center' });
      doc.end();
    });
  }
}
