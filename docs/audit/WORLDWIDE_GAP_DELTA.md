# Worldwide Gap Delta — Mix Nova RMC

> Maps the **worldwide** requirements corpus (`WORLDWIDE_RMC_REQUIREMENTS.md`)
> against what is **built today**, with a status (have / partial / missing) and a
> global-market priority for every domain, then rolls the misses up into a
> prioritised **worldwide gap register (GW-series)** that extends — rather than
> replaces — the India-Phase-1 gap register (`GAP_REGISTER_AND_RISK_REGISTER.md`,
> G1–G22).
>
> **Two yardsticks, stated deliberately.** The existing matrix/gap-register grade
> the build against the **Indian Phase-1 pilot bar** (where it scores ~70–75 %).
> This delta grades it against the **worldwide-product bar** (where it scores far
> lower). Neither number is wrong; they answer different questions. Read this doc
> as "how far from a globally-sellable product," not "how good is the pilot."

## 1. Status legend & method

- **HAVE** — built and (where noted) tested/owner-verified against this
  worldwide requirement.
- **PARTIAL** — a real but incomplete or single-market slice exists.
- **STORED-ONLY** — schema/fields exist but nothing generates/integrates (the
  Phase-1 "ready-only" pattern).
- **MISSING** — no code.
- **Pri** — global-market priority from the corpus (P0 legal/conformance blocker
  in ≥1 major market · P1 credibility · P2 differentiator).

