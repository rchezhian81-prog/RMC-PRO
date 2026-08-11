import { Body, Controller, Delete, Get, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../auth/auth-user';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../rbac/tenant.guard';
import { PermissionsGuard } from '../rbac/permissions.guard';
import { RequirePermissions } from '../rbac/permissions.decorator';
import { RequireModule } from '../rbac/module.decorator';
import { GstCredentialStore, type CredentialStatus } from './gst-credential-store.service';
import { GST_PROVIDER, GstProviderError, type GstComplianceProvider } from './gst.types';

interface SetCredentialsDto {
  gstin?: string;
  username?: string;
  password?: string;
}

/**
 * Manage a tenant's GST-portal credentials. Guarded by `settings.manage` (the
 * company owner bypasses). Every response is a REDACTED {@link CredentialStatus}
 * (GSTIN + test status) — the username, password, and ciphertext never leave the
 * server. Writes and the connectivity test are audited.
 */
@Controller('compliance/gst-credentials')
@RequireModule('billing')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
@RequirePermissions('settings.manage')
export class GstCredentialsController {
  constructor(
    private readonly store: GstCredentialStore,
    @Inject(GST_PROVIDER) private readonly provider: GstComplianceProvider,
  ) {}

  /** List configured GSTINs (redacted status only). */
  @Get()
  list(@CurrentUser() u: AuthUser): Promise<CredentialStatus[]> {
    return this.store.listStatuses(u.tenantId as string);
  }

  @Get(':gstin')
  async getOne(@CurrentUser() u: AuthUser, @Param('gstin') gstin: string): Promise<CredentialStatus> {
    const status = await this.store.getStatus(u.tenantId as string, gstin);
    return status ?? { gstin, configured: false, lastTestedAt: null, lastTestSuccess: null, lastTestMessage: null };
  }

  /** Create or replace the credentials for a GSTIN. Returns redacted status. */
  @Post()
  set(@CurrentUser() u: AuthUser, @Body() dto: SetCredentialsDto): Promise<CredentialStatus> {
    return this.store.setCredentials(u.tenantId as string, dto.gstin ?? '', dto.username ?? '', dto.password ?? '', u.userId);
  }

  @Delete(':gstin')
  remove(@CurrentUser() u: AuthUser, @Param('gstin') gstin: string): Promise<{ deleted: boolean }> {
    return this.store.deleteCredentials(u.tenantId as string, gstin, u.userId);
  }

  /**
   * Test connectivity: authenticate against the portal with the stored creds and
   * record the outcome. Returns redacted status; the password is never involved
   * in the response, and provider errors carry no secret.
   */
  @Post(':gstin/test')
  async test(@CurrentUser() u: AuthUser, @Param('gstin') gstin: string): Promise<CredentialStatus> {
    const tenantId = u.tenantId as string;
    const existing = await this.store.getStatus(tenantId, gstin);
    if (!existing) {
      return { gstin, configured: false, lastTestedAt: null, lastTestSuccess: null, lastTestMessage: 'no credentials configured' };
    }
    if (!this.provider.isConfigured()) {
      return (await this.store.recordTest(tenantId, gstin, false, 'GST provider is not enabled (prepare-only mode)', u.userId)) ?? existing;
    }
    try {
      await this.provider.authenticate(tenantId, gstin);
      return (await this.store.recordTest(tenantId, gstin, true, 'authenticated', u.userId)) ?? existing;
    } catch (e) {
      const message =
        e instanceof GstProviderError ? `${e.code}: ${e.message}` : e instanceof Error ? e.message : 'test failed';
      return (await this.store.recordTest(tenantId, gstin, false, message, u.userId)) ?? existing;
    }
  }
}
