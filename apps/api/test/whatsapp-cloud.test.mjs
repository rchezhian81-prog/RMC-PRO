/**
 * WhatsApp Business (Meta Cloud API) integration test.
 *
 * Runs a stub of the Graph API on the port the runner points WHATSAPP_API_BASE
 * at, connects the tenant's account through Settings (the token is sealed with
 * the suite's GST_CRED_ENC_KEY), then proves end to end:
 *   - status is redacted (no token) and says the account is connected
 *   - a test send reaches the stub with the bearer token and the E.164 number
 *   - sharing a quotation SENDS it (log row 'sent' with the provider id) and
 *     the share URL is still returned as the fallback
 *   - a template name switches the payload to a template with one body parameter
 *   - a refusal from the API is recorded as 'failed' with the reason, and
 *     Resend delivers it once the API accepts
 *   - the "WhatsApp automatic sending" setting off → 'logged' only, nothing sent
 *   - disconnecting → back to 'logged'
 *   - a wrong phone-number id / short token is refused on save
 *
 * Env (provided by run-integration.mjs): API_BASE, LOGIN, RMC_PASSWORD, WHATSAPP_API_BASE.
 */
import { createServer } from 'node:http';

const API_BASE = process.env.API_BASE || 'http://localhost:4000/api/v1';
const LOGIN = process.env.LOGIN;
const PASSWORD = process.env.RMC_PASSWORD;
const STUB_URL = new URL(process.env.WHATSAPP_API_BASE || 'http://127.0.0.1:4599');

let pass = 0;
const ok = (name, cond) => { console.log((cond ? '  PASS ' : '  FAIL ') + name); if (!cond) { stub.close(); throw new Error('FAIL: ' + name); } pass++; };

