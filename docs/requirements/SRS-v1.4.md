# RMC Plant SaaS — Software Requirements Specification (SRS)

**Version:** 1.4 (Consolidated Baseline)
**Status:** Signed off for Phase 1 — frozen baseline
**Supersedes:** Owner Decision Addendum v1.1, Integration & Control Addendum v1.2, E-Invoice & E-Way Bill Decision Addendum v1.3
**Date:** 2026-07-02

---

## Document Control

| Version | Scope | Status |
|---------|-------|--------|
| v1.1 | SaaS model, multi-tenancy, subscriptions, phasing, language, credit limit | Merged into this baseline |
| v1.2 | Batching / weighbridge / GPS / Tally / WhatsApp integrations, negative stock | Merged into this baseline |
| v1.3 | E-invoice-ready & e-way-bill-ready fields, Phase-1/Phase-3 decision | Merged into this baseline |
| **v1.4** | **Consolidated SRS + contradiction resolution + missing sections** | **Signed off (Phase 1)** |

> **This document is the single source of truth.** Where the earlier addenda disagreed, Section 15 records the resolution. This baseline is frozen for Phase 1; no development starts before the Design Stage is completed against this baseline.

---

## 1. Introduction

### 1.1 Purpose
Define the complete, consolidated requirements for a multi-tenant SaaS platform for Ready Mix Concrete (RMC) plant operations, so the Design Stage can begin from a single baseline.

### 1.2 Product Scope
A cloud SaaS platform (with an offline-capable PWA plant app) serving many independent RMC companies (tenants), covering sales, order booking, production/batching, dispatch, delivery, inventory, GST invoicing, receipts, outstanding, integrations, and compliance readiness.

### 1.3 Glossary
| Term | Meaning |
|------|---------|
| Tenant | An independent RMC company using the platform, with fully isolated data |
| RMC | Ready Mix Concrete |
| TM | Transit Mixer (concrete truck) |
| DO | Delivery Order |
| Challan | Delivery challan / dispatch document |
| HSN/SAC | Harmonized System Nomenclature (goods) / Service Accounting Code |
| RCM | Reverse Charge Mechanism |
| IRN | Invoice Reference Number (e-invoice) |
| IRP | Invoice Registration Portal |
| EWB | E-Way Bill |
| GSTIN | GST Identification Number |
| RBAC | Role-Based Access Control |
| NFR | Non-Functional Requirement |

### 1.4 Phasing Overview
- **Phase 1 — SaaS MVP:** multi-tenant foundation + core RMC operations + basic GST invoice + e-invoice/e-way-bill **ready fields** (no government API).
- **Phase 2 — Operational Control + Mobile:** mobile apps, direct batching/weighbridge/GPS integration, QC, purchase, approval-workflow expansion.
- **Phase 3 — Finance & Compliance:** full GST engine, credit/debit notes, ledgers, direct Tally integration, payment gateway, **direct e-invoice & e-way-bill API**.
- **Phase 4 — Customer Ecosystem:** customer portal & app.
- **Phase 5 — AI & Advanced Analytics.**

---

## 2. SaaS Platform & Multi-Tenancy (from v1.1)

### 2.1 SaaS-from-day-one
The platform must support many independent RMC companies (tenants) on shared infrastructure with fully isolated data, users, settings, billing, plants, customers, orders, invoices, reports, and integrations.

### 2.2 Super Admin Platform
Super Admin must manage: tenant creation, activation/deactivation, subscription plans, module access, plan upgrade/downgrade, payment status, trial period, license/user/plant/storage limits, support access, tenant health monitoring, global settings, global language settings, global audit logs, SaaS invoices, payment gateway, coupon/discount system.

### 2.3 Tenant Isolation
- No tenant may see another tenant's data.
- Users belong only to their allowed tenant.
- Plant, customer, invoice numbers, reports, integrations are all tenant-specific.
- Tenant deletion/deactivation must not affect other tenants.
- **Architecture:** shared application; tenant-aware DB with a Tenant ID on every tenant-level table; strong row-level access control; tenant-wise backup/export; tenant-wise subscription control; optional future dedicated-DB support for enterprise tenants.

### 2.4 Subscription & Plans
Plan-based selling — Starter (1 plant, limited users, core order/dispatch/billing/inventory, basic reports); Professional (multi-user, advanced reports, QC, driver app, WhatsApp, purchase); Enterprise (multi-plant, approval workflow, GPS/weighbridge/batching integration, advanced analytics, API access, priority support).