Evidence for "HAVE/PARTIAL" is the As-Is audit + the Wave-0/1/2 + RLS +
observability work already merged to `main` (PRs #2/#3/#4). Nothing in this doc
changes production code — it is analysis only.

## 2. Domain-by-domain delta

### WR-STD — standards, mix design & QC

| Requirement | Status | Pri | Evidence / gap |
|---|---|---|---|
| WR-STD-1 pluggable standards profile | MISSING | P0 | Build is IS-only, implicit; no profile switch. |
| WR-STD-2 units & rounding engine | MISSING | P0 | m³/INR/MPa implicit; no US-customary, no per-profile rounding. |
| WR-STD-3 exposure-class catalog | MISSING | P1 | Mix is free-form; no exposure taxonomy. |
| WR-STD-4 approved versioned mix register | PARTIAL | P0 | Mix + approval gate exist; **create/edit ungated (G8)**; no w/c/exposure/chloride limits. |
| WR-STD-5 approval workflow + expiry + typing | PARTIAL | P1 | Approval state real; no ≤24-month expiry, no designed/prescribed typing. |
| WR-STD-6 region-driven delivery ticket | PARTIAL | P0 | Challan built; missing batch-time-at-water, drum revolutions, printed discharge deadline, temperature, acceptance signature. |
| WR-STD-7 e-ticket signature/immutable/agency API | MISSING | P1 | Static PDF; no digital signature, immutability, or AASHTOWare export. **Top US/Canada export blocker.** |
| WR-STD-8 discharge-time + revolution clock | MISSING | P0 | Not modelled (matrix §6 already flags IS-4926 timers absent). |
| WR-STD-9 governed site-water addition | MISSING | P0 | No trim-allowance/re-slump/revolution logic. |
| WR-STD-10 fresh QC (slump/temp/air) + tolerance | PARTIAL | P0 | Slump note exists; no tolerance pass/fail, no temperature/air capture. |
| WR-STD-11 per-constituent batch tolerance | PARTIAL | P0 | Variance-vs-tolerance exists on manual batch; not per-standard, not actuals-driven. |
| WR-STD-12 calibration register + truck fitness | MISSING | P1 | No calibration/blade-wear/meter records. |
| WR-STD-13 sampling-frequency scheduler | MISSING | P0 | No sampling schedule/under-sampling alerts. |
| WR-STD-14 statistical acceptance engine | MISSING | P0 | Cube register is "≥ grade"; no IS 456 Table 11 / ACI 3-consecutive / EN σ. |
| WR-STD-15 low-strength NCR workflow | MISSING | P1 | No core-test/disposition path. |
| WR-STD-16 chloride-class enforcement | MISSING | P0 | No chloride computation/limits. |
| WR-STD-17 exposure-driven w/c + sulfate class | MISSING | P0 | No durability limiting-value checks. |
| WR-STD-18 maturity method (C1074) | MISSING | P2 | Not present. |
| WR-STD-19 batch-to-structure traceability + retention | PARTIAL | P1 | Audit log strong; no constituent-cert→placement lineage; retention not enforced (matrix §13). |

**Roll-up:** essentially the entire QC/standards layer beyond basic grade/slump
capture is MISSING; two P0 clusters (discharge/revolution control; statistical
acceptance + durability enforcement) are the domain-critical gaps.

### WR-BCI — batch-controller integration

| Requirement | Status | Pri | Evidence / gap |
|---|---|---|---|
| WR-BCI-1..6 registry/config/adapters/canonical model | MISSING | P1 | Only manual batch entry; matrix §5.1 confirms "no importer, no connector config." |
| WR-BCI-7..9 two-way download / autobatch / actuals upload | MISSING | P1 | No controller link at all. |
| WR-BCI-10 moisture-corrected weights | MISSING | P1 | No moisture ingestion. |
| WR-BCI-11 in-transit quality correlation | MISSING | P1 | No COMMANDassurance/Verifi ingestion. |
| WR-BCI-12 three-way reconciliation | MISSING | P0* | Bills on manual batch; no ordered↔batched↔delivered reconciliation. |
| WR-BCI-13 offline buffer / errors / audit / OT security | MISSING | P1 | No edge agent; generic app audit only. |

**Roll-up:** the batch-controller integration foundation is **entirely
greenfield** and depends on the provider-registry backbone (GW-1) that does not
exist.

### WR-TEL — telematics & dispatch

| Requirement | Status | Pri | Evidence / gap |
|---|---|---|---|
| WR-TEL-1..4 ingestion/drum/water/snail-trail/registry | MISSING | P1 | GPS columns only (matrix §10 §5.3 DOC-ONLY); no ingestion, no AIS-140/NavIC. |
| WR-TEL-5..9 status FSM / geofence fusion / durations / ETA / webhooks | MISSING | P1 | Manual/event statuses only; no geofencing, ETA, or event bus. |
| WR-TEL-10..12 driver app / ePOD / DVIR / HOS | MISSING | P1 | No driver app; challan share is `wa.me` only. |
| WR-TEL-13 dispatch optimization | MISSING | P1 | Manual dispatch board; no spacing/assignment/optimizer/multi-plant balancing. |
| WR-TEL-14 KPI suite from phase durations | MISSING | P1 | No phase durations → cycle/on-time/utilization unmeasurable. |

**Roll-up:** telematics + auto-status spine is MISSING; everything downstream
(POD, optimization, KPIs) is blocked on it.

### WR-COM — commerce, portal & payments

| Requirement | Status | Pri | Evidence / gap |
|---|---|---|---|
| WR-COM-1 self-service portal | MISSING | P1 | No customer portal; ordering is internal. |
| WR-COM-2 live customer tracking | MISSING | P1 | No customer-facing tracking/ETA. |
| WR-COM-3 e-ticket + ePOD to customer | PARTIAL | P1 | Challan PDF + `wa.me` share; no signed receipt/photos/collaboration record. |
| WR-COM-4 online payments + AR self-service (UPI AutoPay/e-NACH) | MISSING | P1 | No payment gateway; AR is internal. |
| WR-COM-5 omnichannel notifications | PARTIAL | P1 | `wa.me` link + log only; **no API send, no SMS/email transports** (matrix §10 §9/§5.5). |
| WR-COM-6 consent/preference engine (DLT/TCPA/GDPR) | MISSING | P0 | No consent records; legal blocker for messaging at scale. |
| WR-COM-7 CRM + quoting/contract-rate | PARTIAL | P1 | Leads + rate contracts + quotation-discount approval exist; no CRM/quote-to-close. |

**Roll-up:** the customer-facing commerce layer is largely MISSING; the one P0
(consent engine) is a legal messaging blocker.

### WR-FIN — enterprise finance, costing & ops

| Requirement | Status | Pri | Evidence / gap |
|---|---|---|---|
| WR-FIN-1..2 four-pool cost/m³ + mix roll-up | MISSING | P1 | No costing; margin unmeasured. |
| WR-FIN-3 standard-vs-actual variance | MISSING | P1 | No actuals feed / variance engine. |
| WR-FIN-4 margin by dimension | MISSING | P1 | Revenue/volume only, not profitability slices. |
| WR-FIN-5 returned-concrete costing | MISSING | P1 | Return qty capturable; not costed by cause. |
| WR-FIN-6 standing charges / demurrage / short-load | MISSING | P1 | Not tracked/billed. |
| WR-FIN-7 multi-currency/UOM standard cost | MISSING | P1 | INR/m³ only. |
| WR-FIN-8 procurement / 3-way match / rebates / reorder | MISSING | P1 | No PO/GRN/match/rebate/reorder engine. |
| WR-FIN-9 perpetual silo inventory + moisture + yield | PARTIAL | P1 | Stock ledger + adjustments exist; no silo sensors, moisture-corrected dry-basis, or yield reconciliation. |
| WR-FIN-10 controller-fed actual consumption | MISSING | P1 | Manual only. |
| WR-FIN-11 CMMS (maintenance) | MISSING | P1 | No asset register/PM/work orders. |
| WR-FIN-13 legal-for-trade calibration records | MISSING | P1 | Absent (also WR-STD-12). |
| WR-FIN-14..15 AR + credit control | HAVE | P1 | **Order-to-cash AR, allocation, ageing, credit-hold — owner-verified (matrix §4/§9).** |
| WR-FIN-16 multi-company/currency GL + consolidation | MISSING | P1 | Single-entity/INR; no dimensioned GL/consolidation. |
| WR-FIN-17 bidirectional accounting integrations | PARTIAL | P1 | Tally CSV (invoices only), one-way (matrix §10 §5.4). |
| WR-FIN-18 HR/payroll (trip pay) | MISSING | P1 | No timekeeping/payroll. |
| WR-FIN-19 analytics/BI/forecasting/benchmarking | PARTIAL | P1 | Static report endpoints; no real-time KPI/forecast/benchmark. |

**Roll-up:** the **order-to-cash + AR + credit slice is the one genuine HAVE**;
the rest of enterprise finance/ops (costing, procurement, yield, CMMS,
consolidation, BI) is MISSING or single-market PARTIAL.

### WR-TAX — tax & e-invoicing / transport compliance

| Requirement | Status | Pri | Evidence / gap |
|---|---|---|---|
| WR-TAX-1..2 clearance-provider model + outbox | MISSING | P0 | No provider seam; billing logic would fork per country. |
| WR-TAX-3..4 EN 16931 model + serializers + hybrid docs | MISSING | P0 | No XML/JSON serializer, no inbound parsing. |
| WR-TAX-5..6 config tax engine + rounding + multi-currency | STORED-ONLY / MISSING | P0 | Single hardcoded GST fn; fixed half-up rounding (fails EN 16931 BR-CO); **no currency column**. |
| WR-TAX-7 product tax-classification catalog | PARTIAL | P0 | `hsn_sac` nullable free text; no 6-digit enforcement / NCM/ClaveProdServ. |
| WR-TAX-8 signing + QR + chaining | MISSING | P0 | `signed_qr_code` never populated; no signing/HSM. |
| WR-TAX-9 archival + retention + audit export | MISSING | P1 | No WORM/retention/SAF-T. |
| WR-TAX-10 legal-status lifecycle state machine | STORED-ONLY | P0 | `einvoice_status` flat string; no submitted/cleared/rejected; no dispatch gating. |
| WR-TAX-11 tenant→regime binding + mandate-scoping + counterparty validation | MISSING | P0 | No threshold scoping, no VIES/Peppol/GSTIN-checksum. |
| WR-TAX-12 India IRN via IRP | STORED-ONLY | P0 | IRN/ack/QR fields stored READY-ONLY; **no IRP call** (matrix §8 §4.2). |
| WR-TAX-13 India e-way bill | STORED-ONLY / PARTIAL | P0 | e-way fields stored; cancel-and-reissue path exists but **no auto-threshold flag, no API, no distance→validity** (matrix §8 §4.4). |
| WR-TAX-14 other-regime transport docs | MISSING | P1 | No Carta Porte/CT-e/e-Transport. |

**Roll-up:** compliance is a **"fields-only" stub** — legally-valid e-invoicing
exists in *zero* markets today, and RMC's transport-document critical path
(WR-TAX-13/14) is inert.

### WR-SUS — sustainability & circularity

| Requirement | Status | Pri | Evidence / gap |
|---|---|---|---|
| WR-SUS-1..2 LCA/EPD + Buy-Clean rules | MISSING | P1 | No carbon engine. |
| WR-SUS-3..4 low-carbon optimization + maturity telemetry | MISSING | P2 | Absent. |
| WR-SUS-5 returned-concrete + recycled-water tracking | MISSING | P1 | Return qty capturable, not tracked for reuse/CO₂. |
| WR-SUS-6 ESG / Scope 1/2/3 / CSRD | MISSING | P2 | Absent. |

**Roll-up:** entire sustainability domain MISSING — increasingly a bid
prerequisite in EU/US/ME public procurement.

### WR-PLT — platform & cross-cutting

| Requirement | Status | Pri | Evidence / gap |
|---|---|---|---|
| WR-PLT-1 multi-region localization | MISSING | P0 | Single locale/units/currency; i18n asserted-not-evidenced (matrix §12). |
| WR-PLT-2 multi-jurisdiction-per-tenant | PARTIAL | P0 | Multi-tenant isolation strong (RLS); **not** multi-jurisdiction/entity. |
| WR-PLT-3 provider registry + queue + webhooks | MISSING | P1 | Backbone absent (matrix §10 §5.x = G11). |
| WR-PLT-4 offline-first resilience | PARTIAL | P1 | Sync MVP (3 ops) + keyset pull hardening merged; not plant-edge/driver-app breadth. |
| WR-PLT-5 security hygiene at scale | PARTIAL/HAVE | P0 | Fail-boot secrets, cookie/rotated auth, RLS-on-users all merged; MFA + vault + at-rest still open (G3). |
| WR-PLT-6 resilient integration semantics | PARTIAL | P1 | Error alerting + outbox patterns exist in parts; not a shared adapter contract. |
| WR-PLT-7 observability | HAVE→extend | P1 | **Structured logs + 5xx alerting + Prometheus metrics merged;** tracing/SLOs/integration-health to add. |
| WR-PLT-8 global data-protection & consent | MISSING | P0 | No DPDP/GDPR/DLT consent, no breach runbook (G15). |
| WR-PLT-9 HA/DR at scale | PARTIAL | P1 | GFS backups + restore drill; off-box/PITR/staging/HA still owner-action (G4/G5/G13/G14). |

## 3. Worldwide gap register (GW-series)

These are **new, worldwide-scope** gaps that sit *above* the India-Phase-1
G1–G22. Each names the domain, the corpus requirements it closes, and why it
gates a globally-sellable product. Priority is the worldwide-market bar.

| ID | Worldwide gap | Pri | Closes | Why it blocks a global product |
|---|---|---|---|---|
| GW-1 | **Integration provider-registry + async queue + webhooks backbone** (subsumes G11) | P1 | WR-PLT-3, WR-BCI-1/2, WR-TEL-9, WR-TAX-1, WR-COM-5 | Every live integration (controller, telematics, clearance, payment, messaging, accounting) is greenfield until this shared substrate exists. |
| GW-2 | **Pluggable clearance-provider + EN 16931 canonical model** | P0 | WR-TAX-1/3/10 | Get these two seams right and India/Italy/Poland/Mexico/Saudi/Peppol become adapters, not rewrites; without them no market's e-invoicing is legal. |
| GW-3 | **Config-driven, effective-dated multi-jurisdiction tax engine + multi-currency + rounding** | P0 | WR-TAX-5/6/7, WR-FIN-7 | The single hardcoded GST fn + fixed rounding + no currency column can't express any other regime or pass EN 16931 validation. |
| GW-4 | **Transport-document clearance on the dispatch critical path** (India e-way live + abstraction) | P0 | WR-TAX-12/13/14, WR-STD-6 | A concrete truck cannot legally roll without the e-way bill / Carta Porte / e-Transport; today these are inert stored fields. |
| GW-5 | **Pluggable standards/units/exposure engine** | P0 | WR-STD-1/2/3/17 | An IS-only, m³/MPa build cannot be sold into EN/ASTM/AS/CSA markets at all. |
| GW-6 | **Discharge-time/revolution clock + governed site-water + fresh-QC tolerance capture** | P0 | WR-STD-8/9/10/11 | Domain-critical concrete-quality governance mandated by every standard (incl. IS 4926) and absent today. |
| GW-7 | **Statistical acceptance + durability (chloride/w-c/exposure) enforcement** | P0 | WR-STD-13/14/16/17 | "Cube ≥ grade" is not conformance anywhere; statistical acceptance + durability limits are legally required. |
| GW-8 | **Batch-controller two-way integration + moisture-corrected reconciliation** | P0* | WR-BCI-* , WR-FIN-3/9/10 | The defining RMC-software capability and the control that stops billing target while delivering less. *P0 wherever the controller can return actuals. |
| GW-9 | **Telematics ingestion + automatic-status FSM spine** | P1 | WR-TEL-1..9 | The load-bearing base under POD, dispatch optimization and every operational KPI; also AIS-140 legal in India. |
| GW-10 | **Driver app (offline ePOD/DVIR/HOS) + dispatch optimization + KPIs** | P1 | WR-TEL-10..14 | Proof-of-delivery, spacing/assignment optimization and cycle-time economics — the competitive core of modern RMC logistics. |
| GW-11 | **Customer portal + live tracking + online payments (UPI AutoPay/e-NACH)** | P1 | WR-COM-1/2/3/4 | Self-service ordering/tracking/pay is a baseline buyer expectation; `wa.me`-only is a visible competitive gap. |
| GW-12 | **Omnichannel messaging + consent engine (DLT/TCPA/GDPR)** (subsumes G12 messaging) | P0 | WR-COM-5/6, WR-PLT-8 | Messaging at scale without registered consent is illegal in India/US/EU. |
| GW-13 | **Enterprise finance depth: costing, procurement/3-way-match, yield, CMMS, consolidation, BI** | P1 | WR-FIN-1..19 | The order-to-cash core exists, but costing/margin, procurement, yield, maintenance/calibration, multi-entity consolidation and real-time BI do not — required for enterprise multi-plant buyers. |
| GW-14 | **Sustainability: LCA/EPD + Buy-Clean + returned-concrete/ESG** | P1 | WR-SUS-1..6 | Fast-emerging bid prerequisite in EU/US/ME public procurement; entirely absent. |
| GW-15 | **Multi-region localization + multi-jurisdiction-per-tenant + global data-protection** | P0 | WR-PLT-1/2/8 | Structural prerequisites to operate/sell outside India; extend the strong single-tenant isolation to multi-jurisdiction groups. |
| GW-16 | **Scale infra hardening: HA/PITR/staging/CD/secrets-vault/MFA/tracing** | P1 | WR-PLT-5/7/9 | Extends already-merged security+observability work to the multi-paying-tenant bar (also G3/G4/G5/G10/G13/G14). |

### Relationship to the existing India-Phase-1 register (G1–G22)

- **Already closed by merged work:** G1 (fail-boot secrets), G2 (cookie/rotated
  auth), G6 (sync keyset), G7 (unit tests), G9 (RLS-on-users), G10
  (observability trio) — these lift several GW items part-way (GW-15/16).
- **Owner-action infra still open:** G3, G4, G5, G13, G14 → folded into **GW-16**.
- **Integration/compliance gaps promoted to worldwide scope:** G11→**GW-1**,
  G12→**GW-2/3/4/12**, G15→**GW-12/15**, G18 (missing masters incl.
  transporter) → prerequisite to **GW-4**.
- **New at worldwide scope (no Phase-1 equivalent):** GW-5/6/7 (standards/QC),
  GW-8/9/10 (controller+telematics), GW-11 (portal/pay), GW-13 (finance depth),
  GW-14 (sustainability).

## 4. Suggested sequencing (worldwide track)

Not a commitment — a dependency-aware ordering so the P0 legal/structural seams
land before the features that ride on them:

1. **Foundational seams (P0, unblock everything):** GW-15 (localization +
   multi-jurisdiction), GW-1 (provider backbone), GW-5 (standards/units engine),
   GW-3 (tax engine + currency).
2. **Legal-to-operate per target market (P0):** GW-2 (clearance model) + GW-4
   (transport docs) for the first expansion country; GW-6/GW-7 (discharge/QC +
   acceptance/durability); GW-12 (consent) before any messaging.
3. **Defining RMC capability (P0*/P1):** GW-8 (two-way batch + reconciliation),
   then GW-9 (telematics/status spine).
4. **Competitive & enterprise (P1):** GW-10 (driver app/dispatch/KPIs), GW-11
   (portal/payments), GW-13 (finance depth).
5. **Emerging table-stakes (P1/P2):** GW-14 (sustainability), GW-16 (scale infra
   continues in parallel throughout).

## 5. Bottom line

Against the **worldwide** bar, Mix Nova today is a **strong, correctly-isolated
Indian Phase-1 order-to-cash core** with a fresh security + observability
uplift — and **~10–15 % of a globally-sellable RMC platform**. The delta is
dominated by **P0 structural/legal seams** (localization + jurisdiction, clearance
+ tax engine, transport docs, standards/units, discharge/QC + acceptance) and the
**defining RMC integration spine** (two-way batch, telematics/auto-status). The
good news mirrors the Phase-1 finding: the missing work is **additive and
well-understood** on top of a healthy data/isolation/functional core — none of it
requires unwinding what is already built. The requirements are now owned and
world-complete on paper (`WORLDWIDE_RMC_REQUIREMENTS.md`); this delta is the
map from that horizon back to today.
