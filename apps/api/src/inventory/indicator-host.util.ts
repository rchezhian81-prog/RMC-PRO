/**
 * Where a weighbridge indicator is allowed to live (Plan E1 hardening).
 *
 * `WeighbridgeIndicatorService.readTcpFrame` opens a TCP connection to the host
 * and port stored on the indicator record, and those are tenant-supplied: the
 * device routes are gated on `weighbridge.device`, which Store Staff holds. So
 * an ordinary operator could register an "indicator" at 169.254.169.254:80 or
 * 127.0.0.1:6379 and make the API dial it — a server-side request forgery with
 * the first line of the reply handed back in the reading's `raw` field, and a
 * refused-vs-timed-out error message that maps open ports on the internal
 * network. Classifying the resolved address closes that.
 *
 * Pure and dependency-free so the block list is unit-testable without sockets.
 */

export type AddressClass =
  | 'public'
  | 'loopback'
  | 'private'
  | 'link-local'
  | 'unspecified'
  | 'multicast'
  | 'reserved'
  | 'invalid';

function classifyIpv4(ip: string): AddressClass | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const o: number[] = [];
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (n > 255) return null;
    o.push(n);
  }
  const a = o[0];
  const b = o[1];
  if (a === undefined || b === undefined) return null;
  if (a === 0) return 'unspecified';
  if (a === 127) return 'loopback';
  if (a === 10) return 'private';
  if (a === 172 && b >= 16 && b <= 31) return 'private';
  if (a === 192 && b === 168) return 'private';
  if (a === 169 && b === 254) return 'link-local'; // incl. the cloud metadata IP
  if (a === 100 && b >= 64 && b <= 127) return 'private'; // CGNAT (RFC 6598)
  if (a === 192 && b === 0) return 'reserved'; // 192.0.0/24 + 192.0.2/24
  if (a === 198 && (b === 18 || b === 19)) return 'reserved'; // benchmarking
  if (a >= 224 && a <= 239) return 'multicast';
  if (a >= 240) return 'reserved'; // 240/4 + 255.255.255.255
  return 'public';
}

/** Classify a literal IP address. Hostnames must be resolved by the caller. */
export function classifyAddress(ip: unknown): AddressClass {
  const raw = String(ip ?? '').trim();
  if (!raw) return 'invalid';

  // Strip a zone index ("fe80::1%eth0") and IPv4-mapped/compatible prefixes so
  // ::ffff:127.0.0.1 is judged as the loopback address it actually reaches.
  const bare = (raw.split('%')[0] ?? '').toLowerCase();
  if (bare.includes('.')) {
    const v4 = classifyIpv4(bare.slice(bare.lastIndexOf(':') + 1));
    if (v4) return v4;
    if (!bare.includes(':')) return 'invalid';
  }
  if (!bare.includes(':')) return 'invalid';

  // IPv6 from here.
  if (bare === '::') return 'unspecified';
  if (bare === '::1') return 'loopback';
  if (/^f[cd]/.test(bare)) return 'private'; // fc00::/7 unique-local
  if (/^fe[89ab]/.test(bare)) return 'link-local'; // fe80::/10
  if (/^ff/.test(bare)) return 'multicast';
  if (!/^[0-9a-f:]+$/.test(bare)) return 'invalid';
  return 'public';
}

/** True only for an address that is safe to dial from the API host. */
export function isRoutableAddress(ip: unknown): boolean {
  return classifyAddress(ip) === 'public';
}

/**
 * On-premise installs (the desktop/local setup, or an API sharing the plant LAN)
 * legitimately reach an indicator at 192.168.x.x. They opt back in explicitly
 * rather than the guard being weakened for the hosted product.
 */
export function privateIndicatorsAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.WEIGHBRIDGE_ALLOW_PRIVATE_INDICATORS ?? '').trim() === '1';
}

/** A TCP port the indicator may sit on. */
export function isValidPort(port: unknown): boolean {
  const n = Number(port);
  return Number.isInteger(n) && n >= 1 && n <= 65535;
}
