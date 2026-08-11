# GST Integration Runbook 03 — Sandbox Go-Live Checklist (IRP + e-way)

> The single, ordered checklist to take the GST integration from **prepare-only**
> to a **green sandbox run** and then to production, matched to the code as it
> ships today. Runbooks 00/01/02 explain the *why* and the field-level schema;
> this one is the *do-this-in-order* companion the owner + GSP execute together.
>
> - Common substrate, auth/crypto, idempotency, rollback → `INTEGRATION-RUNBOOK-00-gst-common.md`
> - IRN schema, cancel, error codes, sandbox plan → `INTEGRATION-RUNBOOK-01-irp-einvoice.md`
> - e-way Part A/B, Path A/B, sandbox plan → `INTEGRATION-RUNBOOK-02-eway-bill.md`
> - Higher-level deploy pass → `DEPLOY-PASS-02-agents-llm-gst.md` (Step B)
>
> **Default is safe.** With `GST_PROVIDER` unset the app is prepare-only — the
> Automation agent PREPARES payloads for human approval and stops. Nothing in this
> checklist transmits until you deliberately flip the provider AND supply
> credentials. Rollback is one flag (§9).

---

## 0. Where the code already is (your starting line)

Everything except the GSP-specific wire details and the credentials is built,
unit- and integration-tested against the deterministic **fake** provider:

| Piece | Where | State |
|---|---|---|
| Provider seam (`disabled` \| `fake` \| `nic`/`gsp`) | `apps/api/src/compliance/compliance.module.ts` (`selectProvider`) | Built. `GST_PROVIDER` selects it; default `disabled`. |
| Full INV-01 / EWB builders + pre-flight | `gst-payload.util.ts` (`buildIrnRequest`, `buildEwbRequest`, `validateIrnPreflight`, `validateEwbPreflight`) | Built + tested (unit `test/unit/gst-*`). |
| Live NIC/GSP adapter (handshake crypto, encrypted transport, §7 error/retry) | `nic.provider.ts`, `nic-crypto.util.ts`, `nic-protocol.util.ts` | Built. **`TODO(deploy)` seams remain** — see §6. |
| Execution service (approve → validate → transmit → persist → audit; idempotent, duplicate-reconciling) | `gst-execution.service.ts` | Built + integration-tested. |
| Path A (e-way inside the IRN call, opt-in via `payload.includeEway`) | preparer `agents/compliance.util.ts`; executor `gst-execution.service.ts` | Built + tested. |
| Encrypted per-tenant credential store (AES-256-GCM, fail-closed) | `gst-credential-store.service.ts`, `gst-cred-crypto.util.ts`, migration `1720000023000` | Built + tested. |
| Credential + connectivity-test endpoints | `gst-credentials.controller.ts` (`/compliance/gst-credentials…`) | Built. |
| Status endpoint | `GET /agents/gst` → `{ configured, provider }` | Built. |
| Execute endpoint | `POST /agents/approvals/:id/execute` (gated `agents.approve`) | Built. |
| Signed QR on invoice PDF; EWB no on challan PDF | `sales/pdf.service.ts` | Built (merged). |

**What is NOT yet built** — read before you plan the sandbox session so you don't
test a path that can't run:

- **Executable actions:** `einvoice_irn`, `eway_bill`, `einvoice_cancel`,
  `eway_cancel`, `eway_update_vehicle`, `eway_extend` (`GST_ACTION_KINDS` in
  `gst.types.ts`). The **full e-way lifecycle is now wired** — generate, cancel
  (24h window), Part-B vehicle update, and validity extension. Each is its own
  approval action with a reason code; the 24h cancel / 8h extension windows are
  portal-enforced. The execution service rejects any unknown `actionKind` with
  `NOT_GST_ACTION`.
- **Two execution paths, same idempotent core.** Approving a GST action ENQUEUES
  a durable job (GW-1, `gst_execution_jobs`). It runs either synchronously via
  `POST …/execute` (operator/worker call — reconciles the job) or via the
  background worker / an operator drain (`POST …/gst/jobs/drain`). The worker is
  **opt-in** (`GST_WORKER_ENABLED=true`); off by default, so a synchronous-only
  deployment is unchanged. Retries back off and dead-letter after `max_attempts`.
