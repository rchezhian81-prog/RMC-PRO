/**
 * Unit tests for the WhatsApp Business (Meta Cloud API) adapter: the request
 * body for text vs template, the response parsing, the number normalisation and
 * the env fallback — all against a fake fetch, no network.
 *
 * Imports the COMPILED output, so `pnpm --filter @rmc/api build` must run first.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMessagePayload, parseGraphResponse, sendWhatsAppMessage, configFromEnv, graphBase,
} from '../../dist/sales/whatsapp-provider.js';
import { waMeNumber } from '../../dist/sales/whatsapp.util.js';

test('waMeNumber: Indian spellings collapse to 91XXXXXXXXXX', () => {
  assert.equal(waMeNumber('98765 43210'), '919876543210');
  assert.equal(waMeNumber('09876543210'), '919876543210');
  assert.equal(waMeNumber('+91 98765-43210'), '919876543210');
  assert.equal(waMeNumber(''), '');
});

test('buildMessagePayload: free text when no template, template with one body parameter otherwise', () => {
  const text = buildMessagePayload({ templateName: null, templateLanguage: null }, '919876543210', 'Hello');
  assert.equal(text.type, 'text');
  assert.equal(text.to, '919876543210');
  assert.deepEqual(text.text, { preview_url: false, body: 'Hello' });
  const tpl = buildMessagePayload({ templateName: 'rmc_notice', templateLanguage: 'en_US' }, '919876543210', 'Invoice INV-1 for ₹1,000');
  assert.equal(tpl.type, 'template');
  assert.equal(tpl.template.name, 'rmc_notice');
  assert.deepEqual(tpl.template.language, { code: 'en_US' });
  assert.equal(tpl.template.components[0].parameters[0].text, 'Invoice INV-1 for ₹1,000');
});

test('parseGraphResponse: message id on success, plain-words error otherwise', () => {
  assert.deepEqual(parseGraphResponse(200, { messages: [{ id: 'wamid.ABC' }] }), { ok: true, status: 200, messageId: 'wamid.ABC' });
  const r = parseGraphResponse(400, { error: { message: 'Invalid parameter', code: 100, error_data: { details: 'Template name does not exist' } } });
  assert.equal(r.ok, false);
  assert.match(r.error, /code 100/);
  assert.match(r.error, /Template name does not exist/);
  const r2 = parseGraphResponse(401, {});
  assert.match(r2.error, /HTTP 401/);
  const r3 = parseGraphResponse(200, {});
  assert.match(r3.error, /without a message id/);
});

test('sendWhatsAppMessage: posts to {base}/{phoneNumberId}/messages with the bearer token', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return { status: 200, json: async () => ({ messages: [{ id: 'wamid.1' }] }) }; };
  const cfg = { phoneNumberId: '1234567890', accessToken: 'EAAtesttoken', templateName: null, templateLanguage: 'en', source: 'tenant' };
  const r = await sendWhatsAppMessage(cfg, '98765 43210', 'Hi', { fetchImpl, env: { WHATSAPP_API_BASE: 'http://127.0.0.1:1/' } });
  assert.equal(r.ok, true);
  assert.equal(r.messageId, 'wamid.1');
  assert.equal(calls[0].url, 'http://127.0.0.1:1/1234567890/messages');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer EAAtesttoken');
  assert.equal(JSON.parse(calls[0].init.body).to, '919876543210');
});

test('sendWhatsAppMessage: a blank number and a network failure are results, not exceptions', async () => {
  const cfg = { phoneNumberId: '1', accessToken: 'x'.repeat(30), source: 'server' };
  const blank = await sendWhatsAppMessage(cfg, '', 'Hi', { fetchImpl: async () => { throw new Error('should not be called'); } });
  assert.equal(blank.ok, false);
  assert.match(blank.error, /No valid mobile/);
  const down = await sendWhatsAppMessage(cfg, '9876543210', 'Hi', { fetchImpl: async () => { throw new Error('ECONNREFUSED'); } });
  assert.equal(down.ok, false);
  assert.match(down.error, /Could not reach the WhatsApp API/);
  assert.doesNotMatch(down.error, /xxxxxxxx/, 'the token never appears in an error');
});

test('configFromEnv: both id and token required; template optional; default graph base', () => {
  assert.equal(configFromEnv({}), null);
  assert.equal(configFromEnv({ WHATSAPP_PHONE_NUMBER_ID: '1' }), null);
  const c = configFromEnv({ WHATSAPP_PHONE_NUMBER_ID: '123', WHATSAPP_ACCESS_TOKEN: 'tok', WHATSAPP_TEMPLATE_NAME: 'rmc_notice' });
  assert.equal(c.source, 'server');
  assert.equal(c.templateName, 'rmc_notice');
  assert.equal(c.templateLanguage, 'en');
  assert.equal(graphBase({}), 'https://graph.facebook.com/v21.0');
  assert.equal(graphBase({ WHATSAPP_API_BASE: 'http://localhost:9/' }), 'http://localhost:9');
});
