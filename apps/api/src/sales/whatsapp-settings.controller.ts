import { Body, Controller, Delete, Get, Post, UseGuards } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../auth/auth-user';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../rbac/tenant.guard';
import { PermissionsGuard } from '../rbac/permissions.guard';
import { RequirePermissions } from '../rbac/permissions.decorator';
import { TenantDbService } from '../core/database/tenant-db.service';
import { Company } from '../core/database/entities';
import { WhatsAppCredentialStore, type WhatsAppStatus } from './whatsapp-credential-store.service';
import { WhatsAppService } from './whatsapp.service';

const tid = (u: AuthUser) => u.tenantId as string;

/**
 * Connect a company's WhatsApp Business account (Meta Cloud API). Guarded by
 * integrations.manage (the owner bypasses). Every response is the REDACTED
 * status — the access token never leaves the server.
 */
@Controller('integrations/whatsapp')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
@RequirePermissions('integrations.manage')
export class WhatsAppSettingsController {
  constructor(
    private readonly store: WhatsAppCredentialStore,
    private readonly whatsapp: WhatsAppService,
    private readonly db: TenantDbService,
  ) {}

  @Get()
  status(@CurrentUser() u: AuthUser): Promise<WhatsAppStatus> { return this.store.status(tid(u)); }

  @Post()
  set(@CurrentUser() u: AuthUser, @Body() dto: Record<string, string | null | undefined>): Promise<WhatsAppStatus> {
    return this.store.set(tid(u), {
      phoneNumberId: dto.phoneNumberId ?? undefined, accessToken: dto.accessToken ?? undefined,
      businessNumber: dto.businessNumber, templateName: dto.templateName, templateLanguage: dto.templateLanguage,
    }, u.userId);
  }

  @Delete()
  remove(@CurrentUser() u: AuthUser): Promise<{ deleted: boolean }> { return this.store.remove(tid(u), u.userId); }

  /** Send one real test message to a mobile number and say what happened. */
  @Post('test')
  async test(@CurrentUser() u: AuthUser, @Body() dto: { mobile?: string }) {
    const mobile = String(dto?.mobile ?? '').trim();
    const company = await this.db.runInTenant(tid(u), (m) => m.getRepository(Company).findOne({ where: { tenantId: tid(u) } }));
    const r = await this.whatsapp.sendTest(tid(u), mobile, company?.companyName ?? 'Your supplier');
    return { delivered: r.delivered, status: r.status, error: r.error, source: r.source, logId: r.log.id, providerMessageId: r.log.providerMessageId };
  }
}
