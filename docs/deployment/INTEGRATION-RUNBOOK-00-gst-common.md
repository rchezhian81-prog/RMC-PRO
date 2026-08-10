# GST Integration Runbook 00 — Common Substrate (IRP + e-way)

> How the live India GST integrations attach to what is **already built**, and the
> shared plumbing both of them need: provider abstraction, auth/encryption, the
> approval→execution step, secrets, idempotency, config, observability, go-live
> gate, rollback.
>
> Companions: `INTEGRATION-RUNBOOK-01-irp-einvoice.md` (IRN),
> `INTEGRATION-RUNBOOK-02-eway-bill.md` (e-way). Design source:
> `docs/audit/MULTI_AGENT_SYSTEM_ARCHITECTURE.md` §6.1; gaps GW-1/2/3/4,
> requirements WR-TAX-12 (e-invoice) / WR-TAX-13 (e-way).
>
> **Status: held for deployment.** Nothing here calls a government portal from the
> sandbox. The app today *prepares* payloads for human approval and stops; this
> runbook is the plan to turn an **approved** action into a real transmission,
> executed with the owner at deployment. No secrets appear in this repo.

## 1. What is already built (no action needed)

The multi-agent M5 milestone (merged) gives you the whole pipeline **up to, but
not including, the network call**:

| Piece | Where | State |
|---|---|---|
| Deterministic payload builders (`buildEinvoicePayload`, `buildEwayPayload`, `ewayValidityDays`) | `apps/api/src/agents/compliance.util.ts` | Built. Marked "READY-ONLY" — a *subset* of the government schema (see §6). |
| Prepare tools (`automation.prepare_einvoice`, `automation.prepare_eway`) | `apps/api/src/agents/automation.agent.ts` | Built. Each creates a `pending` row in `agent_approval_requests` with `actionKind` = `einvoice_irn` / `eway_bill`; class recorded as `legal`. |
| Human approval gate | `POST /agents/approvals/:id/decide` (`agents.approve`) | Built. Decided once; a second decision 409s. **Approval currently does nothing downstream** — that is the gap this runbook closes. |
| Persistence columns for the government response | `invoices` table (`billing.entities.ts`) | **Already present** — `irn`, `ack_number`, `ack_date`, `signed_qr_code`, `einvoice_status`, `eway_bill_no`, `eway_bill_date`, `eway_valid_until`, `distance_km`, `transport_mode`, `transporter_name`, `vehicle_no`, `eway_status`. No migration needed to store results. |
| Audit trail | `audit_logs` + `agent_runs`/`agent_run_steps` | Built. Every prepare/approve is already audited; the execution step reuses the same trail. |

So the remaining work is narrow: **an execution service that, on approval, calls
the provider and writes the response into the columns above** — plus the
credentials to do it.

> **Update — the execution scaffold is now built** (`apps/api/src/compliance/`,
> migration 22). The provider interface, the disabled default, a deterministic
> **fake** provider, the pure full-schema INV-01/EWB builders + pre-flight
> validators, and `GstExecutionService` (approve → validate → transmit → persist →
> audit, idempotent + duplicate-reconciling) all exist and are unit/integration-
> tested against the fake. `GET /agents/gst` reports status; `POST /agents/approvals/:id/execute`
> runs it. **Only two things remain for go-live:** implement `nic.provider.ts`
> against your GSP (§3–4 + runbooks 01/02), and supply credentials (§7). Set
> `GST_PROVIDER=nic` to switch on; it defaults to `disabled` (prepare-only).
>
> **Update 2 — `nic.provider.ts` is now a fill-in-the-blanks skeleton.** The
> handshake crypto is implemented and unit-tested (`nic-crypto.util.ts`:
> AppKey / RSA-PKCS1 / AES-256-ECB), and the encrypted transport (wrap → POST →
> unwrap → error/duplicate map), the per-GSTIN session cache, and the thin
> business methods are all in place. What is left is marked with `TODO(deploy)` at
> each seam: the exact endpoint **paths**, request/response **field names**, the
> duplicate **error codes**, expiry parsing, and — the one piece the scaffold
> cannot supply — `resolveTenantCreds()`, which must read each tenant's portal
> username/password from the encrypted per-tenant store (§7). Confirm every
> `TODO(deploy)` against your GSP and run the sandbox plan (runbooks 01/02 §8–9)
> before setting `GST_PROVIDER=nic`.

## 2. Decision: go through a GSP/ASP, behind one interface (GW-1)

India exposes two government systems — the **IRP** (Invoice Registration Portal,
run by NIC and others) for e-invoice/IRN, and the **EWB** (e-way bill) system.
You can reach them two ways:

- **Direct NIC API** — requires the taxpayer's GSTIN to be whitelisted for direct
  API access (generally only large taxpayers) or that you are a registered GSP.
  Sandbox: `einv-apisandbox.nic.in` (IRP), the EWB sandbox for e-way.
