# Architecture Decision Register — Mix Nova RMC

> ADRs for the decisions that shape the target architecture. Each records
> **context → decision → status → consequences**, and separates decisions
> **already made and validated** (existing code) from decisions **proposed by
> this audit** (need owner sign-off). Status: `ACCEPTED` (in code, endorsed),
> `PROPOSED` (audit recommendation), `OPEN` (needs an owner business decision).

## Index

| ADR | Title | Status |
|---|---|---|
| ADR-01 | Pooled multi-tenancy via PostgreSQL RLS | ACCEPTED |
| ADR-02 | Non-superuser app role + FORCE RLS + transaction-local GUC | ACCEPTED |
| ADR-03 | Append-only audit via DB privilege | ACCEPTED |
| ADR-04 | Block-not-approve guardrails; no background actors (L0–L2) | ACCEPTED |
| ADR-05 | Monorepo: NestJS + Next.js + Electron plant app | ACCEPTED |
| ADR-06 | Manual gated deploy, images built off-box | ACCEPTED (interim) |
| ADR-07 | Evolve to hybrid tenancy (pool → silo) | PROPOSED |
| ADR-08 | Offline sync: change-feed + idempotency + versioning | PROPOSED |
| ADR-09 | Offline build-vs-buy: custom outbox vs PowerSync | OPEN |
| ADR-10 | Cookie-based auth + refresh rotation | PROPOSED |
| ADR-11 | Integration provider registry + job queue + webhooks | PROPOSED |
| ADR-12 | Autonomy guardrail engine; hard ceiling L4 for money/legal/safety | PROPOSED |
| ADR-13 | Add staging + CD; keep manual redeploy as break-glass | PROPOSED |
| ADR-14 | Secrets manager + at-rest encryption | PROPOSED |
| ADR-15 | e-invoice/e-way: prepare (L2 sign-off) then transmit (L3 job) | PROPOSED |

---

## ADR-01 — Pooled multi-tenancy via PostgreSQL RLS
**Status:** ACCEPTED (in code).
**Context:** Many small-to-mid RMC companies as tenants; low onboarding cost and
density matter at pilot; strong isolation is a hard requirement.
**Decision:** Shared schema, `tenant_id` on every tenant table, PostgreSQL
Row-Level Security as the isolation boundary.
**Consequences:** Best density/cost; widest blast radius and hardest per-tenant
restore (mitigated by ADR-07). Independent research endorses pooled-RLS as the
correct pilot→scale starting point.

## ADR-02 — Non-superuser app role + FORCE RLS + transaction-local GUC
**Status:** ACCEPTED.
**Context:** RLS is only as safe as the role and session handling around it; the
research names `SET` vs `SET LOCAL` under pooling as the #1 correctness bug.
**Decision:** App connects as `rmc_app` (no SUPERUSER, no BYPASSRLS); every table
has `FORCE ROW LEVEL SECURITY`; the tenant GUC is set **transaction-locally**
(`set_config(..., true)`) from the JWT `tid`; policies use `USING`+`WITH CHECK`
and fail closed on a missing GUC.
**Consequences:** Cross-tenant leakage is prevented by the database even under an
app bug; superuser (`rmc_owner`) is reserved for migrations/seed. **Follow-up
(ADR-07/security):** `users` and `tenant_modules` lack RLS; single-column FKs
don't enforce tenant co-membership — close these.

## ADR-03 — Append-only audit via DB privilege
**Status:** ACCEPTED.
**Decision:** `audit_logs` granted only `SELECT, INSERT` to the app role; no
UPDATE/DELETE path; secret-like fields recursively redacted; writes best-effort
post-commit.
**Consequences:** Tamper-evidence is a database guarantee, not a convention. Gaps:
conflict-resolution and some writes are unaudited; retention is documented, not
enforced.

## ADR-04 — Block-not-approve guardrails; no background actors
**Status:** ACCEPTED.
**Decision:** Autonomy stays L0–L2; the *autonomous* step is the conservative one
(compute exposure/variance and **block**), the consequential step stays human and
permission-gated; there is no scheduler/cron/queue worker; the AI assistant has
read-only tools.
**Consequences:** Safe, auditable baseline. To go beyond L2 requires ADR-12.

## ADR-05 — Monorepo: NestJS + Next.js + Electron plant app
**Status:** ACCEPTED.
**Decision:** pnpm + Turborepo; NestJS API, Next.js 15 web (standalone), Electron
+ SQLite plant app, `@rmc/shared` for permissions/enums/validation.
**Consequences:** Shared types/permissions across API and web; the shared package
must be compiled to `dist/` before consumers build.

## ADR-06 — Manual gated deploy, images built off-box
**Status:** ACCEPTED (interim, to be superseded by ADR-13).
**Context:** 4 GB host OOMs on `docker build`.
**Decision:** Build images off-box (GHCR by SHA); VM3 only pulls; deploy via a
gated `redeploy.sh` with a freshness guard and pre-redeploy backup.
**Consequences:** Avoids OOM; but no CD, no staging — a single operator is the
release mechanism. Superseded by ADR-13 as infra matures.

---

## ADR-07 — Evolve to hybrid tenancy (pool → silo)
**Status:** PROPOSED.
**Context:** Pooled RLS is right for pilot but has the widest blast radius and
hardest per-tenant restore; enterprise tenants need isolation/PITR.
**Decision:** Keep pooled for standard tenants; add a **database-per-tenant silo**
tier for large/enterprise accounts, with an **identical schema** so a tenant is
promotable pool→silo without redesign; use deployment stamps to cap blast radius.
**Consequences:** Premium isolation tier; native per-tenant backup/restore;
operational multiplication for silos. Requires a tenant-routing layer.

