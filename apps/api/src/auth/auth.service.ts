import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { TenantDbService } from '../core/database/tenant-db.service';
import { Tenant, User } from '../core/database/entities';

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
    const [tenant, permissions] = await Promise.all([
      this.loadTenant(user.tenantId),
      this.loadPermissions(user),
    ]);
    return { ...tokens, user: this.publicUser(user), tenant, permissions };
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

  async me(userId: string) {
    const user = await this.db.ds.getRepository(User).findOne({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    const [tenant, permissions] = await Promise.all([
      this.loadTenant(user.tenantId),
      this.loadPermissions(user),
    ]);
    return { user: this.publicUser(user), tenant, permissions };
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

  async loadPermissions(user: Pick<User, 'id' | 'tenantId'>): Promise<string[]> {
    if (!user.tenantId) return [];
    return this.db.runInTenant(user.tenantId, async (m) => {
      const rows: Array<{ key: string }> = await m.query(
        `SELECT DISTINCT p.permission_key AS key
         FROM user_roles ur
         JOIN role_permissions rp ON rp.role_id = ur.role_id
         JOIN permissions p ON p.id = rp.permission_id
         WHERE ur.user_id = $1`,
        [user.id],
      );
      return rows.map((r) => r.key);
    });
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
