/**
 * Read the text back out of a pdfkit document so a test can assert on what a
 * person would see. pdfkit deflates its content streams and writes each text
 * run as hex glyph strings inside `[<..> kern <..>] TJ` (or, for a run with
 * no kerning, `<..> Tj`); inflate, decode the hex, drop the kerning numbers,
 * and each run comes back as the string it was drawn from — one per line.
 * Literal `(..) Tj` strings are read too, for completeness.
 *
 * `pdfTextReport` says what the reader saw — stream count, which streams
 * would not inflate, the first runs — for the failure message when an
 * expected string is missing; a bare "not found" was undiagnosable the one
 * time CI produced it.
 */
import { inflateSync } from 'node:zlib';

/**
 * Every stream, sliced by the /Length its dictionary declares. The old
 * `stream…\r?\nendstream` regex cut one byte off any compressed stream whose
 * last byte happened to be a carriage return — about one stream in 256, so a
 * random document in a random CI run lost its text and a phrase "was not on
 * the PDF" (seen three times). Binary data has no shape a regex can trust;
 * the length does.
 */
function streams(buf) {
  const src = buf.toString('latin1');
  const out = [];
  const re = /<<([\s\S]*?)>>\s*stream\r?\n/g;
  let m;
  while ((m = re.exec(src))) {
    const lengths = [...m[1].matchAll(/\/Length\s+(\d+)/g)];
    const start = m.index + m[0].length;
    let data;
    if (lengths.length) {
      data = src.slice(start, start + Number(lengths[lengths.length - 1][1]));
    } else {
      const end = src.indexOf('endstream', start);
      data = src.slice(start, end < 0 ? undefined : end).replace(/\r?\n$/, '');
    }
    // Binary stream data can contain "<<"; resume the search after it.
    re.lastIndex = start + data.length;
    try { out.push({ ok: true, content: inflateSync(Buffer.from(data, 'latin1')).toString('latin1') }); }
    catch (e) { out.push({ ok: false, content: data, error: String(e?.message ?? e).slice(0, 60) }); }
  }
  return out;
}

function runsOf(content) {
  const lines = [];
  for (const [, arr] of content.matchAll(/\[([^\]]*)\]\s*TJ/g)) {
    lines.push(Buffer.from([...arr.matchAll(/<([0-9a-fA-F]*)>/g)].map((h) => h[1]).join(''), 'hex').toString('latin1'));
  }
  for (const [, hex] of content.matchAll(/<([0-9a-fA-F]+)>\s*Tj/g)) lines.push(Buffer.from(hex, 'hex').toString('latin1'));
  for (const [, lit] of content.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)) lines.push(lit.replace(/\\([()\\])/g, '$1'));
  return lines;
}

export function pdfText(buf) {
  return streams(buf).flatMap((s) => runsOf(s.content)).join('\n');
}

/** A one-line account of what the reader found, for a failure message. */
export function pdfTextReport(buf) {
  const ss = streams(buf);
  const bad = ss.filter((s) => !s.ok);
  const runs = ss.flatMap((s) => runsOf(s.content));
  return `${buf.length} bytes, ${ss.length} stream(s), ${bad.length} would not inflate${bad.length ? ` (${bad.map((b) => b.error).join('; ')})` : ''}, ${runs.length} text run(s)` +
    (runs.length ? `; first: ${JSON.stringify(runs.slice(0, 4))}` : `; head: ${JSON.stringify(buf.subarray(0, 40).toString('latin1'))}`);
}
