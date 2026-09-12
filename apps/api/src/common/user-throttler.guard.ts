import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerGuard } from '@nestjs/throttler';
import { JWT_ACCESS_SECRET } from '../auth/jwt-secrets';

/**
 * Rate-limit authenticated traffic per USER, not per IP.
 *
 * THE DEFECT THIS FIXES: the stock ThrottlerGuard keys every request on the
 * client IP. A plant office behind one NAT address therefore shares a single
 * 100-requests-per-minute bucket across all of its staff — a handful of people
 * working normally exhaust it and everyone at that site starts getting 429s,
 * which presents as "the system is down sometimes" and is miserable to
 * diagnose. The load probe (scripts/ops/load-test.mjs) makes it visible in
 * seconds.
 *
 * WHY THE TOKEN IS VERIFIED, NOT DECODED: this guard is a global APP_GUARD, so
 * it runs BEFORE JwtAuthGuard and `req.user` does not exist yet — the identity
 * has to come from the Authorization header itself. Merely decoding it would be
 * a bypass: anyone could put an arbitrary `sub` in an unsigned token and mint
 * themselves an unlimited supply of fresh buckets, switching the rate limiter
 * off. So the signature is checked, and anything that fails — forged, expired,
 * malformed, or simply absent — falls back to the IP bucket.
 *
 * Brute-force protection is untouched: /auth/login and /auth/refresh carry no
 * bearer token, so they stay IP-keyed exactly as before.
 */

/** Pull a bearer token out of an Authorization header value. */
export function bearerToken(header: unknown): string | null {
  const m = /^Bearer\s+(\S+)$/i.exec(String(header ?? '').trim());
  return m?.[1] ?? null;
}

/**
 * Decide the throttler bucket for one request. Takes the verifier as an argument
 * so the decision — including the forged-token fallback — is testable without
 * standing up a guard.
 */
export async function resolveTracker(
  authHeader: unknown,
  ip: unknown,
  verify: (token: string) => Promise<{ sub?: unknown } | null | undefined>,
): Promise<string> {
  const token = bearerToken(authHeader);
  if (token) {
    try {
      const payload = await verify(token);
      const sub = payload?.sub;
      // A verified token identifies a real user: key on them, so the same person
      // gets one bucket wherever they connect from, and two colleagues sharing an
      // office IP get one each.
      if (sub !== undefined && sub !== null && String(sub).trim() !== '') {
        return `user:${String(sub).trim()}`;
      }
    } catch {
      // Unverifiable: treat as anonymous rather than trusting the claim.
    }
  }
  const addr = String(ip ?? '').trim();
  return `ip:${addr || 'unknown'}`;
}

@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  private readonly jwt = new JwtService({});

  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    const headers = (req?.headers ?? {}) as Record<string, unknown>;
    return resolveTracker(headers.authorization, req?.ip, (token) =>
      this.jwt.verifyAsync<{ sub?: unknown }>(token, { secret: JWT_ACCESS_SECRET }),
    );
  }
}
