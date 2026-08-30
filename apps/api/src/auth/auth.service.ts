import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { MODULE_KEYS, passwordProblemMessage } from '@rmc/shared';
import { TenantDbService } from '../core/database/tenant-db.service';
import { Tenant, User } from '../core/database/entities';
import { loadUserAccess } from '../rbac/access';
import { TenantAccessService } from '../rbac/tenant-access.service';
import { JWT_ACCESS_SECRET, JWT_REFRESH_SECRET } from './jwt-secrets';

// Resolved once at startup; production refuses to boot on a default/weak secret.
const ACCESS_SECRET = JWT_ACCESS_SECRET;
const REFRESH_SECRET = JWT_REFRESH_SECRET;
const ACCESS_TTL = Number(process.env.JWT_ACCESS_TTL ?? 900);
const REFRESH_TTL = Number(process.env.JWT_REFRESH_TTL ?? 1_209_600);

const INVALID = { code: 'AUTH_REQUIRED', message: 'Invalid login credentials' };

@Injectable()
export class AuthService {
  constructor(
    private readonly db: TenantDbService,
    private readonly jwt: JwtService,
    private readonly access: TenantAccessService,
  ) {}

  async login(login: string, password: string) {
    // Identity lookup by email, before the tenant is known — and platform
    // super-admins carry tenant_id NULL. Runs in the platform context so the
    // RLS policy on `users` admits the row; a plain read would return nothing.
    const user = await this.db.runAsPlatform((m) =>
      m.getRepository(User).findOne({ where: { email: login } }),
    );
    if (!user || user.status !== 'active' || !bcrypt.compareSync(password, user.passwordHash)) {
      throw new UnauthorizedException(INVALID);
    }
    // Credentials are good, so say plainly that it is the company account that
    // is blocked. Answering "invalid login" here would send a plant clerk
    // hunting for a password problem that does not exist. Checked after the
    // password so the message cannot be used to probe which companies exist.
    if (user.tenantId) await this.access.assertUsable(user.tenantId);

    await this.db.runAsPlatform((m) =>
      m.getRepository(User).update(user.id, { lastLoginAt: new Date() }),
    );
    const tokens = await this.issueTokens(user);
    const [tenant, access, modules] = await Promise.all([
      this.loadTenant(user.tenantId),
      this.loadAccess(user),
      this.loadModules(user.tenantId),
    ]);
    return {
      ...tokens,
      user: this.publicUser(user),
      tenant,
      permissions: access.permissions,
      roles: access.roleKeys,
      modules,
    };
  }

  async refresh(refreshToken: string) {
    let sub: string;
    let presentedTokenVersion = 0;
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; tv?: number }>(refreshToken, {
        secret: REFRESH_SECRET,
      });
      sub = payload.sub;
      presentedTokenVersion = payload.tv ?? 0;
    } catch {
      throw new UnauthorizedException({ code: 'INVALID_TOKEN', message: 'Invalid refresh token' });
    }
    // Identity lookup by id — platform context so RLS admits the row.
    const user = await this.db.runAsPlatform((m) =>
      m.getRepository(User).findOne({ where: { id: sub } }),
    );
    if (!user || user.status !== 'active') throw new UnauthorizedException(INVALID);
    // A bumped token_version revokes every refresh token minted before it, so a
    // password change (or a future "sign out everywhere") stops a leaked token
    // being renewed. Tokens predating this feature carry no `tv` (read as 0) and
    // match the default, so they keep working until they naturally expire.
    if ((user.tokenVersion ?? 0) !== presentedTokenVersion) {
      throw new UnauthorizedException({
        code: 'SESSION_REVOKED',
        message: 'This session was signed out. Please sign in again.',
      });
    }
    // A suspension must also close the door on refresh, or a session started
    // before it would renew itself indefinitely.
    if (user.tenantId) await this.access.assertUsable(user.tenantId);
    return this.issueTokens(user);
  }

  /**
   * Change your own password. Requires the current one, so a walked-away
   * session cannot be used to lock the real owner out of their account.
   */
  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    // Identity lookup + credential update — platform context on both.
    const user = await this.db.runAsPlatform((m) =>
      m.getRepository(User).findOne({ where: { id: userId } }),
    );
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
    // Bump token_version so every refresh token issued before now is revoked —
    // a password change signs out other (and any leaked) sessions. The caller
    // keeps its short-lived access token until it expires (<=15 min), then signs
    // in again: the standard "re-authenticate after a password change" behaviour.
    await this.db.runAsPlatform((m) =>
      m.getRepository(User).update(user.id, {
        passwordHash: bcrypt.hashSync(newPassword, 10),
        tokenVersion: (user.tokenVersion ?? 0) + 1,
      }),
    );
    return { changed: true };
  }

  /**
   * Sign out: bump token_version so every refresh token minted before now is
   * revoked. The controller also clears the httpOnly cookie, but that alone would
   * leave a token captured before logout renewable for its full TTL. This is
   * sign-out-everywhere (all of the user's sessions) — the only server-side
   * revocation available without a per-session token store, and exactly the
   * "sign out everywhere" lever token_version was built for.
   */
  async signOut(userId: string): Promise<void> {
    const user = await this.db.runAsPlatform((m) =>
      m.getRepository(User).findOne({ where: { id: userId } }),
    );
    if (!user) return;
    await this.db.runAsPlatform((m) =>
      m.getRepository(User).update(user.id, { tokenVersion: (user.tokenVersion ?? 0) + 1 }),
    );
  }

  async me(userId: string) {
    // Identity lookup by id — platform context so RLS admits the row.
    const user = await this.db.runAsPlatform((m) =>
      m.getRepository(User).findOne({ where: { id: userId } }),
    );
    if (!user) throw new UnauthorizedException();
    const [tenant, access, modules] = await Promise.all([
      this.loadTenant(user.tenantId),
      this.loadAccess(user),
      this.loadModules(user.tenantId),
    ]);
    return {
      user: this.publicUser(user),
      tenant,
      permissions: access.permissions,
      roles: access.roleKeys,
      modules,
    };
  }

  private async issueTokens(user: User) {
    // The session-version claim (`tv`) lets a bumped token_version revoke tokens.
    const tv = user.tokenVersion ?? 0;
    const payload = { sub: user.id, tid: user.tenantId, typ: user.userType, tv };
    const access_token = await this.jwt.signAsync(payload, {
      secret: ACCESS_SECRET,
      expiresIn: ACCESS_TTL,
    });
    const refresh_token = await this.jwt.signAsync(
      { sub: user.id, tv },
      { secret: REFRESH_SECRET, expiresIn: REFRESH_TTL },
    );
    return { access_token, refresh_token };
  }

  private async loadTenant(tenantId: string | null) {
    if (!tenantId) return null;
    const t = await this.db.ds.getRepository(Tenant).findOne({ where: { id: tenantId } });
    return t ? { id: t.id, code: t.tenantCode, name: t.tenantName, status: t.status } : null;
  }

  /**
   * The module keys this tenant is entitled to, so the web app can leave out
   * menu entries the server would refuse. An unprovisioned tenant reports the
   * whole catalogue, matching what the guard actually allows — the menu must
   * never be stricter than the API, or a plant loses a screen it can still use.
   */
  private async loadModules(tenantId: string | null): Promise<string[]> {
    if (!tenantId) return [...MODULE_KEYS];
    const { modules, provisioned } = await this.access.entitlements(tenantId);
    return provisioned ? [...modules] : [...MODULE_KEYS];
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