- **`GST_ENV` is documentary only** — no code reads it. Sandbox-vs-production is
  carried entirely by `GST_IRP_BASE_URL` / `GST_EWB_BASE_URL`. Setting `GST_ENV`
  does no harm and labels the deployment, but point the **base URLs** at sandbox.
- **Buyer pincode** is now sourced from the customer master (`customers.pincode`,
  validated 6-digit) → `BuyerDtls.Pin` / e-way `toPincode`. Existing customers
  carry a NULL pincode until edited; a missing/blank PIN is still dropped from the
  payload (`pinNum`), so **populate each B2B buyer's PIN** if your GSP marks it
  mandatory (surfaces as a portal reject on the sandbox `/test` otherwise).

---

## 1. Prerequisites (once, before the session)

- [ ] A GSP/ASP (or direct NIC) **sandbox** account: `client-id`, `client-secret`,
      the portal **RSA public key** (PEM), and a **sandbox portal user/password**
      for at least one **test GSTIN**. (Runbook 00 §2–3.)
- [ ] The pilot tenant has the **`billing` module enabled** — the credential
      controller is `@RequireModule('billing')`. Configuring credentials needs the
      **`settings.manage`** permission (the company owner bypasses).
- [ ] Executing an approval needs **`agents.approve`** (same human authority that
      approves it).
- [ ] A **32-byte master key** for credential encryption: `openssl rand -hex 32`.
      This is `GST_CRED_ENC_KEY`. Store it ONLY in the host env/secret store —
      never in the DB, repo, image, or logs. Losing it means re-entering every
      tenant's portal password (a key-version re-encrypt).

---

## 2. Set the environment (host / compose env — never the repo)

Names below are read by `nic.provider.ts` (`isConfigured()` + `env()`) and
`gst-cred-crypto.util.ts`. Values come from your GSP and `openssl`.

```bash
GST_PROVIDER=nic                 # flip from disabled → nic (or gsp)
GST_IRP_BASE_URL=https://<gsp-or-nic-sandbox-irp-host>
GST_EWB_BASE_URL=https://<gsp-or-nic-sandbox-eway-host>   # optional; defaults to IRP host
GST_GSP_CLIENT_ID=<from your GSP>
GST_GSP_CLIENT_SECRET=<from your GSP>
GST_RSA_PUBLIC_KEY_PEM="-----BEGIN PUBLIC KEY-----\n…\n-----END PUBLIC KEY-----"
GST_IRP_MAX_RETRIES=2            # optional; transient-failure backoff retries
GST_CRED_ENC_KEY=<openssl rand -hex 32>
# GST_ENV=sandbox                # label only — not read by code (see §0)
```

`isConfigured()` returns true only when **all four** of `GST_IRP_BASE_URL`,
`GST_GSP_CLIENT_ID`, `GST_GSP_CLIENT_SECRET`, `GST_RSA_PUBLIC_KEY_PEM` are set.
Missing any → `GET /agents/gst` reports `configured:false` and `/test` returns
"provider is not enabled".

Restart the API. On boot, `ComplianceModule.onModuleInit` validates the master
key format and logs **"GST credential encryption: configured …"** (or the NOT
message). A malformed `GST_CRED_ENC_KEY` fails fast here — check the log first.

---

## 3. Confirm the switch is live

```bash
# provider selected + fully configured?
curl -sS -H "Authorization: Bearer $TOKEN" https://api.<DOMAIN>/api/v1/agents/gst
# → { "success": true, "data": { "configured": true, "provider": "nic" } }

# or the bundled check (also fails loudly if it ever sees fake in prod):
LOGIN=… RMC_PASSWORD=… bash scripts/ops/verify-agents.sh     # §4 "gst mode: live NIC/GSP configured"
```

- [ ] `provider` = `nic` (or `gsp`), `configured` = `true`.

If `configured:false`, one of the four env vars in §2 is missing/blank — fix and
restart before going further.

