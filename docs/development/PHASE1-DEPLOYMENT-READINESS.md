# RMC Plant SaaS — Phase 1 Deployment Readiness Report

**Prepared:** Sprint 11 (Hardening + UAT)
**Scope:** Phase 1 order-to-cash for Indian Ready Mix Concrete plants — multi-tenant SaaS.
**Verdict:** ✅ **GO for a controlled Phase-1 pilot** (see conditions in §9).

---

## 1. Executive summary

Phase 1 delivers the full order-to-cash journey for a multi-tenant RMC operation:
tenant/plant setup → masters → quotation → order + credit check → production/batching →
dispatch/challan → inventory → billing → receipt/outstanding → offline plant-app sync →
dashboards/reports. Sprint 11 added an automated, CI-gradeable test suite, closed the
last database-index gap, fixed one UAT-surfaced correctness bug, and polished the demo
seed. The full suite passes **34/34** and the whole monorepo lints, type-checks, and
builds clean.

The platform is ready for a **controlled pilot** with real tenants, on the explicit
understanding that a set of intentionally-deferred integrations (live GSTN/e-invoice,
e-way bill, direct Tally API, live payment collection, customer portal) are **out of
Phase-1 scope** and are stubbed or export-based by design. (QC / cube-testing and GPS
live vehicle tracking, originally deferred, were subsequently delivered in the
post-Sprint-11 gap-closure work — see §9.)

---

## 2. What was verified in Sprint 11

| Area | Result |
|------|--------|
| Tenant-isolation suite (CI gate) | 8/8 PASS |
| RBAC / authorization matrix | 6/6 PASS |
| End-to-end UAT (order-to-cash + offline + dashboards) | 11/11 PASS |
| Security checks | 9/9 PASS |
| **Total** | **34/34 PASS** |
| Monorepo `pnpm lint` | 0 errors, 0 warnings |
| Monorepo `pnpm typecheck` | clean (api, web, shared) |
| Monorepo `pnpm build` | 3/3 packages built |

Run the gate with: `pnpm test:e2e` (requires API + Postgres up and the demo seed
applied). The runner exits non-zero on any failure, so it is suitable as a CI gate.

---

## 3. Multi-tenant isolation (the core safety property)

Isolation is enforced in the **database**, not just the application layer:

- **58** tables total; **50** have `FORCE ROW LEVEL SECURITY` with a
  `tenant_isolation` policy (`USING`/`WITH CHECK` on
  `tenant_id = current_setting('app.current_tenant_id', true)::uuid`). The 8 without
  RLS are platform/global tables (module catalog, permission catalog, subscription
  plans, plan-modules, migrations, etc.) that carry no tenant data.
- The API runtime connects as **`rmc_app`**, a role that is **`rolsuper = false`** and
  **`rolbypassrls = false`** — it *cannot* bypass RLS. Migrations/seed use the owner
  role `rmc_owner` (superuser) only, offline from request handling.
- Every request runs inside `TenantDbService.runInTenant()`, which sets the tenant
  session variable inside a transaction before any query.

The isolation suite proves a second tenant (Beta) cannot see Alpha's customers,
invoices (incl. PDF), orders, Tally export rows, sync bootstrap data, or device-pushed
challans — by list **and** by direct id (404, not 403, so ids are not even
enumerable).

---

## 4. Authorization / RBAC

- **199** mapped API routes; **44** carry an explicit `@RequirePermissions(...)`
  guard backed by `PermissionsGuard` (per-request join over
  user_roles/role_permissions/permissions).
- Layered guards: `JwtAuthGuard` (authn) → `TenantGuard` (tenant context) →
  `PermissionsGuard` (fine-grained) → `SuperAdminGuard` (platform routes).
- The RBAC suite proves a view-only user is denied (403) on all 13 sampled guarded
  write endpoints while allowed on its read endpoint; a scoped exporter is allowed the
  Tally export but denied receipts; an admin is allowed; unauthenticated is 401.

---

## 5. Security checks

- **No server secrets reach the frontend.** A source walk of `apps/web/src` finds no
  reference to `JWT_SECRET`, `JWT_REFRESH_SECRET`, `POSTGRES_PASSWORD`,
  `APP_DB_PASSWORD`, or `passwordHash`, and only `NEXT_PUBLIC_*` env vars are read in
  web code.
- **No password hashes leak** from `/auth/me` or `/users`.
- **Offline sync is authenticated** — unauthenticated `/sync/devices/register` and
  `/sync/push` return 401; pushed documents land under the device's own tenant and are
  invisible cross-tenant.
- **Rate limiting** — global throttle 100/60s; login is tightened to **5/60s** and
  verified to return 429 after a burst.

---

## 6. Performance / database index review

- Every tenant-scoped table now has a `tenant_id` index — the review found **zero**
  tenant-scoped tables missing one after this sprint.
