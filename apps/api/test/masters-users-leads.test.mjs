/**
 * Masters, users and leads — the pilot gap batch end to end:
 *   - a customer or site saved without a code is numbered from Number Series
 *     (CUST-0001 / SITE-0001) and a typed code still wins; the name stays required
 *   - the new vehicle fields (owner, model, service due) and supplier fields
 *     (address, city, category, supplies, alternate mobile) round-trip, a lapsed
 *     service shows with the fleet papers alert, and a bad alternate mobile is refused
 *   - a user created without an employee code gets EMP-0001; the profile fields
 *     round-trip; a photo and an ID proof are stored, served as bytes, never
 *     carried by the list, readable by the person themselves, and removable;
 *     an SVG photo and a duplicate code are refused
 *   - a lead carries its marketing person's name; Create customer makes the
 *     customer and the site under Masters once, and refuses a second time
 *
 * Runs on a tenant of its own (provisioned through the platform API), so the
 * leads and the lead series it creates never touch the pilot tenant that
 * numbering-concurrency rebuilds from scratch.
 *
 * Env (provided by run-integration.mjs): API_BASE, SUPERADMIN_EMAIL, SUPERADMIN_PASSWORD.
 */
const API_BASE = process.env.API_BASE || 'http://localhost:4000/api/v1';
const SU_LOGIN = process.env.SUPERADMIN_EMAIL;
const SU_PASSWORD = process.env.SUPERADMIN_PASSWORD;

let pass = 0;
const ok = (name, cond) => { console.log((cond ? '  PASS ' : '  FAIL ') + name); if (!cond) throw new Error('FAIL: ' + name); pass++; };

let TOKEN = '';
async function call(method, path, body, token = TOKEN) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}
async function api(method, path, body, token) {
  const r = await call(method, path, body, token);
  if (r.status >= 400 || !r.data?.success) throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(r.data)}`);
  return r.data.data;
}
/** A binary route: status, content type and the raw bytes. */
async function bytes(path, token = TOKEN) {
  const res = await fetch(`${API_BASE}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  return { status: res.status, type: res.headers.get('content-type') ?? '', buf: Buffer.from(await res.arrayBuffer()) };
}
const SFX = Date.now().toString(36).slice(-6).toUpperCase();
const ymd = (d) => d.toISOString().slice(0, 10);
const yesterday = ymd(new Date(Date.now() - 86_400_000));

if (!SU_LOGIN || !SU_PASSWORD) {
  console.log('(skipping masters-users-leads — SUPERADMIN creds not set)');
  process.exit(0);
}

console.log('=== masters, users and leads: auto codes, new fields, files, create customer ===');

// ---- own tenant on the seeded plan, with its own owner ----
const su = (await api('POST', '/auth/login', { login: SU_LOGIN, password: SU_PASSWORD }, '')).access_token;
const plans = await api('GET', '/platform/plans', undefined, su);
const plan = plans[plans.length - 1];
const tenant = await api('POST', '/platform/tenants', { tenantCode: `MUL${SFX}`.slice(0, 12), tenantName: `Masters Co ${SFX}` , planId: plan.id }, su);
await api('POST', `/platform/tenants/${tenant.id}/assign-plan`, { planId: plan.id }, su).catch(() => {});
// Fleet alerts read the vehicle master; the module is enabled so the fleet page exists for it too.
await api('PUT', `/platform/tenants/${tenant.id}/modules/fleet`, { isEnabled: true }, su).catch(() => {});
const OWNER_EMAIL = `mul.owner.${SFX.toLowerCase()}@ci.test`;
const OWNER_PW = 'MastersOwner#12345';
await api('POST', `/platform/tenants/${tenant.id}/users`, { name: 'Masters Owner', email: OWNER_EMAIL, password: OWNER_PW }, su);
TOKEN = (await api('POST', '/auth/login', { login: OWNER_EMAIL, password: OWNER_PW }, '')).access_token;
ok('the test tenant and its owner are ready', Boolean(TOKEN));
const me = await api('GET', '/auth/me');
ok('/auth/me carries the user id the web keeps for the Mine filter', typeof me.user?.id === 'string' && me.user.id.length > 10);

