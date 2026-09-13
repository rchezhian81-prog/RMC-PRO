#!/usr/bin/env node
/**
 * RMC Plant SaaS — do your saved states resolve to a GST state? (READ-ONLY)
 *
 * WHY THIS EXISTS: a record's state decides whether a bill is taxed CGST + SGST
 * or IGST. Until the state became a picker, it was free text — so a company
 * saved as "TN" and a customer saved as "Tamil Nadu" were the SAME state, but
 * the classifier could not tell, and every local sale went out as IGST: wrong
 * heads on the invoice, a wrong GSTR-1, and a buyer who cannot match the credit.
 *
 * That resolution is fixed, and both spellings now work. This script answers the
 * question the fix cannot: does any state ALREADY in your database still fail to
 * resolve — a typo, a blank, something pasted from a spreadsheet — and is your
 * company's own state one of them?
 *
 * READ-ONLY: one POST to /auth/login for a token; everything else is a GET. It
 * changes nothing and prints no password.
 *
 * Usage, on the VPS:
 *   LOGIN='owner@example.com' RMC_PASSWORD='…' node scripts/ops/check-gst-states.mjs
 *
 * Env: DOMAIN (default mixnovas.com) or API (full base URL); LOGIN, RMC_PASSWORD.
 * Exit code 0 when everything resolves, 1 when something needs your attention.
 */
/**
 * The state table is INLINE, not imported, so this runs on a VPS from a plain
 * checkout with nothing built. `packages/shared/test/unit/gst-states.test.mjs`
 * asserts this copy matches the shared list exactly, so the two cannot drift.
 */
const STATE_CODES = {
  'jammu and kashmir': '01', 'himachal pradesh': '02', punjab: '03', chandigarh: '04',
  uttarakhand: '05', uttaranchal: '05', haryana: '06', delhi: '07', 'new delhi': '07',
  'nct of delhi': '07', rajasthan: '08', 'uttar pradesh': '09', bihar: '10', sikkim: '11',
  'arunachal pradesh': '12', nagaland: '13', manipur: '14', mizoram: '15', tripura: '16',
  meghalaya: '17', assam: '18', 'west bengal': '19', jharkhand: '20', odisha: '21',
  orissa: '21', chhattisgarh: '22', chattisgarh: '22', 'madhya pradesh': '23', gujarat: '24',
  'daman and diu': '26', 'dadra and nagar haveli': '26',
  'dadra and nagar haveli and daman and diu': '26', maharashtra: '27', karnataka: '29',
  goa: '30', lakshadweep: '31', kerala: '32', 'tamil nadu': '33', tamilnadu: '33',
  puducherry: '34', pondicherry: '34', 'andaman and nicobar islands': '35',
  'andaman and nicobar': '35', telangana: '36', 'andhra pradesh': '37', ladakh: '38',
  'other territory': '97',
  jk: '01', hp: '02', pb: '03', ch: '04', uk: '05', ua: '05', hr: '06', dl: '07',
  rj: '08', up: '09', br: '10', sk: '11', ar: '12', nl: '13', mn: '14', mz: '15',
  tr: '16', ml: '17', as: '18', wb: '19', jh: '20', od: '21', or: '21', cg: '22',
  ct: '22', mp: '23', gj: '24', dd: '26', dn: '26', mh: '27', ka: '29', ga: '30',
  ld: '31', kl: '32', tn: '33', py: '34', pd: '34', an: '35', ts: '36', tg: '36',
  ap: '37', la: '38', ot: '97',
};
const VALID_CODES = new Set(Object.values(STATE_CODES));

function resolveGstStateCode(value) {
  const v = String(value ?? '').trim();
  if (!v) return '';
  if (/^\d{2}$/.test(v)) return VALID_CODES.has(v) ? v : '';
  return STATE_CODES[v.toLowerCase().replace(/&/g, 'and').replace(/\s+/g, ' ')] ?? '';
}

const DOMAIN = process.env.DOMAIN ?? 'mixnovas.com';
const API = process.env.API ?? `https://api.${DOMAIN}/api/v1`;
const LOGIN = process.env.LOGIN ?? process.env.RMC_LOGIN ?? '';
const PASSWORD = process.env.RMC_PASSWORD ?? '';

if (!LOGIN || !PASSWORD) {
  console.error('Set LOGIN and RMC_PASSWORD. The password is read from the environment only.');
  process.exit(2);
}

const res = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ login: LOGIN, password: PASSWORD }),
}).catch((e) => ({ ok: false, error: e }));
const login = res.ok ? await res.json() : null;
const token = login?.data?.access_token;
if (!token) {
  console.error(`Sign-in failed (HTTP ${res.status ?? '?'}). Check LOGIN / RMC_PASSWORD and that ${API} is reachable.`);
  process.exit(2);
}
const get = async (p) => {
  const r = await fetch(`${API}${p}`, { headers: { authorization: `Bearer ${token}` } });
  const j = await r.json().catch(() => null);
  return j?.success ? j.data : null;
};

let problems = 0;
const report = (what, rows, nameKey) => {
  const bad = rows.filter((r) => !resolveGstStateCode(r.state));
  const blank = bad.filter((r) => !String(r.state ?? '').trim());
  const wrong = bad.filter((r) => String(r.state ?? '').trim());
  console.log(`\n${what}: ${rows.length} record(s)`);
  if (!bad.length) {
    console.log('  ✓ every state resolves to a GST state');
    return;
  }
  if (wrong.length) {
    problems += wrong.length;
    console.log(`  ✗ ${wrong.length} with a state that resolves to NOTHING — these will be taxed on a name guess:`);
    for (const r of wrong.slice(0, 20)) console.log(`      ${String(r[nameKey] ?? r.id)}  ->  "${r.state}"`);
    if (wrong.length > 20) console.log(`      … and ${wrong.length - 20} more`);
  }
  if (blank.length) {
    console.log(`  · ${blank.length} with no state recorded (treated as a local supply)`);
  }
};

console.log(`Checking saved states against the GST list — ${API}`);

// The company's own state is the seller side of EVERY classification, so it
// matters more than any single customer.
const company = await get('/company');
const companyState = company?.state ?? '';
const companyCode = resolveGstStateCode(companyState);
console.log(`\nYour company: "${companyState || '(not set)'}"`);
if (companyCode) {
  console.log(`  ✓ resolves to GST state code ${companyCode}`);
} else {
  problems++;
  console.log('  ✗ does NOT resolve to a GST state.');
  console.log('    Every sale is classified against this value. Set it from the state list in');
  console.log('    Settings → Company before issuing invoices.');
}

for (const [label, path, nameKey] of [
  ['Customers', '/customers?limit=1000', 'customerName'],
  ['Sites', '/sites?limit=1000', 'siteName'],
  ['Suppliers', '/suppliers?limit=1000', 'supplierName'],
]) {
  const rows = await get(path);
  if (!Array.isArray(rows)) {
    console.log(`\n${label}: could not read (permission, or the module is off) — skipped`);
    continue;
  }
  report(label, rows, nameKey);
}

console.log('');
if (problems) {
  console.log(`${problems} record(s) need a state you can pick from the list. Open each one and`);
  console.log('choose its state; nothing else has to change.');
  process.exit(1);
}
console.log('Every state resolves. CGST/SGST vs IGST will be decided correctly.');
process.exit(0);
