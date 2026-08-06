import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { passwordProblemMessage } from '@rmc/shared';
import { TenantDbService } from '../core/database/tenant-db.service';
import { Tenant, User } from '../core/database/entities';
import { loadUserAccess } from '../rbac/access';

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? 'change-me-access';
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? 'change-me-refresh';
const ACCESS_TTL = Number(process.env.JWT_ACCESS_TTL ?? 900);
const REFRESH_TTL = Number(process.env.JWT_REFRESH_TTL ?? 1_209_600);

const INVALID = { code: 'AUTH_REQUIRED', message: 'Invalid login credentials' };

@Injectable()
export class AuthService {
  constructor(
    private readonly db: TenantDbService,
    private readonly jwt: JwtService,
  ) {}

  async login(login: string, password: string) {
    const repo = this.db.ds.getRepository(User);
    const user = await repo.findOne({ where: { email: login } });
    if (!user || user.status !== 'active' || !bcrypt.compareSync(password, user.passwordHash)) {
      throw new UnauthorizedException(INVALID);
    }
    await repo.update(user.id, { lastLoginAt: new Date() });
    const tokens = await this.issueTokens(user);
    const [tenant, access] = await Promise.all([
      this.loadTenant(user.tenantId),
      this.loadAccess(user),
    ]);
    return {
      ...tokens,
      user: this.publicUser(user),
      tenant,
      permissions: access.permissions,
      roles: access.roleKeys,
    };
  }

  async refresh(refreshToken: string) {
    let sub: string;
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string }>(refreshToken, {
        secret: REFRESH_SECRET,
      });
      sub = payload.sub;
    } catch {
      throw new UnauthorizedException({ code: 'INVALID_TOKEN', message: 'Invalid refresh token' });
    }
    const user = await this.db.ds.getRepository(User).findOne({ where: { id: sub } });
    if (!user || user.status !== 'active') throw new UnauthorizedException(INVALID);
    return this.issueTokens(user);
  }

  /**
   * Change your own password. Requires the current one, so a walked-away
   * session cannot be used to lock the real owner out of their account.
   */
  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const repo = this.db.ds.getRepository(User);
    const user = await repo.findOne({ where: { id: userId } });
    if (!user) throw new UnauthorizedException(INVALID);
    if (!bcrypt.compareSync(currentPassword ?? '', user.passwordHash)) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Your current password is not correct.',
      });
    }
    const problem = passwordProblemMessage(newPassword ?? '');
    if (problem) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: problem });
    if (bcrypt.compareSync(newPassword, user.passwordHash)) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'The new password must be different from the current one.',
      });
    }
    await repo.update(user.id, { passwordHash: bcrypt.hashSync(newPassword, 10) });
    // Tokens already issued stay valid until they expire; the access token is
    // short-lived and the refresh token is held only by this same person.
    return { changed: true };
  }

  async me(userId: string) {
    const user = await this.db.ds.getRepository(User).findOne({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    const [tenant, access] = await Promise.all([
      this.loadTenant(user.tenantId),
      this.loadAccess(user),
    ]);
    return {
      user: this.publicUser(user),
      tenant,
      permissions: access.permissions,
      roles: access.roleKeys,
    };
  }

  private async issueTokens(user: User) {
    const payload = { sub: user.id, tid: user.tenantId, typ: user.userType };
    const access_token = await this.jwt.signAsync(payload, {
      secret: ACCESS_SECRET,
      expiresIn: ACCESS_TTL,
    });
    const refresh_token = await this.jwt.signAsync(
      { sub: user.id },
      { secret: REFRESH_SECRET, expiresIn: REFRESH_TTL },
    );
    return { access_token, refresh_token };
  }

  private async loadTenant(tenantId: string | null) {
    if (!tenantId) return null;
    const t = await this.db.ds.getRepository(Tenant).findOne({ where: { id: tenantId } });
    return t ? { id: t.id, code: t.tenantCode, name: t.tenantName, status: t.status } : null;
  }

  private loadAccess(user: Pick<User, 'id' | 'tenantId'>): Promise<{ roleKeys: string[]; permissions: string[] }> {
    if (!user.tenantId) return Promise.resolve({ roleKeys: [], permissions: [] });
    return loadUserAccess(this.db, user.tenantId, user.id);
  }

  private publicUser(user: User) {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      userType: user.userType,
      tenantId: user.tenantId,
    };
  }
}
