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
 * Placeholder for the real NIC / GSP adapter. The scaffold defines the seam and
 * the surrounding pipeline (build → validate → execute → persist → audit); the
 * live auth/AES-encryption handshake and the portal calls are the owner/
 * deployment portion, deliberately NOT implemented in-sandbox.
 *
 * `isConfigured()` reflects whether the deployment has supplied credentials, so
 * `GET /agents/gst` can show status honestly; every call throws NOT_IMPLEMENTED
 * with a pointer to the runbook until the adapter body is written. Follow
 * docs/deployment/INTEGRATION-RUNBOOK-00-gst-common.md §3 (auth) and
 * runbooks 01/02 (endpoints) to complete this class.
 */
export class NicGstProvider implements GstComplianceProvider {
  readonly name = 'nic';

  isConfigured(): boolean {
    return !!(
      process.env.GST_GSP_CLIENT_ID?.trim() &&
      process.env.GST_GSP_CLIENT_SECRET?.trim() &&
      process.env.GST_IRP_BASE_URL?.trim()
    );
  }

  private todo(): never {
    throw new GstProviderError(
      'NOT_IMPLEMENTED',
      'NIC/GSP adapter is not implemented yet — see docs/deployment/INTEGRATION-RUNBOOK-00-gst-common.md',
    );
  }

  async authenticate(_gstin: string): Promise<GstSession> {
    return this.todo();
  }
  async generateIrn(_session: GstSession, _request: IrnRequest): Promise<IrnResult> {
    return this.todo();
  }
  async cancelIrn(_session: GstSession, _irn: string, _reasonCode: string, _remarks: string): Promise<CancelResult> {
    return this.todo();
  }
  async generateEwayBill(_session: GstSession, _request: EwbRequest): Promise<EwbResult> {
    return this.todo();
  }
}
