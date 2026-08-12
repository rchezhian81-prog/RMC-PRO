# RMC Gap-Closure Plan

Turns the built-out order-to-cash + GST spine into a **production-grade
ready-mix-concrete operation**, by (a) deepening the shallow phase-1 modules and
(b) filling the phase-2 RMC modules that are already carved in the module catalog
(`packages/shared/src/modules-catalog.ts`) but unbuilt (`qc`,
`batching_integration`, `purchase`, `driver_app`, `gps`).

Derived from a feature-by-feature audit against a reference RMC/construction ERP.
This document is the execution backlog; each epic ships as 1–3 self-contained PRs
on the established build → verify → push → review-to-green → merge rhythm.

## Scope

**In scope — RMC operational business, end to end:**
masters/UOM depth, batching accuracy (moisture/water correction), QC/Lab,
pour scheduling, pricing & GST depth, receivables maturity, raw-material
procurement (cement/aggregate/admixture/diesel), fleet upkeep, inbound
weighbridge, and the platform primitives that support onboarding.

**Parked (not RMC-operational — revisit or integrate later):**
quarry / mining / AAC-block verticals, multi-company + segment/revenue-group
dimension, full general-ledger accounting (we keep the Tally CSV export as the
accounting hand-off), HRM / payroll, and GSTR return filing / 2A reconciliation.

## Locked decisions

- **First build:** D1 — Fleet renewal/compliance alerts (quick win).
- **Procurement & accounting:** build **Purchase / AP-lite in-app** (own
  PO → GRN → vendor bill → payment); accounting stays a Tally hand-off, not a
  general ledger.

## Current RMC posture

Strong, correct core: leads → quotation / rate-contract → order (+ credit
control) → mix-design → batch queue → batch ticket (target-vs-actual, tolerance
gate) → dispatch/challan → invoice (CGST/SGST/IGST/cess) → receipt, plus a deep
GST e-invoice/e-way engine, RLS multi-tenant isolation, an approval/automation
substrate, offline sync, and observability. The gaps below are **depth and
breadth on top of that spine**, not rework of it.

---

## Roadmap

| # | Epic | Track | Priority | Depends on | Est. PRs | Status |
|---|------|-------|----------|-----------|----------|--------|
| D1 | Fleet renewal / compliance alerts | Fleet | Critical | — | 1 | **done** |
| A1 | Material & UOM master depth | Batching | Critical | — | 1–2 | **done** |
| A2 | Aggregate moisture & w/c correction | Batching | Critical | A1 | 2 | **done** |
| A3 | QC / Lab module (`qc`) | Batching | Critical | A1 | 2–3 | **done** |
| B2 | Pricing & GST depth (quote→invoice) | Order-to-cash | Important | — | 2 | **done** |
| B1 | Pour scheduling | Order-to-cash | Important | — | 2 | **done** |
| C1 | Receivables maturity | Billing | Important | — | 1–2 | **done** |
| D2 | Purchase / AP-lite (`purchase`) | Procurement | Critical | A1 | 3 | **done** |
| E1 | Weighbridge hardware bridge | Weighbridge | Important | — | 2 | planned |
| A4 | Batching Integration (`batching_integration`) | Batching | Important | A2 | 2 | planned |
| D3 | Fleet maintenance & fuel log | Fleet | Important | D1 | 2 | planned |
| D4 | Expense capture | Procurement | Important | — | 1–2 | planned |
| B3 | Returned/short-load concrete & wastage | Order-to-cash | Nice | — | 1 | planned |
| F1 | Excel bulk import framework | Platform | Important | — | 2 | planned |
| F2 | Doc-numbering activation + correction trail | Platform | Nice | — | 1–2 | planned |

**Recommended order:** D1 → A1 → A2 → A3 → B2 → B1 → C1 → D2 / E1 → A4 / D3 / D4 → F1 / F2.

---

## Epics

### D1 · Fleet renewal / compliance alerts  *(next)*
**Goal:** No mixer/pump/loader ever silently lapses its FC, insurance, PUC,
permit or road-tax.
- **Data model:** add `road_tax_expiry` to `vehicles`; reuse the existing
  `insurance/fitness/permit/pollution_expiry` columns. Optional generic
  `compliance_items` sub-entity (asset ref, doc type, last/next renewal, cost,
  warning lead-days) if we want history — start with columns, generalise later.
