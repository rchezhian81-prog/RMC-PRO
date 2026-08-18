import { test, type Page } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { SCREENS } from './screens';

/**
 * Evidence-closure captures that sit outside the gated pixel baselines:
 *
 *  1. Functional fingerprint per route (both skins) → visual/.manifest/<mode>/…
 *     A skin-independent inventory of headings, actions, inputs and table
 *     columns. Diffing the flag-OFF vs V2 manifests proves functional parity
 *     (same routes / information / actions / permissions) — visual differences
 *     are expected, functional ones are not. Written once (desktop-1440 only).
 *
 *  2. Super-admin /admin/* screenshots (separate persona) → visual/evidence/.
 *     Non-gating page.screenshot files, skipped if no super-admin session.
 *
 *  3. /app/audit + /app/dispatch/tracking one-off renders → visual/evidence/.
 *     Non-deterministic (timestamps / live GPS), so evidence-only, never a
 *     pixel baseline.
 *
 * Nothing here asserts a screenshot, so it can't fail the regression gate.
 */

const BASE = process.env.WEB_BASE_URL ?? 'http://localhost:3000';
const MODE = process.env.VISUAL_MODE === 'v2' ? 'v2' : 'off';
const EVID = 'visual/evidence';
const MANIFEST = `visual/.manifest/${MODE}`;

const STAB = `*,*::before,*::after{transition:none!important;animation:none!important}*{caret-color:transparent!important}`;

async function stabilize(page: Page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addStyleTag({ content: STAB });
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(400);
}

async function setTheme(page: Page, t: 'light' | 'dark') {
  await page.evaluate((x) => document.documentElement.setAttribute('data-theme', x), t);
}

// A skin-independent functional fingerprint of the current page.
async function fingerprint(page: Page) {
  return page.evaluate(() => {
    const txt = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const main = document.querySelector('#main') ?? document.body;
    const q = (sel: string) => Array.from(main.querySelectorAll(sel));
    return {
      title: txt(document.querySelector('h1')),
      headings: q('h1,h2,h3').map(txt).filter(Boolean),
      buttons: q('button').map(txt).filter(Boolean).sort(),
      links: q('a').map((a) => `${txt(a)}→${a.getAttribute('href') ?? ''}`).filter(Boolean).sort(),
      inputs: q('input,select,textarea')
        .map((i) => i.getAttribute('name') || i.getAttribute('id') || (i as HTMLInputElement).type || i.tagName)
        .filter(Boolean)
        .sort(),
      tableCols: q('thead th').map(txt),
      // nav is identical across routes; capture once via the sidebar links count
      navItems: Array.from(document.querySelectorAll('.mn-nav')).map(txt).filter(Boolean),
    };
  });
}

// (1) Functional fingerprint of every route — desktop only (viewport-independent).
test('evidence: functional fingerprint (all routes)', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440', 'fingerprint once per mode');
  test.setTimeout(360_000);
  mkdirSync(MANIFEST, { recursive: true });
  for (const s of SCREENS) {
    await page.goto(`${BASE}${s.path}`, { waitUntil: 'networkidle' });
    await stabilize(page);
    writeFileSync(`${MANIFEST}/${s.name}.json`, JSON.stringify(await fingerprint(page), null, 2));
  }
});

// (2) Super-admin persona — /admin/* evidence (non-gating; skipped if no session).
test('evidence: super-admin routes', async ({ browser }, testInfo) => {
  const ADMIN = 'visual/.auth/admin.json';
  test.skip(!existsSync(ADMIN), 'no super-admin session seeded');
  mkdirSync(EVID, { recursive: true });
  const ctx = await browser.newContext({
    storageState: ADMIN,
    viewport: testInfo.project.use.viewport,
    reducedMotion: 'reduce',
  });
  const page = await ctx.newPage();
  for (const [name, path] of [
    ['admin-tenants', '/admin/tenants'],
    ['admin-plans', '/admin/plans'],
  ] as const) {
    await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
    for (const theme of ['light', 'dark'] as const) {
      await setTheme(page, theme);
      await stabilize(page);
      await page.screenshot({ path: `${EVID}/${name}-${theme}-${MODE}-${testInfo.project.name}.png`, fullPage: true });
    }
  }
  await ctx.close();
});

