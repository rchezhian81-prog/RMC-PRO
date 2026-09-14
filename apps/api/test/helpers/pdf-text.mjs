/**
 * Read the text back out of a pdfkit document so a test can assert on what a
 * person would see. pdfkit deflates its content streams and writes each text
 * run as hex glyph strings inside `[<..> kern <..>] TJ`; inflate, decode the
 * hex, drop the kerning numbers, and each run comes back as the string it was
 * drawn from — one per line.
 */
import { inflateSync } from 'node:zlib';

export function pdfText(buf) {
  const src = buf.toString('latin1');
  const lines = [];
  const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m;
  while ((m = re.exec(src))) {
    let content;
    try { content = inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1'); } catch { content = m[1]; }
    for (const [, arr] of content.matchAll(/\[([^\]]*)\]\s*TJ/g)) {
      lines.push(Buffer.from([...arr.matchAll(/<([0-9a-fA-F]*)>/g)].map((h) => h[1]).join(''), 'hex').toString('latin1'));
    }
  }
  return lines.join('\n');
}
