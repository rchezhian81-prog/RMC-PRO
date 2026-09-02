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
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { validateMasterFields, isValidGstin, isValidMobile, validateCompanyProfile, isValidPan, isValidEmail, validateSettingValue, SETTINGS_CATALOG } = require('@rmc/shared');

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
ok('uom-conversion factor 0 flagged (÷0 makes an unusable row)', !!validateMasterFields({ factor: 0 }).factor);
ok('uom-conversion factor negative flagged', !!validateMasterFields({ factor: -2 }).factor);
ok('uom-conversion factor positive accepted', !validateMasterFields({ factor: 2.5 }).factor);

// Company profile validation (the GSTIN prints on every tax invoice).
ok('PAN "ABCDE1234F" accepted', isValidPan('ABCDE1234F'));
ok('PAN "ABC123" rejected', !isValidPan('ABC123'));
ok('email "a@b.com" accepted', isValidEmail('a@b.com'));
ok('email "not-an-email" rejected', !isValidEmail('not-an-email'));
{
  const e = validateCompanyProfile({ gstin: 'BADGSTIN', pan: 'nope', pincode: '12', email: 'x@', phone: '12345' });
  ok('company bad gstin flagged', !!e.gstin);
  ok('company bad pan flagged', !!e.pan);
  ok('company bad pincode flagged', !!e.pincode);
  ok('company bad email flagged', !!e.email);
  ok('company bad phone flagged', !!e.phone);
}
ok('valid company profile has no errors', Object.keys(validateCompanyProfile({ gstin: '33ABCDE1234F1Z5', pan: 'ABCDE1234F', pincode: '600001', email: 'ops@acme.co', phone: '9943602633' })).length === 0);

// Settings catalogue: typed validation, catalogue-only.
ok('settings catalogue is non-empty', Array.isArray(SETTINGS_CATALOG) && SETTINGS_CATALOG.length > 0);
ok('unknown setting key rejected', !!validateSettingValue('made_up_key', 'x'));
ok('number setting rejects text', !!validateSettingValue('default_gst_rate', 'eighteen'));
ok('number setting accepts a number', !validateSettingValue('default_gst_rate', '18'));
ok('boolean setting rejects junk', !!validateSettingValue('low_stock_alerts', 'yes'));
ok('boolean setting accepts true/false', !validateSettingValue('low_stock_alerts', 'false'));
ok('enum setting rejects an off-list value', !!validateSettingValue('credit_block_stage', 'whenever'));
ok('enum setting accepts a listed value', !validateSettingValue('credit_block_stage', 'dispatch'));

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

// Bad: an invalid buyer PIN is rejected per-field.
const badPin = await j('POST', '/customers', { customerCode: 'QA-PIN-' + Date.now(), customerName: 'Pin Co', pincode: '12345' }, tok);
ok('bad pincode rejected with 400', badPin.status === 400);
ok('error.fields.pincode present', !!badPin.body?.error?.fields?.pincode);

// Bad: a malformed PAN is rejected per-field (Tier-4E #26).
const badPan = await j('POST', '/customers', { customerCode: 'QA-PAN-' + Date.now(), customerName: 'Pan Co', pan: 'INVALIDPAN' }, tok);
ok('bad PAN rejected with 400', badPan.status === 400);
ok('error.fields.pan present', !!badPan.body?.error?.fields?.pan);

// Good: accepted, and the buyer PIN + PAN round-trip (KYC / GST BuyerDtls.Pin).
const code = 'QA-OK-' + Date.now();
const good = await j('POST', '/customers', { customerCode: code, customerName: 'Good Co', gstin: '33ABCDE1234F1Z5', pan: 'ABCDE1234F', creditLimit: 5000, creditDays: 30, mobile: '9943602633', pincode: '600002' }, tok);
ok('valid customer created (2xx)', good.status >= 200 && good.status < 300 && good.body?.success === true);
ok('the buyer pincode is persisted + returned', good.body?.data?.pincode === '600002');
ok('the buyer PAN is persisted + returned', good.body?.data?.pan === 'ABCDE1234F');

// Duplicate code → a clear 409 duplicate, not a generic 500 (Postgres 23505 map).
const dup = await j('POST', '/customers', { customerCode: code, customerName: 'Dup Co' }, tok);
ok('duplicate customer code is a 409 conflict, not a 500', dup.status === 409);
ok('duplicate error.code = DUPLICATE_RECORD', dup.body?.error?.code === 'DUPLICATE_RECORD');

