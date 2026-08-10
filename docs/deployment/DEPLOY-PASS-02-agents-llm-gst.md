# Deploy Pass 02 — Multi-Agent AI, Inbuilt Model, GST

> One ordered sequence to turn on the multi-agent capabilities in production. Each
> step says **who** runs it and **how to verify**. Steps are independent — do only
> the ones you want; the agents work deterministically with **none** of them.
>
> **Nothing here runs from CI/sandbox** — these are owner actions on the VPS. The
> code, tests, and this plan are ready; the live commands + credentials are yours.
> Companions: `INBUILT-LLM-RUNBOOK.md`, `INTEGRATION-RUNBOOK-00/01/02.md`,
> `DEPLOY-RUNBOOK-01-phase1-pilot.md`.

## 0. What you already have (no action)

- The 5 agents (Data-Analysis, Monitor, Specialist, Customer-Service, Automation)
  run **deterministically** — KPIs, alerts, compliance **prep**, approvals — at
  zero cost, no model, no external calls. Gated by `agents.manage` / `agents.approve`.
- Migrations through **#22** ship the agent tables (runs/steps/approvals + entity
  ref). Applied by the normal migrate step in `DEPLOY-RUNBOOK-01`.
- Everything below is **fail-safe off**: unset → the deterministic baseline.

Verify the baseline after any deploy (read-only):
```bash
LOGIN='owner@<DOMAIN>' RMC_PASSWORD='…' bash scripts/ops/verify-agents.sh
```

## Step A — Inbuilt AI model (recommended; no subscription)

**Who:** you, on the VPS. **Goal:** the reasoning/chat layer runs on a model you host.

1. Install a runtime + pull a **tool-capable** model (see `INBUILT-LLM-RUNBOOK.md` §2–3 for choices/resources):
   ```bash
   curl -fsSL https://ollama.com/install.sh | sh
   ollama serve                     # http://127.0.0.1:11434
   ollama pull qwen2.5:7b-instruct
   ```
2. Set on the API process (`.env.production`), then restart the API container:
   ```
   AGENT_LLM_PROVIDER=local
   AGENT_LLM_LOCAL_BASE_URL=http://127.0.0.1:11434/v1
   AGENT_LLM_LOCAL_MODEL=qwen2.5:7b-instruct
   ```
   > If the model runs on the host and the API in Docker, use the host gateway
   > (e.g. `http://host.docker.internal:11434/v1`) and confirm container→host reachability.
3. **Verify:**
   ```bash
   AGENT_LLM_LOCAL_BASE_URL=http://127.0.0.1:11434/v1 \
   LOGIN='owner@<DOMAIN>' RMC_PASSWORD='…' bash scripts/ops/verify-agents.sh
   ```
   Expect: backend **INBUILT local model**, reasoning layer **ON**, model endpoint
   **reachable**. Then a live ask:
   ```bash
   curl -s -X POST https://api.<DOMAIN>/api/v1/agents/specialist/ask \
     -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
     -d '{"message":"Any GST compliance gaps this month?"}'
   ```
   Watch the run land in `GET /api/v1/agents/runs`.
4. **Rollback:** unset `AGENT_LLM_LOCAL_BASE_URL` (or stop the model) → deterministic agents.

*(Opt-in hosted alternative: `AGENT_LLM_PROVIDER=anthropic` + `ANTHROPIC_API_KEY`. Metered/paid; never the default.)*

## Step B — GST live transmission (optional; needs a GSP)

**Who:** you + your GST Suvidha Provider. **Goal:** an APPROVED IRN/e-way action
actually transmits. Until this is done, the Automation agent PREPARES payloads for
approval and stops (safe).

1. **Implement the adapter** — fill each `TODO(deploy)` in
   `apps/api/src/compliance/nic.provider.ts`: endpoint paths, request/response
   field names, duplicate error codes, expiry parsing, and `resolveTenantCreds()`
   (per-tenant portal creds from your encrypted store). The crypto
   (`nic-crypto.util.ts`) and transport are done. Follow `INTEGRATION-RUNBOOK-00 §3–4` + `01/02`.
2. **Credentials** (vault / per-tenant encrypted store — never in the repo): GSP `client-id`/`client-secret`, portal public key, per-tenant GSTIN API user/password.
3. **Sandbox first** (mandatory): `GST_ENV=sandbox`, test GSTINs; run the sandbox
   plans in `INTEGRATION-RUNBOOK-01 §8` (IRN) and `02 §9` (e-way) end to end —
   prepare → approve → **execute** → persisted IRN/EWB → cancel.
4. **Go live:** set `GST_PROVIDER=nic`, `GST_ENV=production`, prod URLs/creds. Verify:
   ```bash
   LOGIN=… RMC_PASSWORD=… bash scripts/ops/verify-agents.sh   # gst mode: live NIC/GSP configured
   ```
   The `verify-agents.sh` check **fails loudly** if `GST_PROVIDER=fake` is ever seen in production.
5. **Rollback:** `GST_PROVIDER=disabled` → instant revert to prepare-only, no data loss, no migration.

> Execution path (already built): `POST /agents/approvals/:id/execute` (gated
> `agents.approve`) runs the transmit→persist onto the invoice. Idempotent,
> duplicate-reconciling, audited. The durable queue backbone (GW-1) is the
> follow-up that turns this operator/worker call into an automatic on-approval job.

## Step C — Kill switch & budgets (operational)

Per tenant, an admin (`agents.manage`) can pause all agent runs and cap steps/actions:
```
PUT /api/v1/agents/controls   { "automationPaused": true }         # kill switch
PUT /api/v1/agents/controls   { "maxStepsPerRun": 20, "maxActionsPerRun": 5 }
```
Use the kill switch as the fast "stop everything" during any incident.

## Go-live checklist

- [ ] Baseline: `verify-agents.sh` green; migrations through #22 applied.
- [ ] Step A: local model reachable; `/agents/:name/ask` returns a real answer; runs audited.
- [ ] Step B (if doing GST): sandbox end-to-end green (IRN + e-way, generate + cancel); prod creds vaulted; `verify-agents.sh` shows live NIC — and never `fake`.
- [ ] Kill switch tested (pause → runs refused → resume).
- [ ] Rollbacks confirmed (unset model → deterministic; `GST_PROVIDER=disabled` → prepare-only).
- [ ] Owner sign-off on one real ask + (if GST) one real IRN for a pilot tenant.

## Rollback summary (all one-flag, no migration)

| Turn off | How | Result |
|---|---|---|
| Inbuilt reasoning | unset `AGENT_LLM_LOCAL_BASE_URL` | deterministic agents only |
| Hosted reasoning | `AGENT_LLM_PROVIDER=local` (or unset key) | off the paid path |
| GST transmission | `GST_PROVIDER=disabled` | prepare-only (no transmission) |
| All agents (per tenant) | `PUT /agents/controls {automationPaused:true}` | every run refused |
