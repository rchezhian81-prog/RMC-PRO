# Requirement Traceability Matrix — Mix Nova RMC

> Traces the **intended** Phase-1 scope (SRS v1.4 + design docs) to the **built**
> reality established by the As-Is audit. Requirement keys are the SRS's own
> hierarchical section numbers, its §14 phase table, and its Appendix A MoSCoW
> table (the SRS uses no formal `REQ-nnn` IDs).
>
> **Status legend** (same vocabulary as `AS_IS_SYSTEM_ARCHITECTURE.md`):
> PROD-VERIFIED · IMPL-UNVERIFIED · PARTIAL · DOC-ONLY · PLANNED · MISSING · UNCLEAR.
> **Test evidence:** CI = `apps/api/test/*` (runs in CI); E2E = `tests/*` (manual,
> not wired into CI); OWNER = owner-confirmed live; — = none.

## 1. How to read this

The point of the matrix is not to grade effort but to expose **three specific
risks** an owner needs before a wider pilot:
1. **Scope that reads as "done" in the design docs but is DOC-ONLY in code** —
   mostly integrations and offline breadth.
2. **Built behaviour with no automated test** — where a regression would ship
   silently.
3. **Deliberate Phase-1 deferrals** — so nobody mistakes a planned gap for a
   defect.

Phase-1 "Must/Should/Could" tags come from SRS Appendix A. Anything marked
**PLANNED** is a *correct* deferral per the SRS §14 phase table, not a miss.

## 2. Multi-tenancy & platform (SRS §2)

| Req | Requirement | Phase-1 | Built status | Test | Notes |
|---|---|---|---|---|---|
| §2.1 | SaaS from day one, isolated per tenant | Must | PROD-VERIFIED | CI, E2E, OWNER | RLS FORCE on 51 tables; live probe `rmc_app` f/f. |
| §2.2 | Super-admin platform (tenant/plan/module, health, global audit) | Must | PARTIAL | — | Tenant/plan/module CRUD built; tenant *health monitoring*, global SaaS invoices/coupons DOC-ONLY. |
| §2.3 | Tenant isolation, tenant-wise backup/export | Must | IMPL-UNVERIFIED | CI, E2E | Data export + offboard built; *tenant-wise* backup is whole-DB only today. |
| §2.4 | Subscription plans (Starter/Pro/Enterprise) | Must | PARTIAL | — | Plans + modules modelled; tier bundles not enforced as named tiers. |
| §2.5 | SaaS billing (GST invoice, gateway, trial/grace, coupons) | Could | DOC-ONLY | — | No SaaS-billing code; manual super-admin fallback only. |

## 3. Master data (SRS §3.1)

| Req | Requirement | Phase-1 | Built status | Test | Notes |
|---|---|---|---|---|---|
| §3.1 | Company, Plant, Users/Roles | Must | IMPL-UNVERIFIED | E2E | Full setup module. |
| §3.1 | Customer (credit limit/days, GSTIN), Site, Material, Supplier, Vehicle, Driver, Grade | Must | IMPL-UNVERIFIED | CI (validation) | `MasterCrud`; GSTIN/mobile/credit validation in CI test. |
| §3.1 | Transporter master (e-way) | Should | MISSING | — | No `transporters` entity found; e-way is DOC-ONLY anyway. |
| §3.1 | HSN/SAC & tax-rate master, UOM master, Bank/payment-mode master | Should | PARTIAL | — | HSN/SAC/tax captured per invoice line; **standalone master tables not present** (design R6 called for `uoms`/`hsn_tax_rates`/`banks`/`payment_modes`). |
| §3.1 | Rate/price-list (customer × grade, pumping/lead) | Should | IMPL-UNVERIFIED | — | Rate contracts cover this. |
| §3.1 | Numbering series per tenant/GSTIN/FY | Must | IMPL-UNVERIFIED | — | `number_series`; atomic allocation under `FOR UPDATE`. |

## 4. Sales & orders (SRS §3.2–3.4)

| Req | Requirement | Phase-1 | Built status | Test | Notes |
|---|---|---|---|---|---|
| §3.2 | Quotation → order → prod plan → dispatch → challan → invoice → receipt → outstanding | Must | PROD-VERIFIED | CI, E2E, OWNER | Full order-to-cash proven live (₹2,95,000 run). |
| §3.3 | Document state machine w/ actor/timestamp/reason | Must | IMPL-UNVERIFIED | — | `order_status_history` immutable log. |
| §3.4 | Credit-limit block at booking → credit hold → gated release | Must | PROD-VERIFIED | CI-adjacent, OWNER | Auto-hold (L2); release requires `credit_hold.approve`; full snapshot captured. |
| §3.2 | Leads/follow-ups, quotation discount approval | Should | IMPL-UNVERIFIED | — | `leads`, `quotation_discount.approve` key exists. |

## 5. Production & batching (SRS §3.2, §5.1)

