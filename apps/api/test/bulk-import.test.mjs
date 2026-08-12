/**
 * Bulk import framework integration test (Plan F1).
 *
 * Proves the template → upload → tracked-job flow end to end:
 *   - the definitions list the importable masters
 *   - the CSV template downloads with the field-key header row
 *   - a customers upload with 2 valid + 1 invalid row creates the 2 customers,
 *     tallies success / error counts, and reports the bad row number
 *   - re-uploading the same file fails every row (unique code) — same validation
 *     as hand entry
 *   - the job is stored and listed
 *
 * Env (provided by run-integration.mjs): API_BASE, LOGIN, RMC_PASSWORD.
 */
const API_BASE = process.env.API_BASE || 'http://localhost:4000/api/v1';
const LOGIN = process.env.LOGIN;
const PASSWORD = process.env.RMC_PASSWORD;

let pass = 0;
const ok = (name, cond) => { console.log((cond ? '  PASS ' : '  FAIL ') + name); if (!cond) throw new Error('FAIL: ' + name); pass++; };

let TOKEN = '';
async function api(method, path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.success) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(data)}`);
  return data.data;
}

if (!LOGIN || !PASSWORD) {
  console.log('(skipping bulk-import — LOGIN/RMC_PASSWORD not set)');
  process.exit(0);
}

console.log('=== bulk import (definitions → template → upload → tracked job) ===');

TOKEN = (await api('POST', '/auth/login', { login: LOGIN, password: PASSWORD })).access_token;

// ---- A. Definitions ----
const defs = await api('GET', '/imports/definitions');
const keys = (Array.isArray(defs) ? defs : []).map((d) => d.key).sort();
ok('definitions list customers, materials, suppliers', JSON.stringify(keys) === JSON.stringify(['customers', 'materials', 'suppliers']));

// ---- B. Template downloads as raw CSV with the field-key header ----
const tplRes = await fetch(`${API_BASE}/imports/customers/template`, { headers: { Authorization: `Bearer ${TOKEN}` } });
const tplText = await tplRes.text();
ok('template served as CSV', tplRes.ok && (tplRes.headers.get('content-type') || '').includes('text/csv'));
ok('template header has the customer field keys', tplText.split('\n')[0].startsWith('customerCode,customerName,'));

// ---- C. Upload 2 valid + 1 invalid (missing name) ----
const sfx = String(Date.now()).slice(-6);
const header = 'customerCode,customerName,gstin,city,state,mobile,creditLimit';
const content = [
  header,
  `BULK-${sfx}-1,Alpha Traders,,Chennai,Tamil Nadu,,500000`,
  `BULK-${sfx}-2,Beta Corp,,Madurai,Tamil Nadu,,0`,
  `BULK-${sfx}-3,,,,,,`, // missing customerName → required error (row 4)
].join('\n') + '\n';

const job = await api('POST', '/imports/customers', { content, fileName: 'customers.csv' });
ok('job counts 3 total rows', job.totalRows === 3);
ok('two rows imported', job.successCount === 2);
ok('one row failed', job.errorCount === 1);
ok('the failed row is reported by (1-based) line number', Array.isArray(job.errors) && job.errors[0].row === 4);

// ---- D. The two customers actually exist ----
const customers = await api('GET', '/customers');
const codes = new Set((Array.isArray(customers) ? customers : []).map((c) => c.customerCode));
ok('imported customer 1 exists', codes.has(`BULK-${sfx}-1`));
ok('imported customer 2 exists', codes.has(`BULK-${sfx}-2`));

// ---- E. Re-uploading the same file fails every row (unique code + missing name) ----
const rerun = await api('POST', '/imports/customers', { content, fileName: 'customers.csv' });
ok('re-import creates no duplicates', rerun.successCount === 0);
ok('re-import fails all three rows', rerun.errorCount === 3);
ok('duplicate error is human-readable', rerun.errors.some((e) => /already exists/i.test(e.message)));

// ---- F. Jobs are listed ----
const jobs = await api('GET', '/imports');
ok('import jobs are listed', Array.isArray(jobs) && jobs.length >= 2);

console.log(`\nBULK IMPORT TEST: ${pass} passed ✓`);
process.exit(0);
