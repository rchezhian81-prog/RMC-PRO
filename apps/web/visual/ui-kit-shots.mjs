/**
 * U1 command-surface visual harness (no API / no Postgres).
 *
 * The /ui-kit gallery is a static route (no data, no API), so — unlike the full
 * baseline stack — this just serves the standalone web build and screenshots the
 * gallery at each approved width in light + dark. Requires a build made with
 * NEXT_PUBLIC_UI_V2=1 NEXT_PUBLIC_UI_KIT=1 (so the route resolves, flag ON).
 *
 *   NEXT_PUBLIC_UI_V2=1 NEXT_PUBLIC_UI_KIT=1 pnpm --filter @rmc/web build
 *   node apps/web/visual/ui-kit-shots.mjs
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SA = path.join(WEB, '.next/standalone/apps/web');
const OUT = path.join(WEB, 'visual/__screenshots__/ui-kit');
const BASE = 'http://127.0.0.1:3100';

// Stage static + public into the standalone dir, exactly like the Dockerfile.
cpSync(path.join(WEB, '.next/static'), path.join(SA, '.next/static'), { recursive: true });
if (existsSync(path.join(WEB, 'public'))) cpSync(path.join(WEB, 'public'), path.join(SA, 'public'), { recursive: true });

const server = spawn('node', [path.join(SA, 'server.js')], {
  env: { ...process.env, NODE_ENV: 'production', PORT: '3100', HOSTNAME: '127.0.0.1' },
  stdio: 'inherit',
});

async function main() {
  let up = false;
  for (let i = 0; i < 60; i++) {
    up = await fetch(`${BASE}/ui-kit`).then((r) => r.ok).catch(() => false);
    if (up) break;
    await sleep(1000);
  }
  if (!up) throw new Error('server did not serve /ui-kit');

  mkdirSync(OUT, { recursive: true });
  const STAB = `*,*::before,*::after{transition:none!important;animation:none!important}*{caret-color:transparent!important}`;
  const VIEWPORTS = [
    ['desktop-1440', 1440, 900],
    ['tablet-768', 768, 1024],
    ['mobile-390', 390, 844],
  ];
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  for (const [vp, w, h] of VIEWPORTS) {
    for (const theme of ['light', 'dark']) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: 'reduce' });
      const page = await ctx.newPage();
      await page.goto(`${BASE}/ui-kit`, { waitUntil: 'networkidle' });
      await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
      await page.addStyleTag({ content: STAB });
      await page.waitForTimeout(250);
      const file = `ui-kit-${theme}-v2-${vp}.png`;
      await page.screenshot({ path: path.join(OUT, file), fullPage: true });
      console.log('shot', file);
      await ctx.close();
    }
  }
  await browser.close();
  console.log('\nbaselines in', OUT);
  console.log(readdirSync(OUT).join('\n'));
}

main()
  .then(() => { server.kill('SIGKILL'); process.exit(0); })
  .catch((e) => { console.error('HARNESS ERROR:', e.message); server.kill('SIGKILL'); process.exit(1); });