// (4) Detail [id] routes — rendered against seeded synthetic fixtures.
// Gated pixel baselines (V2 only, so the OFF pass doesn't diff a v2 image);
// functional fingerprints in BOTH skins (desktop) for the parity diff. The URL
// id varies per seed but the rendered content (numbers/amounts) is deterministic.
const FIXTURES = 'visual/.fixtures.json';

// Detail pages carry real per-record timestamps, so capture them as evidence
// (page.screenshot, non-gating) rather than flaky pixel baselines — still the
// full light/dark × 4-viewport visual proof the owner asked for. Functional
// fingerprints (desktop, both skins) still feed the flag-OFF↔V2 parity diff.
async function captureDetail(page: Page, name: string, url: string, projectName: string, mode: string) {
  await page.goto(url, { waitUntil: 'networkidle' });
  if (projectName === 'desktop-1440') {
    await stabilize(page);
    mkdirSync(MANIFEST, { recursive: true });
    writeFileSync(`${MANIFEST}/${name}.json`, JSON.stringify(await fingerprint(page), null, 2));
  }
  if (mode === 'v2') {
    mkdirSync(EVID, { recursive: true });
    for (const theme of ['light', 'dark'] as const) {
      await setTheme(page, theme);
      await stabilize(page);
      await page.screenshot({ path: `${EVID}/${name}-${theme}-v2-${projectName}.png`, fullPage: true });
    }
  }
}

test('evidence: detail [id] routes (owner)', async ({ page }, testInfo) => {
  test.skip(!existsSync(FIXTURES), 'no seeded fixtures');
  test.setTimeout(180_000);
  const fx = JSON.parse(readFileSync(FIXTURES, 'utf8')) as Record<string, string>;
  const routes: Array<[string, string]> = [
    ['detail-quotation', `/app/sales/quotations/${fx.quotationId}`],
    ['detail-rate-contract', `/app/sales/rate-contracts/${fx.rateContractId}`],
    ['detail-order', `/app/orders/${fx.orderId}`],
    ['detail-batch-ticket', `/app/production/batch-tickets/${fx.batchTicketId}`],
    ['detail-challan', `/app/dispatch/challans/${fx.challanId}`],
    ['detail-invoice', `/app/billing/invoices/${fx.invoiceId}`],
    ['detail-cube-set', `/app/qc/cubes/${fx.cubeSetId}`],
  ];
  for (const [name, path] of routes) {
    const id = path.split('/').pop();
    if (!id || id === 'undefined' || id === 'null') continue; // fixture missing → skip, don't fail
    await captureDetail(page, name, `${BASE}${path}`, testInfo.project.name, MODE);
  }
  // Not-found / error state (evidence-only, v2 desktop): a well-formed but absent id.
  if (MODE === 'v2' && testInfo.project.name === 'desktop-1440') {
    await page.goto(`${BASE}/app/sales/quotations/00000000-0000-0000-0000-000000000000`, { waitUntil: 'networkidle' });
    await setTheme(page, 'light');
    await stabilize(page);
    mkdirSync(EVID, { recursive: true });
    await page.screenshot({ path: `${EVID}/detail-not-found-light-v2-desktop-1440.png`, fullPage: true });
  }
});

test('evidence: detail [id] route (super-admin tenant)', async ({ browser }, testInfo) => {
  const ADMIN = 'visual/.auth/admin.json';
  test.skip(!existsSync(ADMIN) || !existsSync(FIXTURES), 'no super-admin session or fixtures');
  const fx = JSON.parse(readFileSync(FIXTURES, 'utf8')) as Record<string, string>;
  if (!fx.tenantId) { test.skip(true, 'no tenantId fixture'); return; }
  const ctx = await browser.newContext({ storageState: ADMIN, viewport: testInfo.project.use.viewport, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await captureDetail(page, 'detail-admin-tenant', `${BASE}/admin/tenants/${fx.tenantId}`, testInfo.project.name, MODE);
  await ctx.close();
});

// (3) Non-deterministic routes — evidence-only render proof.
test('evidence: non-deterministic routes (audit, tracking)', async ({ page }, testInfo) => {
  mkdirSync(EVID, { recursive: true });
  for (const [name, path] of [
    ['audit', '/app/audit'],
    ['dispatch-tracking', '/app/dispatch/tracking'],
  ] as const) {
    await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
    for (const theme of ['light', 'dark'] as const) {
      await setTheme(page, theme);
      await stabilize(page);
      await page.screenshot({ path: `${EVID}/${name}-${theme}-${MODE}-${testInfo.project.name}.png`, fullPage: true });
    }
  }
});