// ---- customers and sites: a blank code is numbered, a typed one is kept ----
const c1 = await api('POST', '/customers', { customerName: `Auto Cust A ${SFX}`, state: 'Tamil Nadu' });
ok('a customer saved without a code gets one from the customer series (CUST-)', /^CUST-\d{4}/.test(String(c1.customerCode)));
const c2 = await api('POST', '/customers', { customerCode: '', customerName: `Auto Cust B ${SFX}`, state: 'Tamil Nadu' });
ok('an empty-string code is numbered too, with the next number', /^CUST-\d{4}/.test(String(c2.customerCode)) && c2.customerCode !== c1.customerCode);
const n1 = Number(String(c1.customerCode).slice(5, 9));
const n2 = Number(String(c2.customerCode).slice(5, 9));
ok('the two numbers are consecutive', n2 === n1 + 1);
const typed = await api('POST', '/customers', { customerCode: `TYPED-${SFX}`, customerName: `Typed Cust ${SFX}`, state: 'Tamil Nadu' });
ok('a typed code is kept as typed', typed.customerCode === `TYPED-${SFX}`);
const noName = await call('POST', '/customers', { customerType: 'b2b' });
ok('the name is still required (400)', noName.status === 400 && /customerName/.test(String(noName.data?.error?.message ?? '')));
const dupCode = await call('POST', '/customers', { customerCode: `TYPED-${SFX}`, customerName: `Dup ${SFX}` });
ok('a duplicate typed code is still refused', dupCode.status >= 400);
const series = await api('GET', '/number-series');
ok('the customer series now exists under Setup → Number Series with the default prefix', series.some((s) => s.documentType === 'customer' && s.prefix === 'CUST-'));

const s1 = await api('POST', '/sites', { siteName: `Auto Site ${SFX}`, customerId: c1.id, address: 'Near the ring road' });
ok('a site saved without a code gets one from the site series (SITE-)', /^SITE-\d{4}/.test(String(s1.siteCode)) && s1.customerId === c1.id);
const typedSite = await api('POST', '/sites', { siteCode: `TS-${SFX}`, siteName: `Typed Site ${SFX}` });
ok('a typed site code is kept', typedSite.siteCode === `TS-${SFX}`);

// ---- vehicles: owner, model, service due ----
const vNo = `TN01AB${SFX.slice(-4)}`;
const v = await api('POST', '/vehicles', { vehicleNo: vNo, vehicleType: 'transit_mixer', capacityM3: 6, ownerName: 'Murugan Transport', vehicleModel: 'Ashok Leyland 2518', serviceExpiry: yesterday });
const vGot = await api('GET', `/vehicles/${v.id}`);
ok('vehicle owner, model and service due round-trip', vGot.ownerName === 'Murugan Transport' && vGot.vehicleModel === 'Ashok Leyland 2518' && String(vGot.serviceExpiry).startsWith(yesterday));
const alerts = await api('GET', '/alerts');
const fleetExpired = (Array.isArray(alerts) ? alerts : alerts?.alerts ?? []).find((a) => a.key === 'fleet_docs_expired');
ok('a lapsed service is flagged with the fleet papers alert', Boolean(fleetExpired) && fleetExpired.detail.includes(`${vNo} — Service`));
await api('PATCH', `/vehicles/${v.id}`, { serviceExpiry: null, ownerName: 'Changed Owner' });
const vAfter = await api('GET', `/vehicles/${v.id}`);
ok('service due can be cleared and the owner edited', vAfter.serviceExpiry === null && vAfter.ownerName === 'Changed Owner');

// ---- suppliers: address, category, supplies, second number ----
const sup = await api('POST', '/suppliers', {
  supplierCode: `SUP-${SFX}`, supplierName: `Spares Depot ${SFX}`, address: '12 Industrial Estate', city: 'Coimbatore',
  supplyCategory: 'spares', suppliesNote: 'Drum rollers, hydraulic hoses, chute liners', mobile: '9876543210', altMobile: '9876500000',
});
const supGot = await api('GET', `/suppliers/${sup.id}`);
ok('supplier address, city, category, supplies and alternate mobile round-trip',
  supGot.address === '12 Industrial Estate' && supGot.city === 'Coimbatore' && supGot.supplyCategory === 'spares' && supGot.suppliesNote?.includes('hoses') && supGot.altMobile === '9876500000');