## ADR-08 — Offline sync: change-feed + idempotency + versioning
**Status:** PROPOSED.
**Context:** Current sync uses a wall-clock cursor (lost-update bug) and infers
idempotency from business keys only; conflict detection is a timestamp string
compare.
**Decision:** Replace the cursor with a **monotonic change-feed** (`change_seq`
or append-only change-log); require **UUIDv7 idempotency keys** on every
operation; add `@VersionColumn` for real optimistic concurrency; server-
authoritative event-sourced writes for money/inventory; LWW only for cosmetic
fields.
**Consequences:** Eliminates the lost-update and spurious-conflict bugs; enables
`manual_merge` + conflict audit; more schema/machinery. Prereq for extending
offline coverage.

## ADR-09 — Offline build-vs-buy: custom outbox vs PowerSync
**Status:** OPEN (needs owner decision).
**Context:** ADR-08 can be implemented on the existing custom outbox or by
adopting PowerSync.
**Options:**
- **Evolve custom** — lowest disruption, keeps Electron app + reserved numbering;
  we hand-build the change-feed, retry engine, and versioning. Best if offline
  breadth stays modest.
- **PowerSync** — Postgres↔SQLite bidirectional; **writes routed back through the
  NestJS API** so RLS and business rules stay authoritative; removes hand-rolled
  change-feed/retry. Best if offline coverage must expand broadly and to large
  local datasets.
**Decision:** Deferred — depends on how much of the plant must run offline (a
product-scope call). Keep the idempotency-key contract either way.

## ADR-10 — Cookie-based auth + refresh rotation
**Status:** PROPOSED.
**Context:** Access **and** refresh tokens live in `localStorage`; no rotation;
weak default secrets can boot; sessions survive password change.
**Decision:** Access token in memory + **refresh token in httpOnly/Secure/
SameSite cookie** with rotation + reuse detection; CSRF tokens on writes; fail
boot on default/empty JWT secrets; MFA-ready; reject `alg:none`, validate
`aud`/`iss`.
**Consequences:** Removes the highest-severity web exposure; requires cross-origin
CORS/CSRF handling (the documented reason it was deferred on the live pilot).

## ADR-11 — Integration provider registry + job queue + webhooks
**Status:** PROPOSED.
**Context:** Integrations are hardcoded per feature and mostly absent; the
provider-registry backbone the design assumes doesn't exist; external calls run
inline.
**Decision:** Introduce `integration_providers` / `tenant_integrations` (encrypted
`credentials_ref`) / `integration_logs` / `batching_connector_configs`; move all
external calls to **idempotent, retryable, logged** background workers
(BullMQ/Redis); add a **webhook receiver** with signature + duplicate-ID checks.
**Consequences:** Adding an integration becomes "configure a provider"; secrets
centralised; more infrastructure (queue, workers). Prereq for live e-invoice/
e-way/payments/messaging.

## ADR-12 — Autonomy guardrail engine; hard ceiling L4
**Status:** PROPOSED.
**Decision:** Build a policy/guardrail layer between the API and any write tool:
scoped read/write tools, declarative policy (reversibility class, budget/rate/
quiet-hour caps), the unified approval engine as the L2 substrate, reversibility/
rollback (HOTL) for L3, immutable proposal audit, and a per-tenant kill switch.
**Hard rule:** financial/legal/safety/irreversible actions **never exceed L4 and
default to L2**; no capability is ever L5.
**Consequences:** Enables safe L3 automation; gated behind the approval engine and
observability. Without it, nothing may exceed L2.

## ADR-13 — Add staging + CD; keep manual redeploy as break-glass
**Status:** PROPOSED.
**Decision:** Stand up a prod-mirrored staging environment; introduce CD (blue/
green or canary behind a load balancer); retain `redeploy.sh` + freshness guard +
pre-redeploy backup as the break-glass path.
**Consequences:** Deploys are validated before prod; deploy stops being a single
manual action; requires a stateless app tier (already true).

## ADR-14 — Secrets manager + at-rest encryption
**Status:** PROPOSED.
**Decision:** Move JWT/DB/S3 secrets from plaintext `.env` to a secrets manager
(Vault/cloud KMS) or at minimum sops/age-encrypted files, with rotation and audit;
enable Postgres/MinIO encryption at rest.
**Consequences:** Host compromise is no longer total; satisfies DPDP Rule 6
safeguards; small operational overhead.

## ADR-15 — e-invoice/e-way: prepare (L2 sign-off) then transmit (L3 job)
**Status:** PROPOSED.
**Context:** GST IRN/e-way are legal acts with penalties; but the *network call*
after a human decision is mechanical.
**Decision:** Auto-**prepare** the invoice + pre-fill IRN/e-way payloads and
**block for human sign-off (L2)**; on sign-off, **transmit via an idempotent,
retryable, logged L3 worker**. Design to the **₹5 crore** e-invoicing threshold
(the ₹2 crore "from Oct 2025" claim is unconfirmed — do **not** design to it
without a CBIC notification).
**Consequences:** Compliance becomes in-system without automating the legal
decision; depends on ADR-11 and GSP/IRP access.

## Open decisions needing owner input
- **ADR-09** — how much of the plant must run offline (custom vs PowerSync).
- **Off-box backup target** (S3/Backblaze / second host / not yet) — blocks Wave 0.
- **Infra direction for staging/HA** (managed cloud Postgres vs stay-on-VPS) —
  shapes ADR-07/13.
- **AI model/SDK** — confirm the `claude-opus-5`/`output_config` surface against
  the installed SDK before relying on the AI features commercially.