---

## 4. Store the tenant's portal credentials (via the app, encrypted)

Per-tenant portal user/password are **never** env vars — they go through the
credential endpoint, which seals the password with AES-256-GCM before it touches
the DB. The response is always **redacted** (GSTIN + test status only).

```bash
# create/replace credentials for one test GSTIN
curl -sS -X POST https://api.<DOMAIN>/api/v1/compliance/gst-credentials \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"gstin":"<TEST_GSTIN>","username":"<portal-user>","password":"<portal-pass>"}'
# → { configured:true, lastTestedAt:null, lastTestSuccess:null, … }   (no secret echoed)

# list / inspect (redacted)
curl -sS -H "Authorization: Bearer $TOKEN" https://api.<DOMAIN>/api/v1/compliance/gst-credentials
```

- [ ] `POST` returns `configured:true` and **no** username/password in the body.
- [ ] Requires `settings.manage`; a non-privileged user gets 403 (expected).

Fail-closed behaviours to expect: a missing/invalid `GST_CRED_ENC_KEY` makes the
`POST` fail with a clear error and **writes nothing**; `resolve()` (used by the
provider) throws `NO_CREDENTIALS` when a GSTIN has none.

---

## 5. Connectivity test → then the end-to-end sandbox run

### 5a. `/test` — real handshake against the sandbox

```bash
curl -sS -X POST https://api.<DOMAIN>/api/v1/compliance/gst-credentials/<TEST_GSTIN>/test \
  -H "Authorization: Bearer $TOKEN"
# → { …, lastTestSuccess:true, lastTestMessage:"authenticated" }
```

This performs the actual RSA/AES auth (`nic.provider.authenticate`) against
`GST_IRP_BASE_URL` and records the outcome (audited, no secret). A failure comes
back as `lastTestSuccess:false` with a typed message (e.g. `AUTH_FAILED: …`) — the
first place the `TODO(deploy)` auth field names (§6) show up if they're wrong.

- [ ] `lastTestSuccess:true`. (This validates **IRP** connectivity + creds; the
      EWB base URL is exercised by the e-way run in 5c.)

### 5b. IRN — prepare → approve → execute (runbook 01 §8)

```bash
# 1) prepare (creates a pending einvoice_irn approval)
curl -sS -X POST …/api/v1/agents/automation/run \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"compliance":"einvoice","invoiceId":"<INV_ID>"}'
# → outcome.result.prepared.approvalId
# 2) approve
curl -sS -X POST …/api/v1/agents/approvals/<APPROVAL_ID>/decide \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"decision":"approved"}'
# 3) execute (transmit → persist)
curl -sS -X POST …/api/v1/agents/approvals/<APPROVAL_ID>/execute -H "Authorization: Bearer $TOKEN"
# → { status:"generated", reference:"<64-char IRN>", detail:{ ackNo, ackDate, ewayBillNo? } }
```

Seed the test invoice as runbook 01 §8.1: B2B, valid test GSTINs, a **6-digit
HSN on every line**, reconciling totals, real place-of-supply.

- [ ] `status:"generated"`, `reference` is 64 chars.
- [ ] Invoice now carries `irn`, `ack_number`, `ack_date`, `signed_qr_code`;
      `einvoice_status = generated`.
- [ ] The **signed QR decodes** to the IRN + key fields, and prints on the invoice
      PDF (already wired).
- [ ] Audit shows `gst.irn.generated` with the IRN + approver.
- [ ] **Idempotency:** re-`execute` the same approval → `already_generated` (no
      second call). Re-preparing the same DocNo and executing → duplicate `2150`
      **reconciled** onto the invoice, not double-filed.

### 5c. e-way — Path A and standalone (runbook 02 §9)

If the IRN invoice qualifies (consignment `> ₹50,000` and `distance_km > 0`), the
preparer sets `payload.includeEway` and step 5b **already filed the e-way in the
same IRN call (Path A)** — `detail.ewayBillNo` is populated and `eway_status =
generated`. Verify that, then exercise the **standalone** e-way path on a fresh
invoice that has NOT been through an IRN:

