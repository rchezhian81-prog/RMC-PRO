import { Module } from '@nestjs/common';
import { GST_PROVIDER, type GstComplianceProvider } from './gst.types';
import { DisabledGstProvider } from './disabled.provider';
import { FakeGstProvider } from './fake.provider';
import { NicGstProvider } from './nic.provider';
import { GstExecutionService } from './gst-execution.service';

/**
 * India GST compliance execution (the scaffold for GW-2/3/4). Binds the active
 * provider from `GST_PROVIDER` and exposes `GstExecutionService`, which turns an
 * APPROVED IRN / e-way action into a real transmission + persistence.
 *
 * Default is `disabled` → prepare-only, unchanged from today. `fake` is a
 * deterministic offline provider for tests and demos; `nic` is the (held) live
 * adapter. TenantDbService + AuditService come from the global modules.
 */
function selectProvider(): GstComplianceProvider {
  switch ((process.env.GST_PROVIDER ?? 'disabled').toLowerCase()) {
    case 'fake':
      return new FakeGstProvider();
    case 'nic':
    case 'gsp':
      return new NicGstProvider();
    default:
      return new DisabledGstProvider();
  }
}

@Module({
  providers: [
    { provide: GST_PROVIDER, useFactory: selectProvider },
    GstExecutionService,
  ],
  exports: [GstExecutionService],
})
export class ComplianceModule {}