### 2.5 SaaS Billing
Subscription invoice; monthly/yearly billing; trial & grace period; auto/manual renewal; payment gateway; coupon/discount; **GST on SaaS invoice (CGST/SGST/IGST)**; payment receipt; failed-payment alert; expiry alert; suspension; reactivation.

> **Reconciliation (see §15-5):** SaaS-tenant billing is a Phase-1 foundation. The tenant billing payment gateway is separate from the customer-facing payment gateway (Phase 3/4). If the gateway is not ready in Phase 1, tenant activation/renewal is handled manually by Super Admin.

---

## 3. Core RMC Operations (Phase 1)

### 3.1 Master Data
Phase-1 masters:
- Company, Plant, User & Roles
- Customer master (with credit limit, credit days, GSTIN)
- Site/Project master
- Material master
- **Supplier / Vendor master** *(added — see §15-3)*
- Vehicle master, Driver master
- Transporter master *(added — required for e-way bill)*
- Concrete grade master + basic mix design
- **HSN/SAC & Tax-rate master** *(added)*
- **UOM master** *(added)*
- **Rate / price-list master** (customer × grade, pumping & lead charges) *(added — required to compute order value for the credit check)*
- **Numbering-series master** (per tenant / per GSTIN / per financial year) *(added)*
- Bank / payment-mode master *(added)*

### 3.2 Transaction Flow
Quotation → Order Booking (with credit-limit block) → Production Planning → Dispatch → Delivery Challan → Basic GST Invoice → Receipt Entry → Customer Outstanding.

Also in Phase 1: manual batch-ticket entry (Putzmeister/IDS import-ready structure), manual weighbridge entry, BharatBenz GPS-ready vehicle configuration, basic inventory, negative-stock approval, basic dashboard, basic reports, offline storage + manual cloud sync, basic audit log, English UI + Indian-language-ready architecture.

### 3.3 Document State Machine *(added — §2-5)*
The order lifecycle statuses and allowed transitions must be defined in Design, minimally:
`Draft → Credit-Hold → Confirmed → In-Production → Dispatched → Delivered → Invoiced → (Paid / Part-Paid / Outstanding)` plus `Cancelled` and `Rejected/Returned` branches. Each transition records actor, timestamp, and (where relevant) reason.

### 3.4 Credit Limit Rule (from v1.1 §8)
Credit limit **blocks at order-booking stage**. On order creation the system checks current outstanding + pending invoices vs credit limit and credit days. If exceeded, the order moves to **Credit Hold** and cannot be confirmed until released by an authorized role (Company Owner / Accounts Manager / Authorized Admin). Every override captures customer, outstanding, credit limit, reason, approver, date/time, remarks.

---

## 4. GST, Invoicing, E-Invoice & E-Way Bill

### 4.1 "Basic GST Invoice" — Phase 1 definition *(clarified — §15-6)*
Phase-1 "basic GST invoice" **includes:** multi-line invoice supporting **mixed HSN (goods, e.g. RMC HSN 3824 50 10 @18%) and SAC (services, e.g. pumping/placement)**; automatic CGST/SGST vs IGST determination from place of supply; round-off; reverse-charge flag; invoice print/PDF; storage of all e-invoice-ready and e-way-bill-ready fields (§4.2, §4.3).
Phase-1 **excludes** (deferred to Phase 3 "full GST engine"): credit/debit notes, GSTR returns, ITC, RCM accounting, multi-rate reconciliation, ledgers.

### 4.2 E-Invoice-Ready Fields (Phase 1 — store only, no API) (from v1.3 + additions)
Supplier GSTIN; **Supplier legal/trade name**; **Supplier address + PIN + state code**; Buyer GSTIN; **Buyer legal/trade name**; **Buyer PIN + state code**; **Dispatch-from name/address/PIN/state**; **Ship-to name/GSTIN/address/PIN/state**; Invoice number; Invoice date; Document type (INV/CRN/DBN); **Supply type (B2B/SEZ/EXP/DEXP)**; **Transaction type (Regular/Bill-to-Ship-to)**; Place of supply; Billing address; Shipping/site address; HSN/SAC; Item description; Quantity; UOM; Rate (unit price); **GST rate % per line**; Taxable value; **Discount (line & invoice)**; **Other charges (line & invoice)**; CGST; SGST; IGST; **Cess**; Total invoice value; **Document-level totals (assessable value, total CGST/SGST/IGST/Cess)**; Round off; Reverse-charge flag; IRN field; Ack number; Ack date; **Signed QR code (base64) + signed invoice JSON**; E-invoice status; E-invoice cancellation status.

