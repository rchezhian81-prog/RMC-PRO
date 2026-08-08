/**
 * Tests for master-data validation (QA #2).
 *   Part A: unit — the shared validators (no DB).
 *   Part B: integration — POST /customers through the real API, asserting a
 *           structured 400 with per-field errors for bad input and success for
 *           good input.
 *
 * Env for Part B: API_BASE (default http://localhost:4000/api/v1),
 *                 LOGIN, RMC_PASSWORD (a tenant owner).
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { validateMasterFields, isValidGstin, isValidMobile } = require('@rmc/shared');

let pass = 0;
const ok = (name, cond) => { console.log((cond ? '  PASS ' : '  FAIL ') + name); if (!cond) throw new Error('FAIL: ' + name); pass++; };

console.log('=== A. shared validators (unit) ===');
ok('rejects GSTIN "INVALIDGSTIN123"', !isValidGstin('INVALIDGSTIN123'));
ok('accepts a real GSTIN', isValidGstin('33ABCDE1234F1Z5'));
ok('rejects mobile "12345"', !isValidMobile('12345'));
ok('accepts mobile "9943602633"', isValidMobile('9943602633'));
{
  const e = validateMasterFields({ gstin: 'INVALIDGSTIN123', creditLimit: -5000, creditDays: -1, mobile: '12345' });
  ok('invalid customer flags gstin', !!e.gstin);
  ok('invalid customer flags creditLimit (negative)', !!e.creditLimit);
  ok('invalid customer flags creditDays (negative)', !!e.creditDays);
  ok('invalid customer flags mobile', !!e.mobile);
}
ok('valid customer has no field errors', Object.keys(validateMasterFields({ gstin: '33ABCDE1234F1Z5', creditLimit: 5000, creditDays: 30, mobile: '9943602633' })).length === 0);
ok('vehicle negative capacity flagged', !!validateMasterFields({ capacityM3: -3 }).capacityM3);

const LOGIN = process.env.LOGIN, PASSWORD = process.env.RMC_PASSWORD;
const API_BASE = process.env.API_BASE || 'http://localhost:4000/api/v1';
if (!LOGIN || !PASSWORD) {
  console.log('\n(skipping Part B integration — LOGIN/RMC_PASSWORD not set)');
  console.log(`\nMASTER VALIDATION TEST: ${pass} passed (unit only)`);
  process.exit(0);
}

console.log('\n=== B. POST /customers through the API (integration) ===');
const j = async (m, p, b, t) => {
  const r = await fetch(`${API_BASE}${p}`, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) }, body: b ? JSON.stringify(b) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const login = await j('POST', '/auth/login', { login: LOGIN, password: PASSWORD });
const tok = login.body.data.access_token;

// Bad: the exact QA payload.
const bad = await j('POST', '/customers', { customerCode: 'QA-BAD', customerName: 'Bad Co', gstin: 'INVALIDGSTIN123', creditLimit: -5000 }, tok);
ok('bad customer rejected with 400', bad.status === 400);
ok('envelope success=false', bad.body?.success === false);
ok('error.code = VALIDATION_ERROR', bad.body?.error?.code === 'VALIDATION_ERROR');
ok('error.fields.gstin present', !!bad.body?.error?.fields?.gstin);
ok('error.fields.creditLimit present', !!bad.body?.error?.fields?.creditLimit);

// Good: accepted.
const code = 'QA-OK-' + Date.now();
const good = await j('POST', '/customers', { customerCode: code, customerName: 'Good Co', gstin: '33ABCDE1234F1Z5', creditLimit: 5000, creditDays: 30, mobile: '9943602633' }, tok);
ok('valid customer created (2xx)', good.status >= 200 && good.status < 300 && good.body?.success === true);

console.log(`\nMASTER VALIDATION TEST: ${pass} passed`);
process.exit(0);