- **Logic:** new rules in `AlertsService` that surface documents expiring within
  a configurable window (soft/hard warning), grouped by vehicle; severity
  warning → danger as the date nears.
- **UI:** a "Fleet compliance" alert group on the dashboard; expiry columns on
  the vehicle master edit form.
- **DoD:** unit tests for the date-window rule; alerts appear for seeded expiries;
  typecheck/build/lint green.

### A1 · Material & UOM master depth
**Goal:** Materials and units rich enough to drive accurate batching and stock.
- **Data model:** `materials` gains `material_type`
  (cement/aggregate/admixture/water/additive/other), `specific_gravity`,
  `bulk_density`, `water_absorption_pct`, `default_moisture_pct`. New `uoms`
  master + `uom_conversions` (from-uom, to-uom, factor) — tenant-scoped, RLS.
- **Migrate** free-text `materials.uom` onto the UOM master (keep string as
  fallback).
- **DoD:** conversion helper unit-tested (m³↔MT↔kg↔L↔bag); migration reversible.

### A2 · Aggregate moisture & water/cement correction
**Goal:** Hold the design water/cement ratio despite wet aggregate — the core
RMC batching correctness gap (currently 0 lines).
- **Data model:** mix-design materials carry SSD/absorption context (from A1);
  batch ticket captures per-aggregate `measured_moisture_pct`; store
  `corrected_target_quantity` + `free_water_contributed` per material and an
  adjusted batch-water target.
- **Logic:** on batch-ticket creation, correct aggregate weights up for moisture
  and reduce added water by the free-water carried in, preserving w/c ratio;
  surface corrected-vs-design on the ticket.
- **DoD:** pure correction function unit-tested against worked examples; variance
  still computed on corrected targets.

### A3 · QC / Lab module (`qc`)
**Goal:** IS 456-grade quality control tied to production.
- **Data model:** `qc_slump_tests` (batch/dispatch ref, measured slump, pass),
  `qc_cube_sets` (grade, mix-design, casting date, specimen count, curing),
  `qc_cube_results` (test age 7/28d, load, compressive strength, individual +
  set mean, pass/fail per IS 456 acceptance).
- **Logic:** acceptance rule (mean ≥ fck + margin, no individual < fck − margin);
  QC dashboard; alerts for cubes due to test and for failed sets.
- **Permissions:** extend the existing `qc_engineer` role; enable the `qc`
  module. **DoD:** acceptance-rule unit tests; alerts fire.

### B2 · Pricing & GST depth
**Goal:** Real pricing + tax carried through the chain, not a Yes/No flag.
- Cash-vs-credit price / price levels; pump & transport freight modeled
  (per m³ / trip / km / pump-hour); GST **rate** + CGST/SGST/IGST breakup on
  quotation and order (today only a per-line boolean; tax appears only at
  invoice). **DoD:** tax carried quote→order→invoice reconciles to invoice math.

### B1 · Pour scheduling
**Goal:** Orders become real pour plans.
- **Data model:** `pour_schedule_slots` (order ref, site, date, start time, m³,
  truck-spacing minutes, pump required, sequence). Dispatch board reads the
  schedule; track scheduled-vs-delivered m³. **DoD:** schedule CRUD + a
  schedule-vs-delivered report.

### C1 · Receivables maturity ✅
**Goal:** Close the AR loop.
- Cheque lifecycle (deposited → realised / NSF-bounced) with reversal on bounce;
  apply a held advance to later invoices; credit/debit notes; write-offs with
  reason master; feed issued invoices + receipts into credit exposure (today
  exposure = opening + confirmed orders only). **DoD:** allocation + reversal
  unit/integration tested.
- **Delivered:** cheque clearing lifecycle on receipts (`clearing_status`:
  pending → realised | bounced) with `POST /receipts/:id/realise` and
  `/bounce` (bounce reverses every allocation, restoring each invoice's
  outstanding + payment status); apply a held advance across a customer's oldest
  open invoices (`/receipts/:id/apply`, greedy `allocateAcrossInvoices` helper);
  invoice bad-debt write-off (`POST /invoices/:id/writeoff`, `written_off_amount`
  column, `written_off` payment status). Both new mutations audited
  (`receipt.bounce`, `invoice.writeoff`). Web: receipts list gains realise /
  bounce / apply actions + a clearing badge; invoice detail gains a write-off
  action + written-off total. **Tests:** allocation unit-tested
  (`receipt-allocation.test.mjs`); the order-to-cash integration cycle now drives
  cheque → bounce (reversal) → advance → realise → apply → write-off end to end.