async function call(method, path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}
let TOKEN = '';
async function api(method, path, body) {
  const r = await call(method, path, body);
  if (r.status >= 400 || !r.data?.success) throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(r.data)}`);
  return r.data.data;
}
const lookup = async (path, field, value) => {
  const list = await api('GET', `/${path}`);
  return (Array.isArray(list) ? list : []).find((r) => String(r[field]) === value);
};

if (!LOGIN || !PASSWORD) {
  console.log('(skipping whatsapp-cloud — LOGIN/RMC_PASSWORD not set)');
  process.exit(0);
}

// ---- the Graph API stub ----
const received = [];
let mode = 'accept'; // accept | refuse
const stub = createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    const body = raw ? JSON.parse(raw) : null;
    received.push({ url: req.url, auth: req.headers.authorization, body });
    res.setHeader('Content-Type', 'application/json');
    if (mode === 'refuse') {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: { message: 'Invalid parameter', code: 100, error_data: { details: 'Template name does not exist in the translation' } } }));
      return;
    }
    res.statusCode = 200;
    res.end(JSON.stringify({ messaging_product: 'whatsapp', contacts: [{ wa_id: body?.to }], messages: [{ id: `wamid.${received.length}` }] }));
  });
});
await new Promise((r) => stub.listen(Number(STUB_URL.port), STUB_URL.hostname, r));

console.log('=== whatsapp business cloud api (connect → send → template → failed → resend → off) ===');
TOKEN = (await api('POST', '/auth/login', { login: LOGIN, password: PASSWORD })).access_token;
const FAKE_TOKEN = `EAAtest${'x'.repeat(40)}`;

// Start clean: no tenant account.
await call('DELETE', '/integrations/whatsapp');
await api('PUT', '/settings/whatsapp_notifications', { value: 'true' });

let st = await api('GET', '/integrations/whatsapp');
ok('not connected at first, encryption available on this server', st.configured === false && st.encryptionAvailable === true && !('accessToken' in st));

const badId = await call('POST', '/integrations/whatsapp', { phoneNumberId: '+91 98765 43210', accessToken: FAKE_TOKEN });
ok('a phone number instead of the numeric id is refused', badId.status === 400 && /Phone number ID/.test(JSON.stringify(badId.data)));
const shortTok = await call('POST', '/integrations/whatsapp', { phoneNumberId: '123456789012345', accessToken: 'short' });
ok('a too-short token is refused', shortTok.status === 400);

st = await api('POST', '/integrations/whatsapp', { phoneNumberId: '123456789012345', accessToken: FAKE_TOKEN, businessNumber: '+91 98765 00000' });
ok('connected: status carries the id and business number, never the token', st.configured === true && st.source === 'tenant' && st.phoneNumberId === '123456789012345' && !JSON.stringify(st).includes(FAKE_TOKEN));

// Test send.
let t = await api('POST', '/integrations/whatsapp/test', { mobile: '98765 43210' });
ok('the test message is delivered through the stub', t.delivered === true && /^wamid\./.test(t.providerMessageId ?? ''));
let last = received[received.length - 1];
ok('the stub saw the bearer token, the phone-number id in the path and the E.164 number', last.auth === `Bearer ${FAKE_TOKEN}` && last.url === '/123456789012345/messages' && last.body.to === '919876543210' && last.body.type === 'text');
st = await api('GET', '/integrations/whatsapp');
ok('the last test outcome is recorded on the status', st.lastTestSuccess === true && !!st.lastTestedAt);

// Share a quotation → sent.
const customer = await lookup('customers', 'customerCode', 'CUST-001');
const grade = await lookup('concrete-grades', 'gradeCode', 'M25');
const TODAY = new Date().toISOString().slice(0, 10);
const q = await api('POST', '/quotations', {
  customerId: customer.id, quotationDate: TODAY,
  items: [{ gradeId: grade.id, gradeLabel: grade.gradeName, estimatedQuantity: 6, ratePerM3: 4800 }],
});
const before = received.length;
let log = await api('POST', `/quotations/${q.id}/share`, { mobile: '9876543210' });
ok('sharing a quotation sends it: status sent + provider id + sentAt', log.messageStatus === 'sent' && /^wamid\./.test(log.providerMessageId ?? '') && !!log.sentAt);
ok('the click-to-chat link is still there as the fallback', /^https:\/\/wa\.me\/919876543210\?text=/.test(log.shareUrl ?? ''));
ok('exactly one API call for the share, carrying the quotation number', received.length === before + 1 && received[received.length - 1].body.text.body.includes(q.quotationNo));

// Template mode.
await api('POST', '/integrations/whatsapp', { phoneNumberId: '123456789012345', accessToken: FAKE_TOKEN, templateName: 'rmc_notice', templateLanguage: 'en_US' });
log = await api('POST', `/quotations/${q.id}/share`, { mobile: '9876543210', message: 'Hello template' });
last = received[received.length - 1];
ok('with a template configured the payload is a template with one body parameter', log.messageStatus === 'sent' && last.body.type === 'template' && last.body.template.name === 'rmc_notice' && last.body.template.language.code === 'en_US' && last.body.template.components[0].parameters[0].text === 'Hello template');

// Refusal → failed, then resend.
mode = 'refuse';
log = await api('POST', `/quotations/${q.id}/share`, { mobile: '9876543210' });
ok('a refusal is recorded as failed with the reason', log.messageStatus === 'failed' && /code 100/.test(log.errorMessage ?? '') && /Template name does not exist/.test(log.errorMessage ?? ''));
ok('the fallback link is still returned on failure', /^https:\/\/wa\.me\//.test(log.shareUrl ?? ''));
const hist = await api('GET', '/notifications');
ok('the send log shows the failed row', hist.some((h) => h.id === log.id && h.messageStatus === 'failed'));
mode = 'accept';
const resent = await api('POST', `/notifications/${log.id}/resend`);
ok('Resend delivers the same row once the API accepts', resent.id === log.id && resent.messageStatus === 'sent' && !resent.errorMessage && /^wamid\./.test(resent.providerMessageId ?? ''));

// No mobile → logged (nothing sent).
const noMobileCustomer = await api('POST', '/customers', { customerCode: `WA-NM-${Date.now() % 100000}`, customerName: 'No Mobile Co', customerType: 'b2c', state: 'Tamil Nadu' });
const q2 = await api('POST', '/quotations', { customerId: noMobileCustomer.id, quotationDate: TODAY, items: [{ gradeId: grade.id, gradeLabel: grade.gradeName, estimatedQuantity: 3, ratePerM3: 4800 }] });
const before2 = received.length;
log = await api('POST', `/quotations/${q2.id}/share`, {});
ok('no mobile number → logged only, no API call', log.messageStatus === 'logged' && received.length === before2);

// Setting off → logged only.
await api('PUT', '/settings/whatsapp_notifications', { value: 'false' });
const before3 = received.length;
log = await api('POST', `/quotations/${q.id}/share`, { mobile: '9876543210' });
ok('automatic sending OFF → the share is logged only and nothing is sent', log.messageStatus === 'logged' && received.length === before3);
await api('PUT', '/settings/whatsapp_notifications', { value: 'true' });

// Disconnect → logged only.
const del = await api('DELETE', '/integrations/whatsapp');
ok('disconnect deletes the stored account', del.deleted === true);
st = await api('GET', '/integrations/whatsapp');
ok('status reads not connected again', st.configured === false);
const before4 = received.length;
log = await api('POST', `/quotations/${q.id}/share`, { mobile: '9876543210' });
ok('after disconnect a share is logged only', log.messageStatus === 'logged' && received.length === before4);
const resendOff = await api('POST', `/notifications/${log.id}/resend`);
ok('Resend without an account explains itself', resendOff.messageStatus === 'failed' && /No WhatsApp Business account/.test(resendOff.errorMessage ?? ''));

stub.close();
console.log(`\nWHATSAPP CLOUD TEST: ${pass} passed ✓`);
process.exit(0);