const badAlt = await call('POST', '/suppliers', { supplierCode: `SUP-B${SFX}`, supplierName: `Bad Alt ${SFX}`, altMobile: '12345' });
ok('a bad alternate mobile is refused with the field named', badAlt.status === 400 && Boolean(badAlt.data?.error?.fields?.altMobile ?? badAlt.data?.fields?.altMobile));

// ---- users: auto employee code, profile fields, photo and ID proof ----
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\n%%EOF\n');
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>');
const email = `emp.${SFX.toLowerCase()}@ci.test`;
const UPW = 'Employee#12345';
const u1 = await api('POST', '/users', { name: `Employee ${SFX}`, email, password: UPW, mobile: '9876512345', gender: 'female', dateOfJoining: '2026-04-01', address: '5 Gandhi Road' });
ok('a user created without an employee code gets one from the employee series (EMP-)', /^EMP-\d{4}/.test(String(u1.employeeCode)));
const listed = (await api('GET', '/users')).find((u) => u.id === u1.id);
ok('the list carries the code, gender, date of joining and address', listed?.employeeCode === u1.employeeCode && listed?.gender === 'female' && String(listed?.dateOfJoining).startsWith('2026-04-01') && listed?.address === '5 Gandhi Road');
ok('the list says there is no photo or ID proof yet, and carries no file data', listed?.hasPhoto === false && listed?.idProofName === null && !('photoData' in listed) && !('idProofData' in listed));
const badGender = await call('POST', '/users', { name: 'Bad Gender', email: `bad.${SFX.toLowerCase()}@ci.test`, password: UPW, gender: 'unknown' });
ok('an unknown gender is refused', badGender.status === 400);
const dupEmp = await call('POST', '/users', { name: 'Dup Code', email: `dup.${SFX.toLowerCase()}@ci.test`, password: UPW, employeeCode: String(u1.employeeCode).toLowerCase() });
ok('a duplicate employee code (any case) is refused', dupEmp.status === 400 && /already in use/i.test(String(dupEmp.data?.error?.message ?? '')));
const edited = await api('PATCH', `/users/${u1.id}`, { employeeCode: `E-${SFX}`, gender: 'other', address: '' });
ok('the profile fields can be edited and an empty address clears it', edited?.employeeCode === `E-${SFX}` && edited?.gender === 'other' && edited?.address === null);

const noPhoto = await bytes(`/users/${u1.id}/photo`);
ok('no photo yet reads as 404', noPhoto.status === 404);
const svgRefused = await call('PUT', `/users/${u1.id}/photo`, { mime: 'image/svg+xml', data: SVG.toString('base64') });
ok('an SVG photo is refused', svgRefused.status === 400);
const mismatch = await call('PUT', `/users/${u1.id}/photo`, { mime: 'image/png', data: PDF.toString('base64') });
ok('a file whose bytes do not match the claimed type is refused', mismatch.status === 400);
const put = await api('PUT', `/users/${u1.id}/photo`, { mime: 'image/png', data: `data:image/png;base64,${PNG.toString('base64')}` });
ok('a PNG photo is stored', put.hasPhoto === true && put.photoMime === 'image/png');
const got = await bytes(`/users/${u1.id}/photo`);
ok('the photo comes back as the same bytes with its content type', got.status === 200 && got.type.startsWith('image/png') && got.buf.equals(PNG));
const listedWithPhoto = (await api('GET', '/users')).find((u) => u.id === u1.id);
ok('the list now says there is a photo, still without the bytes', listedWithPhoto?.hasPhoto === true && !('photoData' in listedWithPhoto));

const proof = await api('PUT', `/users/${u1.id}/id-proof`, { mime: 'application/pdf', data: PDF.toString('base64'), name: 'aadhaar-scan.pdf' });
ok('a PDF ID proof is stored with its name', proof.idProofName === 'aadhaar-scan.pdf' && proof.idProofMime === 'application/pdf');
const gotProof = await bytes(`/users/${u1.id}/id-proof`);
ok('the ID proof comes back as a PDF', gotProof.status === 200 && gotProof.type.startsWith('application/pdf') && gotProof.buf.equals(PDF));
const tooBig = await call('PUT', `/users/${u1.id}/id-proof`, { mime: 'application/pdf', data: Buffer.concat([PDF, Buffer.alloc(3 * 1024 * 1024, 0x20)]).toString('base64') });
ok('an ID proof over 3 MB is refused', tooBig.status === 400);