- Sprint 11 added two hardening indexes (migration `1720000010000-Indexes`):
  - `idx_users_tenant` on `users(tenant_id)` — `users` was the last tenant-scoped
    table without a tenant index; every login/listing/permission-join filters on it.
  - `idx_number_series_lookup` on `number_series(tenant_id, document_type)` — the hot
    document-numbering/reservation path (every challan/invoice/batch) looked a series
    up by this composite; it was previously a per-tenant scan.
- Join tables `user_roles` and `role_permissions` are covered by their unique
  constraints (`uq_user_roles(tenant_id,user_id,role_id)`,
  `uq_role_permissions(tenant_id,role_id,permission_id)`) — adequate, no change.

Note: index review was static (pg_indexes + query-path reasoning). Load/soak testing
with production-representative volumes is a pre-scale-up item (§9), not a pilot blocker.

---

## 7. UAT checklist (end-to-end, one continuous flow)

| Step | Result |
|------|--------|
| Tenant setup: company + plant present | ✅ |
| Master setup: customer (credit limit), materials, opening stock, approved mix design | ✅ |
| Quotation created → approved → PDF (`%PDF-`) | ✅ |
| Order confirmed within credit limit (credit check = approved) | ✅ |
| Batch confirmed → inventory reduced (cement −3500 kg) | ✅ |
| Dispatch board → challan issued → delivered | ✅ |
| Material inward posted → stock +5000 | ✅ |
| Invoice from challan → challan flips to invoiced, GST computed (CGST 4050, total 53100) | ✅ |
| Receipt allocated → outstanding 23100 (partially paid) | ✅ |
| Offline challan created on plant app → synced to cloud with reserved number | ✅ |
| Dashboards (summary + operations funnel) + reports catalog populated | ✅ |

---

## 8. Bugs found & fixed during Sprint 11

1. **Nondeterministic mix-design resolution (correctness).** When a grade had more than
   one approved active mix design (which is legitimate — distinct mix codes for the same
   grade, and even the clean seed produces this), batching resolved the mix by
   `versionNo DESC` only. With multiple candidates all at version 1 the tiebreak was
   undefined, so a batch could consume a *different* mix's materials and leave the
   intended material's stock untouched. **Fix:** deterministic resolution
   `versionNo DESC, createdAt DESC` (most-recently-approved active recipe wins).
   Surfaced by the UAT inventory-reduction assertion; fix verified by the same
   assertion now passing on a freshly-seeded database.

2. **Test-harness response-body handling (tooling).** The shared HTTP helper consumed
   the response body during JSON parsing, breaking PDF/CSV assertions, and attached a
   body to GET/HEAD requests. **Fix:** parse a cloned response and never attach a body
   to bodyless methods. (Test infrastructure only — no product-code impact.)

---

## 9. Remaining known issues / conditions before scale-up

None of the below block a **controlled pilot**; they are the honest ledger of what is
deferred or still to do before a wide production rollout.

**Delivered since Sprint 11 (post-readiness gap-closure — built, migrated, CI-gated):**
- QC / cube-testing module (`qc`)
- GPS live vehicle tracking (`gps`) — location pings roll onto the dispatch's latest
  fix and feed a live board; dispatch statuses remain manual/event-based.

**Intentionally deferred (out of Phase-1 scope — by product decision):**
- Live GSTN e-invoice / IRN and e-way bill APIs (invoices are generated locally; the
  payload/provider scaffolding exists but defaults to the offline provider)
- Direct Tally API (Tally is served as an export file today)
- Live payment-gateway collection (receipts are recorded manually)
- Customer self-service portal

**Operational hardening before scale-up (post-pilot):**
- Replace all `change-me-*` JWT secrets and demo DB passwords with managed secrets;
  never ship `.env.example` defaults to production.
- Provision managed Postgres with backups/PITR, Redis, and S3-compatible object
  storage; run migrations with the owner role and the app with `rmc_app` only.
- Wire `pnpm test:e2e` into CI as a required gate against an ephemeral seeded DB.
- Load/soak test at production-representative volume and re-check indexes with
  `EXPLAIN` on real cardinalities.
- Add per-endpoint throttle tuning and centralized audit logging/observability
  (metrics, error tracking) for the pilot tenants.
- Formal backup/restore and tenant-offboarding runbooks.

**Known minor items:**
- A `pg` deprecation warning ("client.query() when the client is already executing a
  query") appears in API logs. It is benign under current load but should be traced and
  removed before scale-up.

---

## 10. Verdict

**GO for a controlled Phase-1 pilot.** The order-to-cash core is functionally complete
and verified end-to-end; tenant isolation is DB-enforced and proven; RBAC, secret
hygiene, sync auth, and rate limiting pass their checks; the index review is closed; and
the one correctness bug found during UAT is fixed and re-verified. Proceed to a limited
set of pilot tenants after completing the operational-hardening items in §9 (secrets,
managed infra, CI gate). A wide production rollout should follow load testing and the
deferred-integration roadmap.