```bash
curl -sS -X POST …/api/v1/agents/automation/run \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"compliance":"eway","invoiceId":"<FRESH_INV_ID>"}'
# → approve → execute, as above
```

- [ ] Path A: the IRN invoice has `eway_bill_no` (12 digits) + `eway_valid_until`;
      `eway_status = generated`; audit `gst.eway.generated { via:"irn" }`.
- [ ] Standalone: fresh invoice → `status:"generated"`, `eway_bill_no` (12 digits),
      validity = `ceil(distance/200)` days; audit `gst.eway.generated`.
- [ ] EWB number prints on the **challan/dispatch** PDF (already wired).
- [ ] Negative (pre-flight, **no** portal call): missing HSN, malformed GSTIN,
      non-reconciling totals (IRN); value ≤ threshold, missing vehicle for road,
      `distance_km ≤ 0` (e-way) → each returns `failed` with a field message.

### 5d. Cancel — IRN and e-way (within 24h; runbook 01 §6 / 02 §7)

Cancellation is its own approval action, so a human authorises each one:

```bash
# cancel an IRN (reasonCode 1=Duplicate, 2=Data entry mistake, 3=Order cancelled, 4=Other)
curl -sS -X POST …/api/v1/agents/automation/run \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"compliance":"einvoice_cancel","invoiceId":"<INV_ID>","reasonCode":"3","remarks":"order cancelled"}'
# → approve → execute → { status:"cancelled", reference:"<IRN>" }
# e-way: compliance:"eway_cancel" (same shape)
```

- [ ] IRN cancel → `status:"cancelled"`; `einvoice_status = cancelled`; audit `gst.irn.cancelled`.
- [ ] e-way cancel → `status:"cancelled"`; `eway_status = cancelled`; audit `gst.eway.cancelled`.
- [ ] Idempotency: re-executing a cancelled action → `already_cancelled`.
- [ ] Guardrails: an invalid reason code is a **400** at the API; cancelling a
      not-yet-generated document returns `failed` (pre-flight, no portal call).

> The **24h window is portal-enforced** — a too-late cancel comes back as a portal
> rejection surfaced as `failed`. For an IRN past 24h, issue a **credit note** (its
> own IRN); an e-way simply lapses at `validUpto`.

### 5e. e-way Part-B update + validity extension (live e-way; runbook 02 §7)

Modify a **live** (generated, not cancelled) e-way bill in place — each its own approval:

```bash
# Part-B vehicle change (reasonCode 1=Breakdown, 2=Transshipment, 3=Others, 4=First-time)
curl -sS -X POST …/api/v1/agents/automation/run \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"compliance":"eway_update_vehicle","invoiceId":"<INV_ID>","vehicleNo":"TN09XY9999","reasonCode":"1","remarks":"breakdown"}'
# → approve → execute → { status:"updated", reference:"<EWB>", detail:{ vehicleNo, validUpto } }

# validity extension (reasonCode 1=Natural calamity, 2=Law&order, 3=Transshipment, 4=Accident, 99=Others)
curl -sS -X POST …/api/v1/agents/automation/run \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"compliance":"eway_extend","invoiceId":"<INV_ID>","remainingDistanceKm":120,"reasonCode":"4","remarks":"detour"}'
# → approve → execute → { status:"extended", reference:"<EWB>", detail:{ validUpto } }
```

- [ ] Vehicle update → `status:"updated"`; invoice `vehicle_no` changed;
      `eway_status` stays `generated`; audit `gst.eway.vehicle_updated`.
- [ ] Extend → `status:"extended"`; invoice `eway_valid_until` advanced;
      audit `gst.eway.extended`.
- [ ] Guardrails: modifying a not-`generated` e-way → `failed` (pre-flight); an
      out-of-set reason code or a `remainingDistanceKm ≤ 0` is a **400** at the API.

> The **8-hour extension window** (before/after expiry, goods in transit) is
> **portal-enforced** — a too-early/late extend surfaces as `failed`. Unlike
> generate/cancel, update/extend have **no terminal state**, so they are **not
> idempotent** — re-executing re-applies (matching reality: you can genuinely
> update the vehicle twice). Execute each once.

