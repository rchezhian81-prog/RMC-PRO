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
 * Content-Security-Policy — the interim XSS-surface mitigation (QA #5).
 *
 * TRADE-OFF (documented): access/refresh tokens are still kept in localStorage,
 * not httpOnly cookies. A full cookie migration is non-trivial here because the
 * web app (app.<domain>) and API (api.<domain>) are different origins, so the
 * cookies would need SameSite=None + credentialed CORS + CSRF tokens — a
 * cross-cutting change we are not making on a live pilot mid-flight. Until then
 * this CSP shrinks the XSS surface that makes localStorage tokens exploitable:
 * it blocks loading external scripts and, crucially, blocks connections
 * (exfiltration) to anywhere but our own API — so injected JS cannot phone a
 * stolen token home. Inline scripts/styles stay allowed (Next hydration + the
 * app's inline styles); tightening those to nonces is the follow-up.
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