- **Through a GSP/ASP** (GST Suvidha / Application Service Provider — e.g. Clear,
  Masters India, IRIS, Cygnet, TaxPro, Zoho, and others). The GSP holds the NIC
  relationship; you integrate against the GSP's REST API. This is the realistic
  path for RMC SMB tenants.

**Recommendation:** integrate through **one GSP** for both IRP and EWB, hidden
behind a single provider interface so the business code never sees GSP specifics
and the GSP can be swapped without a rewrite. This is exactly the provider-
registry pattern (GW-1) and mirrors the LLM provider seam shipped in LLM-1.

```ts
// apps/api/src/compliance/gst-provider.interface.ts  (to build)
export interface GstComplianceProvider {
  readonly name: string;
  isConfigured(): boolean;                        // false → prepare-only, like today
  authenticate(gstin: string): Promise<GstSession>;// cached; ~6h token
  generateIrn(session, payload): Promise<IrnResult>;
  cancelIrn(session, irn, reasonCode, remarks): Promise<CancelResult>;
  generateEwayBill(session, payload): Promise<EwbResult>;
  generateEwayFromIrn(session, irn, partB): Promise<EwbResult>;
  updateVehicle(session, ewbNo, partB): Promise<void>;   // Part-B update
  extendValidity(session, ewbNo, input): Promise<EwbResult>;
  cancelEwayBill(session, ewbNo, reasonCode, remarks): Promise<CancelResult>;
}
```

Bind the active implementation behind a token (`GST_PROVIDER`), default
**disabled** → the app behaves exactly as it does today (prepare-only). A
`NicDirectProvider` and a `GspProvider` are the two concrete adapters; start with
whichever your GSP contract gives you.

## 3. Auth & encryption — the NIC pattern (understand it even via a GSP)

NIC's IRP and EWB APIs share an envelope. A GSP may hide this behind a plain
bearer token; if you go direct you implement it. Either way the adapter owns it:

1. **Authenticate.** `POST {base}/…/auth` with a body whose `Data` is an
   **RSA-encrypted** JSON containing your `UserName`, `Password`, `AppKey`
   (a random **32-byte AES-256 key you generate**) and `ForceRefreshAccessToken`.
   RSA public key + `client_id`/`client_secret` come from the GSP/NIC.
2. **Session key.** The response returns `AuthToken`, `TokenExpiry` (~6 hours),
   and `Sek` — your session key, **AES-encrypted with your AppKey**. Decrypt `Sek`
   with the AppKey; that decrypted value is the **AES-256/ECB session key** for
   everything else.
3. **Every business call** (generate/cancel/…) sends `{ "Data": "<base64 of AES(Sek, payloadJson)>" }`
   with headers `client-id`, `client-secret`, `Gstin`, `AuthToken`. The response
   `Data` is AES-encrypted with the same `Sek`; decrypt to read `Irn`, `SignedQRCode`, etc.

**Adapter responsibilities:** generate a fresh `AppKey` per auth; cache the
decrypted `Sek` + `AuthToken` per **tenant GSTIN** until ~5 min before expiry;
refresh on `401`/token-expired; never log keys, tokens, or decrypted payloads.

> If the GSP gives you plain JSON + OAuth bearer (no RSA/AES), the adapter is
> thinner — but keep the same interface so the rest of the system is identical.

## 4. The execution step — approval → transmit → persist

This is the one new moving part. Do **not** call the portal inline in the
`/decide` request thread — government APIs are slow and rate-limited; a synchronous
call would tie up the request and lose the result on a timeout.

```
POST /agents/approvals/:id/decide  (decision = approved, actionKind ∈ {einvoice_irn, eway_bill})
   └─► enqueue GstExecutionJob { tenantId, invoiceId, actionKind, approvalId }   ← durable queue
        └─► worker (runs in runInTenant, audited):
             1. load invoice + items; re-validate (§ per-integration "pre-flight")
             2. build the FULL government payload (not the READY-ONLY subset)
             3. provider.authenticate(gstin)  → cached session
             4. provider.generateIrn / generateEwayBill(...)
             5. on success: write irn/ack_*/signed_qr_code + einvoice_status='generated'
                          (or eway_bill_no/eway_bill_date/eway_valid_until + eway_status='generated')
             6. on failure: einvoice_status/eway_status='failed', record error, retriable
             7. audit the transmit (action gst.irn.generated / gst.eway.generated) + link approvalId
```

- **Queue:** the shared external-action queue/backbone is GW-1. Until it lands, a
  DB-backed job table (`gst_execution_jobs`: id, tenant_id, invoice_id, action_kind,
  status, attempts, last_error, created_at) polled by a worker is enough and is
  the lowest-risk first cut. Keep it tenant-scoped (RLS) like everything else.
- **Status model on the invoice:**
  `not_generated` → `queued` → `generated` | `failed` (retriable) → (for IRN) `cancelled`.
- **Approval stays the human gate.** Execution after approval is deterministic and
  fully audited; no agent ever transmits without a human `approved` decision.

## 5. Idempotency & reconciliation (do not double-file)

- Key every job by **(tenant_id, invoice_id, action_kind)** — at most one live
  execution per invoice per action. A unique partial index enforces it.