**Phase-1 rule:** generate a normal GST invoice and store these fields; do not push to the government portal.

### 4.3 E-Way-Bill-Ready Fields (Phase 1 — store/print only, no API) (from v1.3 + additions)
Invoice number; Invoice date; Delivery challan number; Customer GSTIN; Supplier GSTIN; **From & To PIN + state codes**; Dispatch-from address; Ship-to address; Place of supply; Document type; **Sub-supply type**; **Transaction type**; Transporter name; Transporter ID; **Transporter doc no. & date (LR/RR/airway)**; Vehicle number; Vehicle type (Regular/ODC); Distance (km); Transport mode; HSN/SAC; Quantity; Taxable value; **CGST/SGST/IGST/Cess split**; Total invoice value; **Reason for transportation**; E-way-bill number; E-way-bill date; E-way-bill validity; E-way-bill status; E-way-bill cancellation status; **Part-A/Part-B flag + vehicle-update history**.

**Phase-1 rule:** store and print e-way-bill reference fields if manually entered; no API generation.

### 4.4 RMC-specific compliance rules *(added)*
- **EWB requirement flag:** auto-flag whether an e-way bill is required per DO based on consignment value and route. Threshold ₹50,000 inter-state; **note state variations (e.g., Tamil Nadu intra-state ₹1,00,000)** — thresholds configurable per state/tenant.
- **≤50 km / Part-B exemption:** intra-state movement ≤50 km does not require Part-B (vehicle) details; encode this to avoid forcing unnecessary entry.
- **Phase-1 invoice correction:** since credit/debit notes are Phase 3, the Phase-1 interim rule is **cancel-and-reissue within the same tax period before return filing**, with full audit. *(added — §15-4)*

### 4.5 Phase 3 — Direct API (from v1.3 §4)
E-invoice generation; IRN generation; signed QR storage; e-invoice cancellation; e-way-bill generation/cancellation/update; API error log; retry mechanism; GST compliance audit report; **IRP provider abstraction/failover; auto EWB Part-A from e-invoice; e-invoice↔EWB↔GSTR-1 reconciliation; 24-hour cancellation-window enforcement with auto-fallback to credit note.**

### 4.6 E-invoice applicability config *(added)*
E-invoicing applicability is a **per-tenant / per-GSTIN toggle** (current statutory threshold ₹5 crore aggregate turnover; configurable). Invoice numbers must be unique, sequential, ≤16 chars, per GSTIN per financial year.

---

## 5. Integrations (from v1.2)

### 5.1 Batching (multi-brand connector)
Must **not** be hardcoded to Putzmeister/IDS. Plugin/connector architecture: Putzmeister/IDS connector, CSV/Excel import, local DB read, API integration, file-watcher, manual fallback, future custom connectors. Per-tenant/plant config of brand, import method, path/endpoint, ticket format, material/grade/vehicle/order mapping, sync frequency. Captured batch data per v1.2 §1.3 (tenant, plant, ticket, order, customer, site, vehicle, driver, grade, mix code, quantity, start/end time, operator, material target vs actual, water correction, admixture, manual-override flag, import source, sync status).
> *(added)* Batch **tolerance rule** (target vs actual material) with alert threshold must be defined.

### 5.2 Weighbridge
Phase 1: manual entry (slip number, inward weight, stock update). Phase 2: direct integration (auto gross/tare/net, auto stock, supplier-challan matching, mismatch alert). Data per v1.2 §2.3.

### 5.3 GPS
Provider-based (BharatBenz inbuilt, third-party, driver-app GPS, manual fallback) — not hardcoded to BharatBenz. Data per v1.2 §3.3 (location, speed, ignition, trip milestones, route history, ETA, idle time, geofence).

### 5.4 Accounting / Tally
Phase 1: Tally-ready export (Excel), invoice/receipt/customer-ledger export. Phase 3: direct Tally integration + GST sales/receipt/CN/DN voucher sync. Export fields per v1.2 §4.3.