// uom-conversions: factor 0 is rejected per-field...
const uomBad = await j('POST', '/uom-conversions', { fromUom: 'QAB', toUom: 'QAK', factor: 0 }, tok);
ok('uom-conversion factor 0 rejected with 400', uomBad.status === 400);
ok('uom-conversion error.fields.factor present', !!uomBad.body?.error?.fields?.factor);

// ...a valid conversion is created, and deactivating it hard-deletes cleanly
// (no 500 from writing a status column the entity does not have).
const uom = await j('POST', '/uom-conversions', { fromUom: 'QA' + Date.now(), toUom: 'QAK', factor: 50 }, tok);
ok('valid uom-conversion created (2xx)', uom.status >= 200 && uom.status < 300);
const del = await j('DELETE', `/uom-conversions/${uom.body?.data?.id}`, null, tok);
ok('uom-conversion deactivate succeeds (no 500)', del.status >= 200 && del.status < 300);

// Company profile: an invalid GSTIN is rejected per-field (it prints on invoices).
const coBad = await j('PATCH', '/company', { gstin: 'INVALIDGSTIN123' }, tok);
ok('invalid company GSTIN rejected with 400', coBad.status === 400);
ok('company error.fields.gstin present', !!coBad.body?.error?.fields?.gstin);

// Reactivate: a deactivated master can be flipped back to active.
const made = await j('POST', '/customers', { customerCode: 'QA-RC-' + Date.now(), customerName: 'Reactivate Co' }, tok);
const rid = made.body?.data?.id;
await j('DELETE', `/customers/${rid}`, null, tok);
const afterDel = await j('GET', `/customers/${rid}`, null, tok);
ok('customer is inactive after deactivate', afterDel.body?.data?.status === 'inactive');
const react = await j('PATCH', `/customers/${rid}/reactivate`, null, tok);
ok('reactivate succeeds (2xx)', react.status >= 200 && react.status < 300);
ok('customer is active again after reactivate', react.body?.data?.status === 'active');

// Settings: the catalogue drives the list, and writes are typed + catalogue-only.
const setList = await j('GET', '/settings', null, tok);
ok('settings list returns the catalogue', Array.isArray(setList.body?.data) && setList.body.data.some((s) => s.key === 'default_gst_rate'));
const setOk = await j('PUT', '/settings/default_gst_rate', { value: '18' }, tok);
ok('valid setting write accepted (2xx)', setOk.status >= 200 && setOk.status < 300);
const setBadNum = await j('PUT', '/settings/default_gst_rate', { value: 'eighteen' }, tok);
ok('non-numeric setting write rejected with 400', setBadNum.status === 400);
const setUnknown = await j('PUT', '/settings/not_a_real_setting', { value: 'x' }, tok);
ok('unknown setting key rejected with 400', setUnknown.status === 400);

// --- C. A tenant role cannot be granted a platform.* permission (Tier-4 #23) ---
console.log('\n=== C. platform-permission escalation guard ===');
const roleName = 'QA Escalation ' + Date.now();
const role = (await j('POST', '/roles', { roleKey: 'qa_esc_' + Date.now(), roleName }, tok)).body?.data;
ok('a tenant role can be created', !!role?.id);
const catalog = (await j('GET', '/roles/permissions-catalog', null, tok)).body?.data ?? [];
const platformPerm = catalog.find((p) => String(p.permissionKey).startsWith('platform.'));
const tenantPerm = catalog.find((p) => !String(p.permissionKey).startsWith('platform.'));
ok('the permission catalog exposes a platform.* permission', !!platformPerm);
const withPlatform = await j('PUT', `/roles/${role.id}/permissions`, { permissionIds: [platformPerm.id] }, tok);
ok('assigning a platform.* permission to a tenant role is rejected (400)', withPlatform.status === 400);
const withTenant = await j('PUT', `/roles/${role.id}/permissions`, { permissionIds: [tenantPerm.id] }, tok);
ok('assigning an ordinary tenant permission still succeeds', withTenant.status >= 200 && withTenant.status < 300);