- The **IRP is itself idempotent**: re-submitting the same seller-GSTIN + DocType +
  DocNo returns the *existing* IRN with error **2150 "Duplicate IRN"** (and the
  IRN + signed QR in the error payload). The adapter treats 2150 as **success**,
  reconciles the returned IRN onto the invoice, and closes the job. Same idea for
  EWB duplicate detection.
- On worker crash mid-call: the job is still `queued`/`running`; on restart it
  re-submits and the duplicate-detection above makes that safe.
- **Never** auto-generate on invoice edit — generation is only ever triggered by an
  approved approval request.

## 6. Payload gap — "READY-ONLY" subset → full government schema

`compliance.util.ts` builds an intentionally *partial* payload (enough to review,
not to file). Before go-live these fields must be sourced and mapped (the columns
mostly exist; some come from the company/tenant profile and invoice lines):

| Needed by the portal | Source | Present today? |
|---|---|---|
| Seller legal name, GSTIN, address, pincode, state code | Company profile | Yes (company entity) |
| Buyer legal name, GSTIN, address, pincode, state code, place of supply | Customer + invoice | Partial — ensure buyer address/pincode/state code captured |
| Per-line HSN/SAC (6-digit), qty, unit, unit price, GST rate, taxable, tax | `invoice_items` | HSN alerted on if missing (specialist); confirm rate/unit per line |
| Reverse-charge / export flags, document type (INV/CRN/DBN) | Invoice | Confirm mapping |
| Round-off, total invoice value, total tax | Invoice | Yes |

Extend the builders (or add `buildIrnRequest` / `buildEwbRequest` in the compliance
module) to the full INV-01 / EWB schema; unit-test the mapping deterministically
exactly as the M5 builders are tested today (`test/unit/agent-compliance.test.mjs`).

## 7. Secrets & config (owner action — held)

**Never commit any of these.** Store platform GSP creds in the secrets vault
(GW-16); store per-tenant GSTIN API creds **encrypted in the DB on the tenant/
company record** (they belong to the tenant, not the platform), configured through
the app, never in env.

Env var **names** (values set on the VPS / vault at deploy):

| Var | Meaning |
|---|---|
| `GST_PROVIDER` | `disabled` (default; prepare-only) · `nic` · `gsp_<name>` |
| `GST_ENV` | `sandbox` · `production` |
| `GST_IRP_BASE_URL` / `GST_EWB_BASE_URL` | portal/GSP base URLs (sandbox vs prod) |
| `GST_GSP_CLIENT_ID` / `GST_GSP_CLIENT_SECRET` | GSP application credentials (vault) |
| `GST_RSA_PUBLIC_KEY_PEM` | portal public key for the auth handshake (if direct) |

Per-tenant (encrypted DB, not env): GSTIN, portal API `username`/`password`.
Rotation: GSP creds rotate on the GSP's schedule; per-tenant creds rotate when the
tenant regenerates API access on the portal — the app must let a tenant admin
re-enter them.

## 8. Sandbox / UAT first (mandatory)

1. Point `GST_ENV=sandbox` at the NIC sandbox (or GSP UAT) with **test GSTINs**.
2. Run the full path end-to-end in sandbox: prepare → approve → execute → persisted
   IRN/EWB → cancel. Verify the signed QR decodes and the values reconcile.
3. Only after a clean sandbox run does the owner request production API access and
   set prod credentials. **No production credential is created before sandbox is green.**

## 9. Observability & alerting

- Metrics (reuse the hand-rolled Prometheus registry): counters
  `gst_irn_generated_total`, `gst_irn_failed_total`, `gst_eway_generated_total`,
  `gst_eway_failed_total`; histogram `gst_provider_call_ms`.
- Audit every transmit with the government reference (IRN / EWB no) and the
  `approvalId` it came from.
- Alert (existing 5xx alerter path) on: auth failures, failure-rate spike, and any
  job stuck `queued` beyond N minutes.
- **Never** log decrypted payloads, tokens, `Sek`, or credentials.

## 10. Go-live gate (both integrations)

- [ ] GSP contract signed; sandbox creds working; prod creds issued and vaulted.
- [ ] Full payload mapping complete and unit-tested (§6).
- [ ] Sandbox end-to-end green: generate + cancel, IRN + e-way, QR decodes.
- [ ] Execution queue + idempotency index in place; worker deployed.
- [ ] Persistence writes the invoice columns; statuses transition correctly.
- [ ] Cancellation paths wired (24h window) with credit-note fallback documented.
- [ ] Alerts + metrics live; audit shows government reference + approver.
- [ ] Rollback verified (§11).
- [ ] Owner sign-off on a real invoice in production for one pilot tenant.

## 11. Rollback

Set `GST_PROVIDER=disabled`. The app instantly reverts to **prepare-only** (M5):
approvals stop executing, nothing is transmitted, no data is lost, pending items
simply wait. This is a one-flag, zero-migration rollback — the reason the
execution step is isolated behind a provider token.