---

## 6. Confirm every `TODO(deploy)` seam against YOUR GSP

These are the exact points the skeleton cannot know without the GSP's spec. Diff
each current value against your GSP docs; if it differs, edit and add/adjust a
unit test in `test/unit/nic-protocol.test.mjs` (protocol) before re-running §5.

| Seam | File · line | Current (skeleton) value | Confirm |
|---|---|---|---|
| Endpoint paths | `nic.provider.ts` · `PATHS` (~L60) | `auth /eivital/v1.04/auth`, `irnGenerate /eicore/v1.03/Invoice`, `irnCancel /eicore/v1.03/Invoice/Cancel`, `ewbGenerate /ewaybillapi/v1.03/ewayapi` | Exact paths **and casing/version** (runbook 01 §4 lists lowercase `invoice`; NIC/GSP casing varies). |
| Auth request fields | `nic.provider.ts` · ~L91 | `UserName`, `Password`, `AppKey`, `ForceRefreshAccessToken` | Field names + casing your GSP expects. |
| Auth response fields | `nic.provider.ts` · ~L107 | `AuthToken`, `Sek`, `TokenExpiry` | Names of token / session-key / expiry in the decrypted `Data`. |
| HTTP headers | `nic.provider.ts` · ~L231 | `client-id`, `client-secret`, `Gstin`, `AuthToken` | Header names/casing (some GSPs use `Gstin` vs `gstin`, bearer vs `AuthToken`). |
| Cancel request fields (IRN) | `nic.provider.ts` · `cancelIrn` | `Irn`, `CnlRsn`, `CnlRem` | Confirm the IRN-cancel field names. |
| Cancel request fields (e-way) | `nic.provider.ts` · `cancelEwayBill` | `ewbNo`, `cancelRsnCode`, `cancelRmrk` (path `…/ewayapi/canewb`) | Confirm the e-way cancel field names + path (some GSPs fold cancel into `ewayapi` via an action code). |
| Vehicle-update fields (VEHEWB) | `nic.provider.ts` · `updateEwayVehicle` | `ewbNo`, `vehicleNo`, `fromPlace`, `fromState`, `reasonCode`, `reasonRem`, `transMode`, `transDocNo/Date` (path `…/ewayapi/vehewb`) | Confirm field names + path (often an action code on `ewayapi`). |
| Extend-validity fields (EXTENDVALIDITY) | `nic.provider.ts` · `extendEwayValidity` | `ewbNo`, `remainingDistance`, `extnRsnCode`, `extnRemarks`, `consignmentStatus`, `transitType` (path `…/ewayapi/extendvalidity`) | Confirm field names + path; `fromPlace`/`fromState` come from the seller profile. |
| RSA public key format | `nic-crypto.util.ts` · ~L26 | expects PEM in `GST_RSA_PUBLIC_KEY_PEM` | If your GSP hands a base64/DER cert, convert to PEM once at deploy. |
| Buyer pincode | `customers.pincode` → `loadContext` | sourced (6-digit, validated) | Populate each B2B buyer's PIN; a blank one is dropped from the payload. |
| Duplicate / error codes | `nic-protocol.util.ts` (`NIC_CODES`, `classify`, `extractDuplicate*`) | NIC §7 codes (e.g. `2150` duplicate IRN) | Confirm the codes your GSP surfaces for duplicate / auth-expired / rejected. |

A GSP that fronts NIC with plain JSON + OAuth bearer (no RSA/AES) makes the
adapter *thinner*, not different — keep the same interface; adjust `authenticate`
+ `post` and drop the crypto wrap.

---

## 7. Observability during the run

- Watch the run land: `GET /api/v1/agents/runs` and the approval's audit trail.
- Audit actions to expect: `gst.credentials.created/tested`, `gst.irn.generated`,
  `gst.eway.generated` (with `via:"irn"` for Path A), `gst.irn.reconciled` /
  `gst.eway.reconciled` on duplicates, `gst.execute.failed` on pre-flight/transport
  failure — each linked to the `approvalId` + approver.
