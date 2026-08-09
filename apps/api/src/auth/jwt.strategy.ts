import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { AuthUser } from './auth-user';
import { JWT_ACCESS_SECRET } from './jwt-secrets';

interface JwtPayload {
  sub: string;
  tid: string | null;
  typ: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: JWT_ACCESS_SECRET,
    });
  }

  validate(payload: JwtPayload): AuthUser {
    if (!payload?.sub) throw new UnauthorizedException();
    return { userId: payload.sub, tenantId: payload.tid, userType: payload.typ };
  }
}
