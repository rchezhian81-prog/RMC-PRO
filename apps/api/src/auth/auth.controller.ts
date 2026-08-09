import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CurrentUser, type AuthUser } from './auth-user';

/**
 * Tight per-route limit on the credential endpoints (login, change-password) to
 * blunt brute force — 5 attempts per minute in production. Overridable via env
 * so integration/load tests can relax it (they hammer login far past a human
 * rate); the defaults are the production values.
 */
const AUTH_THROTTLE = {
  default: {
    limit: Number(process.env.AUTH_THROTTLE_LIMIT ?? 5),
    ttl: Number(process.env.AUTH_THROTTLE_TTL ?? 60_000),
  },
};

/**
 * The refresh token is issued BOTH in the response body (so existing clients
 * keep working) AND as an httpOnly cookie. httpOnly means JavaScript — and any
 * XSS — cannot read it, unlike a token in localStorage. The cookie is scoped to
 * the auth path, so it is only ever sent to /auth/* (never to business routes,
 * which authenticate with the Bearer access token and so carry no CSRF surface).
 *
 * Cross-site by default (app.<domain> calling api.<domain> is a different site),
 * which requires SameSite=None + Secure. Override via env for same-origin setups
 * or local http development.
 */
const RT_COOKIE = 'rmc_rt';

function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.AUTH_COOKIE_SECURE !== 'false',
    sameSite: (process.env.AUTH_COOKIE_SAMESITE ?? 'none') as 'none' | 'lax' | 'strict',
    domain: process.env.AUTH_COOKIE_DOMAIN || undefined,
    path: '/api/v1/auth',
    maxAge: Number(process.env.JWT_REFRESH_TTL ?? 1_209_600) * 1000,
  };
}

/** Read one cookie from the raw header — avoids a cookie-parser dependency. */
function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return undefined;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @HttpCode(200)
  @Throttle(AUTH_THROTTLE)
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.login(dto.login, dto.password);
    res.cookie(RT_COOKIE, result.refresh_token, cookieOptions());
    return result;
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body('refresh_token') bodyToken?: string,
  ) {
    // Dual-mode: prefer the httpOnly cookie; fall back to the body so clients
    // that have not yet moved to the cookie keep working.
    const token = readCookie(req, RT_COOKIE) ?? bodyToken ?? '';
    const result = await this.auth.refresh(token);
    res.cookie(RT_COOKIE, result.refresh_token, cookieOptions());
    return result;
  }

  /** Clear the refresh cookie so the browser forgets it. */
  @Post('logout')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  logout(@Res({ passthrough: true }) res: Response) {
    // clearCookie sets its own expiry; the path/domain/sameSite/secure must match
    // the cookie we set for the browser to clear it.
    const o = cookieOptions();
    res.clearCookie(RT_COOKIE, {
      httpOnly: o.httpOnly,
      secure: o.secure,
      sameSite: o.sameSite,
      domain: o.domain,
      path: o.path,
    });
    return { loggedOut: true };
  }

  @Post('change-password')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  @Throttle(AUTH_THROTTLE)
  changePassword(
    @CurrentUser() user: AuthUser,
    @Body() dto: { currentPassword?: string; newPassword?: string },
  ) {
    return this.auth.changePassword(user.userId, dto?.currentPassword ?? '', dto?.newPassword ?? '');
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.userId);
  }
}
