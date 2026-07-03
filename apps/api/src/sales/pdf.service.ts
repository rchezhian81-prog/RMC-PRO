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
}
