/**
 * Flag-OFF ↔ V2 functional-parity diff (evidence-closure item 2).
 * Compares the per-route functional fingerprints captured by evidence.spec in
 * each skin. The fingerprint is skin-independent (headings, actions, links,
 * inputs, table columns, nav) — so any difference is a FUNCTIONAL difference,
 * which must be zero. Visual/style differences never appear here by construction.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const DIR = path.resolve('visual/.manifest');
const V2 = path.join(DIR, 'v2');
const OFF = path.join(DIR, 'off');
if (!existsSync(V2) || !existsSync(OFF)) {
  console.error('missing manifest dir(s):', existsSync(V2) ? '' : V2, existsSync(OFF) ? '' : OFF);
  process.exit(2);
}

// React useId() emits non-functional, render-order-dependent ids (`_r_2_`,
// `:r5:`). They are not part of a route's function, so normalize them to a
// constant before comparing — otherwise a 1-off counter shift (e.g. one extra
// useId in the shell) reads as a false "difference".
const stripIds = (v) =>
  typeof v === 'string' ? v.replace(/^_r_[0-9a-z]+_$/i, '#id').replace(/^:r[0-9a-z]+:$/i, '#id') : v;
const norm = (o) => JSON.stringify(Array.isArray(o) ? o.map(stripIds) : o);
const names = readdirSync(V2).filter((f) => f.endsWith('.json'));
let diffs = 0;
const report = [];
for (const f of names) {
  const v2 = JSON.parse(readFileSync(path.join(V2, f), 'utf8'));
  const offP = path.join(OFF, f);
  if (!existsSync(offP)) { report.push([f, 'MISSING in OFF']); diffs++; continue; }
  const off = JSON.parse(readFileSync(offP, 'utf8'));
  const fields = ['title', 'headings', 'buttons', 'links', 'inputs', 'tableCols', 'navItems'];
  const changed = fields.filter((k) => norm(v2[k]) !== norm(off[k]));
  if (changed.length) { diffs++; report.push([f, 'DIFF: ' + changed.join(',')]); }
}
console.log(`routes compared: ${names.length}`);
console.log(`functional differences: ${diffs}`);
for (const [f, msg] of report) console.log('  ', f.replace('.json', ''), '→', msg);
console.log(diffs === 0
  ? '\n✅ FUNCTIONAL PARITY: flag-OFF and V2 are identical in routes, information, actions, inputs, tables and nav.'
  : `\n❌ ${diffs} route(s) differ functionally — investigate above.`);
process.exit(diffs === 0 ? 0 : 1);
