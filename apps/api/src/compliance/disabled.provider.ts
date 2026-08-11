import type {
  CancelResult,
  EwbRequest,
  EwbResult,
  GstComplianceProvider,
  GstSession,
  IrnRequest,
  IrnResult,
} from './gst.types';
import { GstProviderError } from './gst.types';

/**
 * The default provider: OFF. `isConfigured()` is false, so the execution service
 * skips every job and the platform stays exactly prepare-only (M5) — no invoice
 * is ever mutated, nothing is transmitted. Selected whenever GST_PROVIDER is
 * unset or `disabled`. If somehow invoked, it throws rather than silently
 * pretending to succeed.
 */
export class DisabledGstProvider implements GstComplianceProvider {
  readonly name = 'disabled';

  isConfigured(): boolean {
    return false;
  }

  private off(): never {
    throw new GstProviderError('PROVIDER_DISABLED', 'GST provider is disabled (prepare-only mode)');
  }

  async authenticate(_tenantId: string, _gstin: string): Promise<GstSession> {
    return this.off();
  }
  async generateIrn(_session: GstSession, _request: IrnRequest): Promise<IrnResult> {
    return this.off();
  }
  async cancelIrn(_session: GstSession, _irn: string, _reasonCode: string, _remarks: string): Promise<CancelResult> {
    return this.off();
  }
  async generateEwayBill(_session: GstSession, _request: EwbRequest): Promise<EwbResult> {
    return this.off();
  }
}
