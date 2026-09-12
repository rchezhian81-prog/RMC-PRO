import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Origin the browser is allowed to call (the API). Derived from the build-time
// public API URL so connect-src is scoped, not wide open.
let apiOrigin = '';
try {
  if (process.env.NEXT_PUBLIC_API_URL) apiOrigin = new URL(process.env.NEXT_PUBLIC_API_URL).origin;
} catch {
  /* leave empty */
}

/**
 * Content-Security-Policy.
 *
 * WHAT IT DEFENDS NOW: the cookie migration this comment used to defer has
 * happened. The refresh token rides in the httpOnly `rmc_rt` cookie (see
 * auth.controller.ts) and the access token is held in memory — the web app puts
 * no token in localStorage at all, which holds only the theme and sidebar
 * preference. So the CSP is no longer standing in for exposed tokens.
 *
 * It still earns its place against what XSS could otherwise do with a session
 * it cannot read: `connect-src` confines requests to our own API, so injected
 * JS cannot exfiltrate tenant data it reads through the user's session;
 * `frame-ancestors 'none'` blocks clickjacking; `object-src 'none'` and
 * `base-uri 'self'` close the plugin and base-tag vectors.
 *
 * REMAINING LOOSENESS: `script-src` still allows 'unsafe-inline' and
 * 'unsafe-eval' (Next hydration and the app's inline styles). Moving to nonces,
 * and dropping 'unsafe-eval' — which a production Next build should not need —
 * is the follow-up, and wants a browser pass over every screen before it ships.
 */
const csp = [
  `default-src 'self'`,
  `script-src 'self' 'unsafe-inline' 'unsafe-eval'`,
  `style-src 'self' 'unsafe-inline'`,
  `img-src 'self' data: blob:`,
  `font-src 'self' data:`,
  `connect-src 'self' ${apiOrigin} ws: wss:`.replace(/\s+/g, ' ').trim(),
  `object-src 'none'`,
  `base-uri 'self'`,
  `form-action 'self'`,
  `frame-ancestors 'none'`,
].join('; ');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Emit a self-contained server for a minimal production Docker image.
  // `outputFileTracingRoot` is the monorepo root so pnpm-workspace deps
  // (e.g. @rmc/shared) are traced into `.next/standalone`.
  output: 'standalone',
  outputFileTracingRoot: path.join(__dirname, '../../'),
  async headers() {
    return [{ source: '/(.*)', headers: [{ key: 'Content-Security-Policy', value: csp }] }];
  },
};

export default nextConfig;
