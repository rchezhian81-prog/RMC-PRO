# Executive Architecture & Product Audit — Mix Nova RMC

> **The one document to read first.** It states the verdict, the evidence behind
> it, the scores, the top risks, the assumptions this audit made, and where to go
> next in the other eleven documents. Prepared 2026-08-09 on branch
> `claude/rmc-plant-saas-requirements-6df8ur` (HEAD `0d1d025`).
>
> **Scope & method:** eight parallel evidence-gathering passes over the repository
> (data model, API/RBAC, web, sync/integrations, DevOps/tests/security, SRS/design
> intent) plus external research (Indian RMC domain/competitors/compliance,
> architecture best practice). **Research and documentation only — no production
> changes, no secrets touched, no live host access.** Live-only facts reflect what
> the owner has previously confirmed on the box.

## 1. Verdict in five sentences

Mix Nova RMC has a **genuinely strong, correctly-built core** — DB-enforced
multi-tenant isolation done to the exact "safe recipe" the industry recommends, a
complete and owner-verified order-to-cash spine with correct GST maths, real
separation-of-duties RBAC, an append-only audit trail enforced by database
privilege, and conservative "block, don't auto-approve" guardrails. It is **let
down not by its design but by uneven, incomplete build-out** of everything around
that core: integrations are ~90% documented-but-not-built, offline sync is a real
but narrow and fragile MVP, and the operational/security posture (localStorage
tokens, plaintext secrets, no staging, no HA, no off-box backups, no
observability, zero unit tests) is below the bar for scaling to multiple paying
tenants. Autonomy today is a safe L0–L2 with no background actors — the right
place to start, not a weakness. **Requirements maturity is ~8/10; as-built
architecture maturity at the scale bar is ~5.5/10**, and the gap between them —
well-specified, unevenly implemented — is the entire story. None of the top risks
require touching the well-built data layer, which makes the path to 8 → 9 → 10
tractable and low-regret.

## 2. What is genuinely strong (keep, don't touch)

1. **Tenant isolation** — `FORCE ROW LEVEL SECURITY` on all 51 tenant tables,
   non-superuser `rmc_app` role, transaction-local tenant GUC from the JWT,
   `USING`+`WITH CHECK`, fail-closed on missing context. This **matches the
   benchmark's safe RLS recipe point-for-point** and is test-proven + owner-probed.
2. **Order-to-cash core** — quotation → order (credit control) → production →
   dispatch → challan → GST invoice → receipt → outstanding, proven live to
   ₹2,95,000 with correct CGST/SGST/IGST.
3. **RBAC with real separation of duties** — sales can't approve pricing, QC owns
   mix approval, auditor is view-only; subscription re-checked every request.
4. **Append-only audit as a privilege** + recursive secret redaction.
5. **Conservative guardrails** — credit hold, variance breach, negative stock all
   **block and route to a human**, never auto-approve.
6. **A real, tested offline MVP** with collision-safe reserved numbering.
7. **Unusually thoughtful ops for a pilot** — gated redeploy with a freshness
   guard, GFS backups, a rehearsed restore drill.

## 3. What is weak (the work ahead)

1. **Integrations are mostly DOC-ONLY** — no live e-invoice/e-way, payments, SMS,
   email, weighbridge, or batch-controller; the provider registry the design
   assumes doesn't exist. Compliance is manual/outside the system.
2. **Offline is narrow and fragile** — 3 of ~10 operations; a wall-clock sync
   cursor with a real lost-update path; no retry/backup/offline-auth/
   device-revocation.
3. **Security hygiene debt** — localStorage access+refresh tokens, no refresh
   rotation, weak default JWT secrets that can boot in prod, plaintext secrets on
   the host, no Helmet on the API, a few ungated write endpoints, fail-open
   provisioning.
4. **Reliability gaps** — single 4 GB box, no HA, no staging, manual deploy,
   off-box backups unconfigured, RPO/RTO unquantified, **no observability**.
5. **Testing gaps** — 0% unit coverage; the strongest isolation/RBAC/security
   tests exist only in a manual suite CI never runs.
6. **Two-way batch-controller integration and robust offline** — the domain's two
   hardest, most defensible differentiators — are exactly the areas not yet built.

## 4. Scores at a glance

| Lens | Score | Basis |
|---|---|---|
| **Requirements & documentation** | **8/10** | Thorough SRS v1.4 + 12 design docs + ops runbooks. |
| **Isolation / data / functional core** | **8–9/10** | Safe RLS, tested money path, real RBAC/audit. |
| **As-built architecture (scale bar)** | **~5.5/10** | Core dragged down by security hygiene, integrations, offline, testing, CI/CD, observability, HA. |
| **Autonomy** | **L0–L2, safe** | No background actors; block-not-approve; read-only AI. |

Full 18-dimension scorecard and risk register: `GAP_REGISTER_AND_RISK_REGISTER.md`.

## 5. Top risks (act on these first)

| Rank | Risk | Score | First move |
|---|---|---|---|
| 1 | Host loss → total outage + on-box backups lost | 15 | Configure off-box backups **now**; plan staging + managed/HA Postgres |
| 2 | Token/secret compromise (localStorage XSS, weak/plaintext secrets) | 15 | Fail-boot on default secrets; cookie auth + rotation; secrets vault |
| 3 | Silent offline data loss/dup (cursor & retry bugs) | 12 | Change-feed cursor + idempotency keys + version columns |
| 4 | Money/GST regression ships undetected | 12 | Unit-cover the money math; wire the manual test suite into CI |
| 5 | Cross-tenant leak via app-enforced tables; DPDP non-compliance; compliance blocker; scope mismatch | 9–10 | RLS on `users`/`tenant_modules`; DPDP consent/breach; provider registry; align sales to the traceability matrix |

