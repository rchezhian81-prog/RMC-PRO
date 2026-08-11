import { Logger, Module, type OnModuleInit } from '@nestjs/common';
import { GST_PROVIDER, type GstComplianceProvider } from './gst.types';
import { DisabledGstProvider } from './disabled.provider';
import { FakeGstProvider } from './fake.provider';
import { NicGstProvider } from './nic.provider';
import { GstExecutionService } from './gst-execution.service';
import { GstCredentialStore } from './gst-credential-store.service';
import { GstCredentialsController } from './gst-credentials.controller';
import { validateMasterKeyConfig } from './gst-cred-crypto.util';
import { TenantGuard } from '../rbac/tenant.guard';
import { PermissionsGuard } from '../rbac/permissions.guard';

/**
 * India GST compliance execution (the scaffold for GW-2/3/4). Binds the active
 * provider from `GST_PROVIDER` and exposes `GstExecutionService`, which turns an
 * APPROVED IRN / e-way action into a real transmission + persistence.
 *
 * Default is `disabled` → prepare-only, unchanged from today. `fake` is a
 * deterministic offline provider for tests and demos; `nic` is the live adapter,
 * which resolves each tenant's portal credentials from the encrypted
 * `GstCredentialStore`. TenantDbService + AuditService come from global modules.
 */
function selectProvider(store: GstCredentialStore): GstComplianceProvider {
  switch ((process.env.GST_PROVIDER ?? 'disabled').toLowerCase()) {
    case 'fake':
      return new FakeGstProvider();
    case 'nic':
    case 'gsp':
      return new NicGstProvider(store);
    default:
      return new DisabledGstProvider();
  }
}

@Module({
  controllers: [GstCredentialsController],
  providers: [
    GstCredentialStore,
    { provide: GST_PROVIDER, useFactory: selectProvider, inject: [GstCredentialStore] },
    GstExecutionService,
    TenantGuard,
    PermissionsGuard,
  ],
  exports: [GstExecutionService, GstCredentialStore],
})
export class ComplianceModule implements OnModuleInit {
  private readonly log = new Logger(ComplianceModule.name);

  /**
   * Startup validation (spec item 11): if GST_CRED_ENC_KEY is present, validate
   * its format now so a misconfigured deployment fails fast; if absent, log that
   * live credentials are disabled (their save/use path then blocks with a clear
   * error). The key itself is never logged.
   */
  onModuleInit(): void {
    const { configured } = validateMasterKeyConfig();
    this.log.log(
      configured
        ? 'GST credential encryption: configured (GST_CRED_ENC_KEY present and valid).'
        : 'GST credential encryption: NOT configured — set GST_CRED_ENC_KEY to store/use live portal credentials.',
    );
  }
}
