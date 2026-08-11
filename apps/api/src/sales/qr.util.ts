import qrcode from 'qrcode-generator';

/**
 * Build the QR module matrix for `text` — a boolean grid where `true` is a dark
 * module. Pure and deterministic: the PDF renderer draws it as pdfkit rectangles,
 * so we depend only on a tiny, zero-dependency encoder (no image/canvas/native
 * bits), matching the "pure JS, no native deps" invoice pipeline.
 *
 * `ec` is the error-correction level; 'M' balances scan robustness against
 * capacity, which comfortably fits an e-invoice signed-QR JWT. Byte mode (the
 * default) handles the base64url + '.' JWT alphabet. Throws only if the data
 * cannot fit even a version-40 symbol — the caller degrades gracefully.
 */
export function qrMatrix(text: string, ec: 'L' | 'M' | 'Q' | 'H' = 'M'): boolean[][] {
  const qr = qrcode(0, ec); // type 0 → auto-fit the smallest version that holds the data
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const matrix: boolean[][] = [];
  for (let row = 0; row < n; row++) {
    const cells: boolean[] = [];
    for (let col = 0; col < n; col++) cells.push(qr.isDark(row, col));
    matrix.push(cells);
  }
  return matrix;
}