| Req | Requirement | Phase-1 | Built status | Test | Notes |
|---|---|---|---|---|---|
| §3.2 | Production plans, batch queue, manual batch ticket | Must | IMPL-UNVERIFIED | E2E | Manual entry; variance vs tolerance; ledger deduction. |
| §5.1 | Batching connector NOT hardcoded — plugin (IDS/CSV/manual) | Should | DOC-ONLY | — | Only manual entry exists; **no importer, no connector config**. |
| §3.2 | Mix design + approval, only approved mix usable | Must | PARTIAL | — | Approval gate real; **create/edit ungated by permission**. |
| §5.1 | Batch tolerance rule + alert threshold | Must | IMPL-UNVERIFIED | — | Variance blocks unless override. |

## 6. Dispatch & delivery (SRS §3.2)

| Req | Requirement | Phase-1 | Built status | Test | Notes |
|---|---|---|---|---|---|
| §3.2 | Dispatch board, vehicle/driver allocation, delivery challan generate/print/share | Must | IMPL-UNVERIFIED | E2E | Challan PDF + `wa.me` share. |
| §3.2 | Delivery status updates, return/reject qty | Must | IMPL-UNVERIFIED | — | Manual/event statuses (no live GPS — PLANNED). |
| IS 4926 | 90-min / 300-rev discharge timers, site-water logging on challan | (not in P1 SRS) | MISSING | — | Domain-critical; not modelled. Candidate for target scope. |

## 7. Inventory & weighbridge (SRS §3.2, §5.2, §5.6)

| Req | Requirement | Phase-1 | Built status | Test | Notes |
|---|---|---|---|---|---|
| §3.2 | Stock balances/txns/inward/ledger/adjustment | Must | IMPL-UNVERIFIED | CI (stock ledger) | Null-plant ghost-row bug fixed (migration 14). |
| §5.6 | Negative stock only with approval | Must | IMPL-UNVERIFIED | — | `negative_stock.approve`. |
| §5.2 | Weighbridge manual entry (Phase 1) | Should | IMPL-UNVERIFIED | — | net = gross − tare in software; hardware = PLANNED (P2). |

## 8. GST, invoicing, e-invoice & e-way (SRS §4)

| Req | Requirement | Phase-1 | Built status | Test | Notes |
|---|---|---|---|---|---|
| §4.1 | Basic GST invoice (mixed HSN/SAC, CGST/SGST/IGST auto, round-off, RCM flag, PDF) | Must | PROD-VERIFIED | E2E, OWNER | Tax computed locally; correct totals in UAT + owner run. |
| §4.2 | E-invoice-**ready** fields stored (IRN, ack, signed QR/JSON) | Must | DOC-ONLY (by design) | — | Fields stored, never generated — **matches Phase-1 letter**. |
| §4.3 | E-way-bill-**ready** fields stored | Must | DOC-ONLY (by design) | — | Stored only — matches Phase-1 letter. |
| §4.4 | Auto EWB-required flag (₹50k inter-state; TN ₹1L configurable); ≤50 km Part-B exemption; correction = cancel-and-reissue | Must | PARTIAL | — | Cancel-and-reissue path exists; **auto EWB-required flag & threshold config not found in code**. |
| §4.6 | Per-tenant/GSTIN e-invoice toggle; invoice # unique/sequential/≤16 char per GSTIN per FY | Must | PARTIAL | — | Tenant-scoped unique invoice #; per-GSTIN-per-FY sequencing UNCLEAR. |
| §4.5 | Direct IRN/e-way API | Phase 3 | PLANNED | — | Correctly deferred. |

## 9. Receipts, outstanding, reporting (SRS §3.2, §12)

| Req | Requirement | Phase-1 | Built status | Test | Notes |
|---|---|---|---|---|---|
| §3.2 | Receipt entry, allocation, outstanding, ageing (0-30/31-60/61-90/90+) | Must | PROD-VERIFIED | E2E, OWNER | Auto-allocation; ageing buckets. |
| §12 | Reports: daily production, DO register, GST sales register, stock ledger, outstanding/ageing, receipt register, batch-ticket | Should | PARTIAL | — | Several report endpoints exist; Reports Center shows raw API path for unmapped keys. |
| §12 | Export to PDF/Excel/WhatsApp | Should | PARTIAL | — | PDF + Tally CSV; WhatsApp = link only. |

## 10. Integrations (SRS §5) — the largest intent-vs-reality gap

| Req | Requirement | Phase-1 | Built status | Test | Notes |
|---|---|---|---|---|---|
| §5.3 | GPS provider-based; P1 = BharatBenz-ready config | Could | DOC-ONLY | — | Columns only; no config table. |
| §5.4 | Tally export (Excel) for invoice/receipt/ledger | Should | PARTIAL | — | CSV for **invoices only**; no receipt/ledger export. |
| §5.5 | WhatsApp Business API foundation (templates, logs, delivery, consent) | Could | PARTIAL | — | `wa.me` link + log; **no API send, no templates, no delivery status**. |
| §9 | Unified notifications (WhatsApp/email/SMS/in-app) | (framework) | MISSING | — | Email & SMS transports **do not exist**. |
| §5.1 | Batching connector foundation | Should | DOC-ONLY | — | See §5 above. |
| §5.x | Integration provider registry backbone | (design) | MISSING | — | `integration_providers`/`tenant_integrations`/`integration_logs` **not in schema**. |