### 5.5 WhatsApp API (required integration)
Direct WhatsApp Business API — template master, template language/variables, tenant-wise sender config, message log, delivery status, failed-message retry, opt-in/consent tracking. Notifications per v1.2 §6.2.

### 5.6 Negative Stock Rule
Negative stock allowed **only with approval**. Shortage → warning → user reason → approver (Owner/Plant Manager/Store Manager/Authorized Admin) → approve/reject → audit. Audit data per v1.2 §5.4.

---

## 6. Approvals & Audit *(reconciled — §15-2)*

Phase 1 requires **at least a basic approval engine** because two approval flows are already mandatory in Phase 1: **credit-hold release** (§3.4) and **negative-stock approval** (§5.6). The broader "approval workflow" expansion remains Phase 2. Design must decide between two hardcoded flows vs a configurable engine.

**Audit log spec** *(added):* define what is logged (all approvals, overrides, invoice issue/cancel, master changes, login), immutability/tamper-evidence, who can view, and retention (aligned to §11 GST retention).

---

## 7. Localization / i18n (from v1.1 §9)
English default; language-ready architecture; Unicode; translation-file structure; Indian-language fonts; **PDF rendering of Indian-language text**. Target languages: English, Tamil, Hindi, Telugu, Kannada, Malayalam, Marathi, Gujarati, Bengali, Punjabi, Odia. No hardcoded strings anywhere.
> *(added)* State **which languages are translated in which phase** (translation is ongoing). Complex-script PDF rendering (Tamil/Devanagari) in a browser PWA is a **Design-stage technical spike**, not an assumption.

---

## 8. Offline & Sync (Phase 1 PWA) *(added — §15 open risk)*
Phase 1 has offline storage + manual cloud sync. Requirements to define:
- **Conflict resolution** when two devices edit the same record offline (last-write-wins vs merge vs review queue).
- **Statutory numbering rule:** invoice numbering must **not** be generated offline in a way that risks gaps/duplicates in the series. Recommended: **invoice generation is online-only** (or uses a reserved online-allocated number block); batch logs, DOs and operational data may be captured offline and synced.
- Sync status visibility and retry.

---

## 9. Notifications Framework *(added)*
Unified notification layer across **WhatsApp (§5.5), email, SMS, in-app**. Subscription-expiry, payment-failure, low-stock, dispatch, and reminder events route through this layer with per-tenant channel configuration.

---

## 10. Roles & Access Control (RBAC)
Full role × permission matrix is a Design-stage artifact (`RBAC-matrix.md`). Roles referenced across the platform: Super Admin, Company Owner, Accounts Manager, Authorized Admin, Plant Manager, Store Manager, Sales/Dispatch, QC Technician, Driver. RBAC must be enforced tenant-wide with row-level tenant isolation (§2.3).

---

## 11. Non-Functional Requirements (NFR) *(added)*
- **Scale/performance:** target tenant count, concurrent users, batches/day (to be quantified at sign-off).
- **Availability/SLA:** define per plan (Enterprise = priority support).
- **Security:** encryption in transit/at rest; PCI-DSS scope for payment gateway; GST/PII protection; RBAC; audit trail.
- **Data retention:** GST records retained **minimum 6 years (practically 8)**; audit-log retention aligned.
- **Backup/restore:** tenant-wise backup/export; define RPO/RTO.
- **Compatibility:** supported browsers/devices; PWA install targets (Android Chrome, iOS Safari 16.4+).

---

## 12. Reporting Requirements (Phase 1) *(added — replaces vague "basic reports")*
Mandatory Phase-1 reports: Daily Production report; Dispatch / DO register; **GST Sales register**; Stock ledger; **Customer Outstanding / Aging**; Receipt register; Batch-ticket report. Each exportable to PDF/Excel and (where relevant) WhatsApp.

---

## 13. Tenant Onboarding / Data Migration *(added)*
New-tenant onboarding must support: KYC + GSTIN/PAN validation; master data import (Excel) for customers, materials, vehicles, drivers, grades; **opening balances** (stock, customer outstanding); **opening invoice-series configuration** per GSTIN/FY.

---

## 14. Consolidated & Reconciled Phase Scope