// The person themselves may read their own files without users.manage; another user's needs it.
const selfTok = (await api('POST', '/auth/login', { login: email, password: UPW }, '')).access_token;
const own = await bytes(`/users/${u1.id}/photo`, selfTok);
ok('a person can read their own photo without users.manage', own.status === 200 && own.buf.equals(PNG));
const others = await bytes(`/users/${me.user.id}/photo`, selfTok);
ok("reading someone else's photo without users.manage is refused (403)", others.status === 403);
const selfPut = await call('PUT', `/users/${u1.id}/photo`, { mime: 'image/png', data: PNG.toString('base64') }, selfTok);
ok('uploading needs users.manage even for oneself (403)', selfPut.status === 403);

await api('DELETE', `/users/${u1.id}/photo`);
await api('DELETE', `/users/${u1.id}/id-proof`);
const afterDel = await bytes(`/users/${u1.id}/photo`);
const afterDelList = (await api('GET', '/users')).find((u) => u.id === u1.id);
ok('after Remove, the photo and ID proof are gone', afterDel.status === 404 && afterDelList?.hasPhoto === false && afterDelList?.idProofName === null);
const trail = await api('GET', '/audit-logs');
ok('the file changes are in the audit trail', trail.some((e) => e.action === 'user.update' && /photo/i.test(e.summary)));

// ---- leads: marketing person, create customer ----
const lead = await api('POST', '/leads', { customerName: `Lead Co ${SFX}`, contactPerson: 'Ramesh', mobile: '9876543211', email: `lead.${SFX.toLowerCase()}@ci.test`, siteLocation: 'Peelamedu, Coimbatore', assignedSalesUserId: me.user.id });
const leadRow = (await api('GET', '/leads')).find((l) => l.id === lead.id);
ok('the lead list carries the marketing person by name', leadRow?.assignedSalesUserName === me.user.name && leadRow?.assignedSalesUserId === me.user.id);
const badAssignee = await call('PATCH', `/leads/${lead.id}`, { assignedSalesUserId: '00000000-0000-4000-8000-000000000000' });
ok('a marketing person who is not a user of this company is refused', badAssignee.status === 400);
const made = await api('POST', `/leads/${lead.id}/create-customer`);
ok('Create customer returns the customer and the site', typeof made.customerId === 'string' && typeof made.siteId === 'string' && /^CUST-\d{4}/.test(made.customerCode) && /^SITE-\d{4}/.test(made.siteCode));
const cust = await api('GET', `/customers/${made.customerId}`);
ok('the customer under Masters carries the lead details', cust.customerName === `Lead Co ${SFX}` && cust.contactPerson === 'Ramesh' && cust.mobile === '9876543211');
const site = await api('GET', `/sites/${made.siteId}`);
ok('the site is named after the location and belongs to the customer', site.siteName === 'Peelamedu, Coimbatore' && site.address === 'Peelamedu, Coimbatore' && site.customerId === made.customerId);
const leadAfter = await api('GET', `/leads/${lead.id}`);
ok('the lead now links to the customer by id and name', leadAfter.customerId === made.customerId && leadAfter.linkedCustomerName === `Lead Co ${SFX}` && leadAfter.linkedCustomerCode === made.customerCode);
const again = await call('POST', `/leads/${lead.id}/create-customer`);
ok('a second Create customer is refused with a clear message', again.status === 400 && /already has a customer/i.test(String(again.data?.error?.message ?? '')));
const noSite = await api('POST', '/leads', { customerName: `No Site Co ${SFX}`, mobile: '9876543212' });
const madeNoSite = await api('POST', `/leads/${noSite.id}/create-customer`);
ok('a lead without a site location makes the customer only', typeof madeNoSite.customerId === 'string' && madeNoSite.siteId === null);
const badMobileLead = await api('POST', '/leads', { customerName: `Bad Mobile Co ${SFX}`, mobile: '12345' });
const badMobileMade = await call('POST', `/leads/${badMobileLead.id}/create-customer`);
ok('a lead with a bad mobile is refused until the lead is fixed', badMobileMade.status === 400 && /mobile/i.test(String(badMobileMade.data?.error?.message ?? '')));

console.log(`\nMASTERS USERS LEADS TEST: ${pass} passed`);
process.exit(0);