// --- C2. A non-owner cannot grant the company-owner role (Tier-2A: self-escalation) ---
console.log('\n=== C2. owner-role escalation guard ===');
const umPerm = catalog.find((p) => p.permissionKey === 'users.manage');
ok('the permission catalog exposes users.manage', !!umPerm);
const adminRole = (await j('POST', '/roles', { roleKey: 'qa_admin_' + Date.now(), roleName: 'QA Admin ' + Date.now() }, tok)).body?.data;
await j('PUT', `/roles/${adminRole.id}/permissions`, { permissionIds: [umPerm.id] }, tok);
const adminEmail = `qa-admin-${Date.now()}@example.com`;
// Password must not start with a common word (policy), so avoid admin/owner/user prefixes.
const adminPw = 'Zulu9#Mango!42';
const adminUser = (await j('POST', '/users', { name: 'QA Admin', email: adminEmail, password: adminPw, roleId: adminRole.id }, tok)).body?.data;
ok('a users.manage admin can be created', !!adminUser?.id);
const adminTok = (await j('POST', '/auth/login', { login: adminEmail, password: adminPw })).body?.data?.access_token;
ok('the admin can log in', !!adminTok);
const roles = (await j('GET', '/roles', null, tok)).body?.data ?? [];
const ownerRole = roles.find((r) => (r.roleKey ?? r.role_key) === 'company_owner');
ok('the seeded company_owner role is present', !!ownerRole?.id);
// The admin holds users.manage, so the request reaches the service — and the new
// guard rejects promoting anyone (here, themselves) to company_owner.
const grantViaUpdate = await j('PATCH', `/users/${adminUser.id}`, { roleId: ownerRole.id }, adminTok);
ok('a non-owner cannot promote to company_owner via update', grantViaUpdate.status === 400 || grantViaUpdate.status === 403);
const grantViaCreate = await j('POST', '/users', { name: 'QA Owner2', email: `qa-owner2-${Date.now()}@example.com`, password: 'Yankee7#Delta!9', roleId: ownerRole.id }, adminTok);
ok('a non-owner cannot mint a new company_owner via create', grantViaCreate.status === 400 || grantViaCreate.status === 403);

// --- D. Audit coverage (Tier-4B #21/#22) ---
console.log('\n=== D. audit coverage ===');
const roleAudit = (await j('GET', '/audit-logs?action=role.permission_change', null, tok)).body?.data ?? [];
ok('a role permission change is written to the audit trail', Array.isArray(roleAudit) && roleAudit.length >= 1);
const roleCreateAudit = (await j('GET', '/audit-logs?action=role.create', null, tok)).body?.data ?? [];
ok('a role creation is written to the audit trail', roleCreateAudit.length >= 1);

await j('PATCH', '/company', { companyName: 'QA Co ' + Date.now() }, tok);
const coAudit = (await j('GET', '/audit-logs?action=company.update', null, tok)).body?.data ?? [];
ok('a company profile update is written to the audit trail', coAudit.length >= 1);

const settingsList = (await j('GET', '/settings', null, tok)).body?.data ?? [];
const aSetting = settingsList[0];
if (aSetting) {
  await j('PUT', `/settings/${aSetting.key}`, { value: String(aSetting.value ?? aSetting.default ?? '') }, tok);
  const setAudit = (await j('GET', '/audit-logs?action=setting.change', null, tok)).body?.data ?? [];
  ok('a settings change is written to the audit trail', setAudit.length >= 1);
}

// Master mutations are audited (Tier-4F): the `good` customer create above, and a
// credit-limit change now leave a trail.
const masterCreate = (await j('GET', '/audit-logs?action=master.create', null, tok)).body?.data ?? [];
ok('a master create is written to the audit trail', masterCreate.length >= 1);
await j('PATCH', `/customers/${good.body.data.id}`, { creditLimit: 99999 }, tok);
const masterUpdate = (await j('GET', '/audit-logs?action=master.update', null, tok)).body?.data ?? [];
ok('a master update (credit-limit change) is written to the audit trail', masterUpdate.length >= 1);

// Pick-list filter (Tier-4G): ?active=true excludes a deactivated master, while
// the management list still shows it (so it can be reactivated).
const plCust = await j('POST', '/customers', { customerCode: 'PL-' + Date.now(), customerName: 'Picklist Co' }, tok);
const plId = plCust.body.data.id;
await j('DELETE', `/customers/${plId}`, null, tok);
const allC = (await j('GET', '/customers', null, tok)).body?.data ?? [];
const activeC = (await j('GET', '/customers?active=true', null, tok)).body?.data ?? [];
ok('the management list includes the deactivated master', allC.some((c) => c.id === plId));
ok('the active-only pick-list excludes the deactivated master', !activeC.some((c) => c.id === plId));

console.log(`\nMASTER VALIDATION TEST: ${pass} passed`);
process.exit(0);