| Capability | Phase |
|-----------|-------|
| SaaS multi-tenant foundation, Super Admin, tenant setup, plan/module control | 1 |
| Company/Plant/User setup, RBAC (basic), full master set incl. Supplier/HSN/UOM/Transporter/Rate/Numbering | 1 |
| Quotation, Order booking, **credit-limit block + credit-hold approval** | 1 |
| Production planning, Dispatch, Delivery challan, manual batch entry (IDS import-ready) | 1 |
| Manual weighbridge, BharatBenz GPS-ready config | 1 |
| Basic inventory, **negative-stock approval**, **basic approval engine** | 1 |
| **Basic GST invoice + e-invoice-ready + e-way-bill-ready fields** *(moved into Phase 1 per v1.3)* | 1 |
| Basic receipt, customer outstanding, Tally-ready export, WhatsApp API foundation | 1 |
| Dashboard, enumerated basic reports, offline storage + manual sync (+ sync/numbering rules), basic audit log | 1 |
| English UI + i18n-ready architecture | 1 |
| Driver/Sales/Owner mobile apps | 2 |
| Direct batching (IDS + multi-brand framework), direct weighbridge, GPS multi-provider | 2 |
| Advanced inventory, purchase, QC/lab, vehicle maintenance, pump mgmt, approval-workflow expansion, WhatsApp automation | 2 |
| Full GST engine, **credit/debit notes**, ledgers, aging, payment gateway, direct Tally | 3 |
| **Direct e-invoice & e-way-bill API** (IRN, QR, cancel, EWB gen/cancel/update, error log, retry, compliance audit) | 3 |
| Customer portal & app, live tracking, statements, complaints, online payment | 4 |
| AI analytics (profit/m³, dispatch/material/QC/collection AI, predictive maintenance) | 5 |

---

## 15. Contradictions Resolved (change log vs v1.1/v1.2/v1.3)

1. **E-invoice/e-way-bill-ready fields** → moved into **Phase 1** (per v1.3), overriding the Phase-3 placement in v1.1/v1.2 Phase-1 scope lists.
2. **Approval workflow** → a **basic approval engine is Phase 1** (credit hold + negative stock already require it); "approval workflow expansion" stays Phase 2.
3. **Supplier/Vendor master** → **added to Phase 1** (required by weighbridge inward and Tally vendor ledger).
4. **Credit/Debit notes** remain Phase 3; a **Phase-1 cancel-and-reissue** interim correction rule is defined (§4.4).
5. **Payment gateway** → SaaS-tenant billing gateway (Phase 1 foundation, manual fallback) separated from customer payment gateway (Phase 3/4).
6. **"Basic GST invoice" vs "Full GST engine"** boundary explicitly defined (§4.1).

---

## 16. Requirement Status & Sign-off Gate

**Status:** Phase-1 requirements signed off by owner (2026-07-02). Owner decisions captured and contradictions resolved. The following are confirmed-at-Design inputs (carried forward, not blockers):
- NFR quantification (scale, SLA, RPO/RTO) — §11
- Offline/sync + invoice-numbering rule — §8
- RBAC matrix — §10 / `RBAC-matrix.md` (Design)
- Phase-1 report list — §12
- MoSCoW prioritization — Appendix A
- Language rollout per phase — §7

**This v1.4 is the frozen baseline.** Next stage: **Design** (data dictionary → `data-dictionary.md`, ER model, RBAC matrix, state machines, Phase-3 API stub, invoice/EWB print templates, Requirement Traceability Matrix). **No development before Design is complete.**

---

## Appendix A — MoSCoW Prioritization (Phase 1)

| Priority | Items |
|----------|-------|
| **Must** | Multi-tenant foundation, Super Admin, tenant/company/plant/user setup, RBAC, core masters (incl. Supplier/HSN/UOM/Rate/Numbering), quotation→order→credit-hold, dispatch, delivery challan, basic GST invoice + e-invoice/EWB-ready fields, receipt, outstanding, negative-stock approval, basic audit log |
| **Should** | Manual batch entry (IDS import-ready), manual weighbridge, Tally-ready export, enumerated basic reports, i18n architecture, offline storage + sync rules |
| **Could** | BharatBenz GPS-ready config, WhatsApp API foundation, dashboard KPIs, coupon/discount for SaaS billing |
| **Won't (this phase)** | Mobile apps, direct integrations, QC/lab, purchase, credit/debit notes, direct GST API, customer portal, AI |