## 6. The 8 → 9 → 10 path (one paragraph)

**To 8/10 (safe second tenant):** the days-long Wave 0 fixes (fail-boot on default
secrets, off-box backups, wire the test suite, gate the ungated endpoints) plus
the security/recoverability half of Wave 1 (cookie auth, secrets vault, staging,
money-math unit tests, basic observability). **To 9/10 (production-grade
multi-tenant):** data & tenancy hardening, offline robustness, PITR + quantified
RPO/RTO, CD, and the integration foundation (provider registry, queue, live
e-invoice/e-way with human sign-off, real messaging). **To 10/10 (scaling,
supervised-autonomous, enterprise):** hybrid tenancy with siloed enterprise
accounts + HA, the autonomy guardrail engine enabling L1–L3, full DPDP posture,
and i18n. Sequenced with dependencies in
`DEPENDENCY_AWARE_IMPLEMENTATION_ROADMAP.md`.

## 7. Assumption Register

Where a fact could not be established from the repo alone, this audit made a
**safe, explicit assumption** rather than guessing silently. Each should be
confirmed by the owner; none change the verdict.

| # | Assumption | Basis | If wrong |
|---|---|---|---|
| A1 | The live box runs the audited HEAD (`0d1d025`) | Owner confirmed prior deploys; freshness guard now enforces it | Some "IMPL/PROD" statuses shift; re-confirm with a live check |
| A2 | `rmc_owner` is a real Postgres **superuser** in production | Repo never `CREATE ROLE`s it; assumes the image bootstrap superuser | If it's a non-superuser owner, `FORCE RLS` breaks seed/repair — see data-model gap #5 |
| A3 | The pilot serves **one real tenant** today | Prior sessions | Multi-tenant load/noisy-neighbor risks arrive sooner |
| A4 | On-box ops scripts (backup/monitor/fail2ban/hardening cron) are **installed** on VM3 | Scripts exist; install is manual and unverifiable from the repo | Backups/monitoring may not be running — verify on the host |
| A5 | The installed Anthropic SDK/model actually supports `claude-opus-5` + `output_config` | Code targets it; can't verify from repo | AI endpoints 500 at call time — verify before selling AI |
| A6 | India compliance thresholds are as researched (e-invoicing **₹5 cr**, not ₹2 cr) | Authoritative CBIC source; ₹2 cr is an unconfirmed rumor | Re-verify against a CBIC notification before building IRN logic |
| A7 | "Production-verified" items reflect genuine prior owner runs | Owner pasted results in prior sessions | Reclassify to IMPL-UNVERIFIED and re-test |
| A8 | Off-box backup target is **not yet chosen** | `RMC_OFFBOX_*` unset in template | If already configured elsewhere, Wave 0 backup item is done |
| A9 | i18n is intended for a later phase despite SRS "architecture-ready" wording | No translation infra in code | If Phase-1 promised it, it's a missed commitment, not a deferral |

## 8. Decisions the owner needs to make

1. **Off-box backup target** — S3/Backblaze bucket, a second SSH host, or "not yet"
   (blocks Wave 0). *(This is the one item an earlier session was already waiting
   on.)*
2. **Offline breadth** — how much of the plant must run offline (drives the custom-
   outbox vs PowerSync decision, ADR-09).
3. **Infra direction** — stay on the single VPS vs move to managed/HA cloud
   Postgres (shapes staging, PITR, HA).
4. **AI go/no-go** — confirm the SDK/model surface before relying on AI
   commercially.
5. **Sales/scope alignment** — ensure collateral matches
   `REQUIREMENT_TRACEABILITY_MATRIX.md` (WhatsApp/e-invoice/i18n are not live).

## 9. Document index

| Document | What it answers |
|---|---|
| **EXECUTIVE_ARCHITECTURE_AUDIT.md** (this) | The verdict, scores, top risks, assumptions, next steps |
| `AS_IS_SYSTEM_ARCHITECTURE.md` | What is actually built, with per-capability status |
| `REQUIREMENT_TRACEABILITY_MATRIX.md` | Intended (SRS) vs built, with test evidence |
| `TARGET_HYBRID_ARCHITECTURE.md` | The to-be architecture and how we evolve to it |
| `AUTONOMOUS_PRODUCT_BLUEPRINT.md` | L0–L5 per capability + guardrail architecture |
| `SECURITY_PRIVACY_THREAT_MODEL.md` | STRIDE, tenant-isolation guarantee, DPDP, ASVS |
| `OFFLINE_SYNC_AND_CONFLICT_STRATEGY.md` | The sync bugs and the target strategy |
| `GAP_REGISTER_AND_RISK_REGISTER.md` | 0–10 scorecard, gap register, risk register |
| `TEST_AND_RESILIENCE_STRATEGY.md` | Test pyramid, DR/RPO/RTO, load, observability |
| `DEPENDENCY_AWARE_IMPLEMENTATION_ROADMAP.md` | Sequenced waves, 8→9→10 milestones |
| `ARCHITECTURE_DECISION_REGISTER.md` | ADRs (accepted, proposed, open) |
| `RESEARCH_SOURCES_AND_BENCHMARKS.md` | Domain/architecture evidence with sources |

## 10. Closing note

This is a product with an **excellent foundation and honest, well-understood
debt**. The most valuable thing the team can do now is resist adding features on
top of the strong core until the **days-long Wave 0 fixes and the recoverability/
security half of Wave 1** are in — because those close the top-five risks at very
low cost and without any change to the parts that are already right. Everything
after that is additive, sequenced, and low-regret.
