import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
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

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @HttpCode(200)
  @Throttle(AUTH_THROTTLE)
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.login, dto.password);
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(@Body('refresh_token') token: string) {
    return this.auth.refresh(token);
  }

  /** Change your own password (any signed-in user, no permission needed). */
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