- **Deferred:** credit/debit notes; a structured write-off/bounce reason master
  (reasons are free-text today); folding issued invoices + receipts into the live
  credit-exposure calculation.

### D2 · Purchase / AP-lite (`purchase`) ✅
**Goal:** Own procurement of cement/aggregate/admixture/diesel.
- **Data model:** `purchase_orders` + items, `purchase_receipts` (link/extend the
  existing single-line `MaterialInward` into multi-line GRN), `vendor_bills`
  (3-way match: PO ↔ GRN ↔ bill, tolerance), `vendor_payments`. Enable the
  `purchase` module; reuse `suppliers` master. **DoD:** PO→GRN→bill→payment
  integration test; GRN posts to stock via the existing ledger.
- **Delivered:** eight tenant-scoped FORCE-RLS tables (`purchase_orders` +
  items, `goods_receipts` + items, `vendor_bills` + items, `vendor_payments` +
  allocations; migration `1720000034000`). Purchase order (create/issue/cancel,
  GST per line); multi-line goods receipt whose **post** increases stock through
  the shared `StockService.applyDeltaWithin` ledger (same path as material
  inward) and rolls received quantity onto the PO lines, advancing PO status via
  a pure `poReceiptStatus`; vendor bill created from a posted GRN with a pure,
  unit-tested **3-way match** (`matchLine`/`summariseMatch`: billed qty ≤
  accepted, billed rate ≈ PO rate within tolerance → `matched` /
  `over_tolerance` / `unmatched`), approve (audited) → payable committed; vendor
  payment allocated across approved bills (audited), advancing each bill's
  payment status. New permissions `purchase.view` / `purchase_orders.create` /
  `grn.create` / `vendor_bills.create` / `vendor_bills.approve` /
  `vendor_payments.create` granted to store/accounts/plant-manager roles;
  `purchase` (a phase-2 module) enabled per-tenant via the Super Admin toggle,
  as QC is. Web: Purchase Orders and Vendor Bills screens (raise PO → receive →
  bill → approve → pay) + nav group. **Tests:** 14 helper unit cases
  (`purchase-util.test.mjs`); a `purchase-cycle` integration test drives
  supplier → PO → GRN (asserts stock rose) → matched bill → approve → payment
  (bill settled). Reused the existing `suppliers` master.
- **Deferred:** partial/multi-GRN billing UI niceties, purchase returns / debit
  notes, and a supplier-outstanding (AP aging) report.

### E1 · Weighbridge hardware bridge
**Goal:** Live scale reads for inbound aggregate, with manual override.
- Serial/COM (or TCP indicator) read surfaced as a "Get weight" action into the
  weighbridge entry; manual-override flag retained; capture via the offline
  plant-app or a small local agent. **DoD:** simulated-indicator read path tested;
  manual path unchanged.

### A4 · Batching Integration (`batching_integration`)
**Goal:** Ingest actual batched weights from the plant controller instead of
hand-keying batch-ticket actuals; reconcile to tickets; enable the module.

### D3 · Fleet maintenance & fuel log
**Goal:** Service schedules, breakdowns and fuel/diesel-per-km for mixers &
pumps. Builds on D1's fleet data.

### D4 · Expense capture
**Goal:** Driver bata, fuel, plant/site expenses with cost allocation
(expense + expense-group masters, entry, allocation).

### B3 · Returned / short-load concrete & wastage
**Goal:** Reason + costing on the return-qty already captured on dispatch;
wastage reporting.

### F1 · Excel bulk import framework
**Goal:** Generic template-download → upload → tracked import job
(success/error counts) for opening balances, item and customer masters —
onboarding accelerator.

### F2 · Doc-numbering activation + correction trail
**Goal:** Activate the dormant FY-reset + per-plant series + online
reserved-number pool in `NumberingService`; add a generic correction/amendment
entity (old→new value, reason, corrected-by) for edits to posted documents.

---

## Definition of Done (every epic)

- Unit tests for pure logic; integration test for any new API flow.
- Migrations reversible (`up` → `revert` → `up` verified against a throwaway PG).
- New tenant tables under FORCE RLS with the NULLIF-guarded policy.
- New endpoints permission-gated and module-gated; new permissions/roles wired.
- `typecheck` + `build` + workspace `lint` green; web changes covered by the
  build.
- No regression to the existing 259 unit / 18 integration / e2e suites.
