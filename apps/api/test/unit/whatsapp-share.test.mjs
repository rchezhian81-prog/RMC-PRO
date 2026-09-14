/**
 * Sharing on WhatsApp opens WhatsApp. The API composes the text and a wa.me
 * link; the screens open it. Two things were wrong: the link carried a bare
 * 10-digit number, which wa.me rejects as invalid, and the screens never
 * opened it — they logged the text and said "WhatsApp message logged".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { waMeNumber, WhatsAppService } from '../../dist/sales/whatsapp.service.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../../..');
const codeOnly = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

test('an Indian mobile gets its country code, however it was typed', () => {
  assert.equal(waMeNumber('98765 43210'), '919876543210');
  assert.equal(waMeNumber('09876543210'), '919876543210');
  assert.equal(waMeNumber('+91 98765-43210'), '919876543210');
  assert.equal(waMeNumber('919876543210'), '919876543210');
  assert.equal(waMeNumber('+44 7700 900123'), '447700900123', 'a foreign number is left as typed');
  assert.equal(waMeNumber(''), '');
  assert.equal(waMeNumber(null), '');
});

test('the wa.me link carries the number and the text; without a number it still opens WhatsApp with the text', () => {
  const svc = new WhatsAppService(null);
  assert.equal(svc.buildShareUrl('98765 43210', 'Hello & thanks'), 'https://wa.me/919876543210?text=Hello%20%26%20thanks');
  assert.equal(svc.buildShareUrl(null, 'Hi'), 'https://wa.me/?text=Hi');
});

test('every Share button opens WhatsApp through the one helper; nothing says "logged" any more', () => {
  const pages = ['billing/invoices/[id]/page.tsx', 'dispatch/challans/[id]/page.tsx', 'sales/quotations/[id]/page.tsx', 'billing/receipts/page.tsx'];
  for (const f of pages) {
    const src = codeOnly(readFileSync(resolve(repoRoot, 'apps/web/src/app/app', f), 'utf8'));
    assert.match(src, /openWhatsAppShare\(\(\) => \w+Api\.share\(/, `${f} opens WhatsApp`);
    assert.doesNotMatch(src, /WhatsApp message logged/, `${f} no longer says "logged"`);
  }
  const lib = codeOnly(readFileSync(resolve(repoRoot, 'apps/web/src/lib/api.ts'), 'utf8'));
  assert.match(lib, /const tab = window\.open\('', '_blank'\);[\s\S]*const log = await call\(\);/, 'the tab is opened before the API call, inside the click');
});
