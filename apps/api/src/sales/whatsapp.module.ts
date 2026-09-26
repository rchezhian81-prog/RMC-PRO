import { Global, Module } from '@nestjs/common';
import { TenantGuard } from '../rbac/tenant.guard';
import { PermissionsGuard } from '../rbac/permissions.guard';
import { WhatsAppService } from './whatsapp.service';
import { WhatsAppCredentialStore } from './whatsapp-credential-store.service';
import { WhatsAppSettingsController } from './whatsapp-settings.controller';

/**
 * WhatsApp share + Business API send. Global: sales, dispatch, billing and
 * purchase all share documents this way, and they must all see the same
 * connected account and the same "automatic sending" switch.
 */
@Global()
@Module({
  controllers: [WhatsAppSettingsController],
  providers: [WhatsAppService, WhatsAppCredentialStore, TenantGuard, PermissionsGuard],
  exports: [WhatsAppService, WhatsAppCredentialStore],
})
export class WhatsAppModule {}