## 11. Approvals, audit, RBAC (SRS §6, §10)

| Req | Requirement | Phase-1 | Built status | Test | Notes |
|---|---|---|---|---|---|
| §6 | Basic approval engine (credit-hold + negative-stock mandatory) | Must | PARTIAL | — | Both approvals work **per-feature**; the generic `approval_requests`/`approval_actions` engine (design §15) is **not** a single subsystem. |
| §6 | Audit log all approvals/overrides/invoice issue-cancel/master changes/login; immutable; ~7-yr retention | Must | IMPL-UNVERIFIED | E2E (security) | Append-only by grant + redaction; retention policy is documentation, not enforced pruning. |
| §10 | Full role×permission matrix, tenant-editable, least-privilege, SoD | Must | PARTIAL | E2E (RBAC, manual) | Matrix + SoD real; **production-plans & mix-design create/edit ungated** violates least-privilege. |

## 12. i18n, offline, onboarding (SRS §7, §8, §13)

| Req | Requirement | Phase-1 | Built status | Test | Notes |
|---|---|---|---|---|---|
| §7 | English default + i18n-ready architecture, Indian-script PDF | Should | MISSING | — | UI strings are hardcoded English; no translation-file structure found. Architecture claim not evidenced. |
| §8 | Offline storage + manual sync, conflict resolution, statutory numbering | Should | PARTIAL | — | Real MVP but 3 ops only; see `OFFLINE_SYNC_AND_CONFLICT_STRATEGY.md`. |
| §8 | Reserved online-allocated numbering; invoicing excluded from offline | Should | IMPL-UNVERIFIED | — | `local_number_reservations`; online+offline share `number_series` under `FOR UPDATE`. |
| §13 | KYC + GSTIN/PAN validation, master import (Excel), opening balances, opening invoice series | Should | PARTIAL | — | CSV master import + opening stock/balance exist; GSTIN/PAN *validation-on-onboard* light. |

## 13. Non-functional requirements (SRS §11)

| Req | Requirement | Built status | Notes |
|---|---|---|---|
| §11 | Encryption in transit | IMPL-UNVERIFIED | nginx TLS 1.2/1.3 + HSTS. |
| §11 | Encryption at rest | MISSING | Not configured (optional-hardening TODO in backup README). |
| §11 | RBAC + audit trail | PARTIAL/IMPL | See §11 above. |
| §11 | Data retention (GST 6-8 yr, audit 7 yr) | DOC-ONLY | Stated in docs; no retention/pruning enforcement. |
| §11 | Backup/restore + RPO/RTO defined | PARTIAL | GFS backups + rehearsed restore built; **RPO/RTO never quantified**; off-box MISSING. |
| §11 | Performance/SLA numbers | UNCLEAR | "To be quantified at sign-off" — still unquantified; no load testing. |
| §11 | PWA targets (Android Chrome, iOS Safari 16.4+) | MISSING | Web app is online-only; no PWA/service worker. |

## 14. Deliberate Phase-2→5 deferrals (correct, not gaps)

Recorded so they are never mistaken for defects: mobile/driver/customer apps;
direct batching/weighbridge/GPS integration; QC/lab & cube testing; purchase;
**full GST engine, credit/debit notes, ledgers, ITC**; **direct e-invoice/e-way
API**; customer payment gateway; direct Tally; customer portal; AI analytics
(profit/m³, predictive maintenance). Source: SRS §14 phase table + Appendix A
"Won't (this phase)".

## 15. Headline traceability findings

1. **The order-to-cash spine traces cleanly** from SRS §3.2/§3.4/§4.1 to built,
   tested, owner-verified behaviour. This is the product's real, defensible core.
2. **The biggest intent-vs-reality delta is integrations (§5)** — most are
   DOC-ONLY or MISSING, and the provider-registry backbone the design assumes is
   absent. Several of these were *Phase-1 "foundation"* items (WhatsApp/email/
   payments), so this is partly a **missed Phase-1 commitment**, not only a
   future phase.
3. **A cluster of "Should" masters (transporter, UOM/HSN/bank/payment-mode)** are
   MISSING as standalone tables despite the design's R-refinements calling for
   them.
4. **i18n architecture (§7) is asserted but not evidenced** — worth reclassifying
   honestly to the owner.
5. **Test coverage is uneven:** the money path has CI + E2E + owner proof; large
   swaths (RBAC matrix, security, isolation breadth) live only in the **manual**
   `tests/` suite that CI never runs.
