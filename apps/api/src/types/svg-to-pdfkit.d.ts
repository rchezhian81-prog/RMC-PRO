/**
 * Minimal typing for `svg-to-pdfkit`, which ships no declarations. It exposes a
 * single function that draws an SVG string into a pdfkit document at (x, y).
 */
declare module 'svg-to-pdfkit' {
  interface SVGtoPDFOptions {
    width?: number;
    height?: number;
    preserveAspectRatio?: string;
    assumePt?: boolean;
    [key: string]: unknown;
  }
  function SVGtoPDF(
    doc: PDFKit.PDFDocument,
    svg: string,
    x?: number,
    y?: number,
    options?: SVGtoPDFOptions,
  ): void;
  export default SVGtoPDF;
}