- **Never** log decrypted payloads, tokens, `Sek`, or credentials (the adapter
  doesn't; keep it that way in any edits).
- **Metrics** on `/metrics` (token-gated): `gst_transmissions_total{action,result,
  provider}` (every generate/cancel/update/extend outcome), `gst_execution_seconds`
  (execute duration histogram), and `gst_jobs_total{event}` (queue lifecycle:
  enqueued/done/retried/deadlettered/skipped). Point Prometheus/Grafana at these
  for a failure-rate panel and a queue-depth alert.
- **Alerts** flow through the existing ops alerter (`ALERT_WEBHOOK_URL` + the
  always-on `{"level":"alert"}` log line, deduped/circuit-broken): `gst_auth_failed`
  when the portal rejects credentials, and `gst_job_deadlettered` when a job
  exhausts its retries. A "queue stuck / rising" alert is a Prometheus rule over
  `gst_jobs_total` — no extra code.

---

## 8. Sandbox → production

Only after a **clean sandbox run** (§5 green, incl. duplicate-reconcile):

- [ ] Request production API access from the GSP; get prod `client-id/secret` +
      prod base URLs. **No production credential is created before sandbox is green.**
- [ ] Point `GST_IRP_BASE_URL` / `GST_EWB_BASE_URL` at production; set prod
      `GST_GSP_CLIENT_ID/SECRET`. Keep `GST_PROVIDER=nic`.
- [ ] Each pilot tenant re-enters its **production** portal user/password via the
      credential endpoint (§4), then `/test` → success.
- [ ] `verify-agents.sh` → "gst mode: live NIC/GSP configured"; it **fails loudly**
      if `GST_PROVIDER=fake` is ever seen in production.
- [ ] Owner sign-off on **one real production invoice** (IRN) and **one real
      dispatch** (e-way) for one pilot tenant.

---

## 9. Rollback (instant, zero-migration)

Set **`GST_PROVIDER=disabled`** and restart. The app reverts to prepare-only:
approvals stop executing, nothing transmits, no data is lost, pending items simply
wait. This is the whole reason execution sits behind a provider token. The stored
(encrypted) credentials are untouched and resume working when you re-enable.

---

## 10. Go-live gate (supersedes runbook 00 §10 for what's now built)

Done in code (verify, don't rebuild):

- [x] Full INV-01 / EWB payload mapping + pre-flight — built + unit-tested.
- [x] Execution service: approve → transmit → persist → audit; idempotent +
      duplicate-reconciling.
- [x] Encrypted per-tenant credential store (fail-closed) + endpoints + `/test`.
- [x] Signed QR on invoice PDF; EWB no on challan PDF.
- [x] Rollback is one flag (§9).

Owner + GSP actions (this checklist):

- [ ] Sandbox creds working; every `TODO(deploy)` seam confirmed (§6).
- [ ] Sandbox end-to-end green: IRN generate + duplicate-reconcile; e-way Path A +
      standalone; IRN + e-way **cancel**; e-way **vehicle update + extend**; QR
      decodes; EWB on challan; negatives rejected in pre-flight.
- [ ] Prod creds issued + vaulted; one pilot invoice + dispatch signed off (§8).

Known fast-follows (not blockers for a sandbox pass, decide before broad rollout):

- [x] Full e-way lifecycle wired: generate, cancel, Part-B vehicle update, extend.
- [x] Durable on-approval execution queue (GW-1): approve enqueues a job; a
      worker (opt-in `GST_WORKER_ENABLED`) or an operator drain processes it with
      backoff + dead-letter; the synchronous `execute` still works and reconciles.
- [x] Metrics + alerts (runbook 00 §9): `gst_transmissions_total` /
      `gst_execution_seconds` / `gst_jobs_total` on `/metrics`; `gst_auth_failed`
      + `gst_job_deadlettered` ops alerts via the existing webhook alerter.
- [x] Buyer pincode sourced from the customer master (`customers.pincode` →
      `BuyerDtls.Pin` / e-way `toPincode`), validated 6-digit.
