# Worldwide RMC Requirements Corpus — Mix Nova RMC

> A consolidated, de-duplicated, **globally-sourced** requirements corpus for a
> Ready-Mix-Concrete SaaS/ERP that could be sold worldwide (or to multi-country
> groups), not only into the Indian pilot market. It is the *authoritative
> superset* of what world-class RMC software does — synthesised from a
> structured worldwide research sweep — so the product's scope is owned here and
> not left for the customer to discover, specify, or correct.
>
> **Companion docs:** `WORLDWIDE_GAP_DELTA.md` (this corpus mapped against what
> is built today — have/partial/missing, prioritised), and the existing
> India-Phase-1 lens in `REQUIREMENT_TRACEABILITY_MATRIX.md` +
> `GAP_REGISTER_AND_RISK_REGISTER.md`.

## 1. Scope, method, and how to read this

**What this is.** The union of capabilities that market-leading RMC platforms
(Command Alkon/CONNEX/TrackIt/COMMANDassurance, Sysdyne ConcreteGO/iStrada,
Marcotte, BCMI/XBE, Jonel, MPAQ, plus adjacent leaders Giatec, Climate Earth,
INFORM, Trimble/Coretex) ship, plus the **statutory and standards obligations**
that make an RMC product legal and credible in the EU/UK, US, Canada,
Australia/NZ, the Middle East, LATAM and India. Every line is written to be
**testable** and carries a **WHY** and a **source anchor** (a standard clause, a
regulation, or an observed market capability).

**What this is *not*.** It is not a commitment to build all of it, and it is not
Phase-1 scope. It is the horizon the roadmap is prioritised *against*. Deliberate
deferrals stay deferrals — but they are now deferrals of a *named, sourced*
requirement, not of an unknown.

**Method / trust caveat.** Compiled from a worldwide WebSearch/WebFetch sweep
across eight domains. Several primary vendor and standards domains (Command
Alkon, Sysdyne, NRMCA, BIS, ASTM, concrete.org.uk, ZATCA, etc.) were blocked by
the environment's egress proxy, so specific numeric thresholds and clause
numbers are drawn from search-result extracts and reputable secondary summaries.
**Every hard number below (tolerances, discharge minutes, tax thresholds,
statistical-acceptance coefficients, chloride limits) must be re-verified against
the current purchased edition / official portal before being encoded as a
validation rule** — many standards have 2023–2026 revisions (ASTM C94-24a, EN
206-1/-2:2026, CSA A23.1:24, BS 8500-1:2023) and tax mandates move quarterly.

**ID scheme.** `WR-<DOMAIN>-<n>`, domains:
`STD` standards/QC · `BCI` batch-controller integration · `TEL` telematics &
dispatch · `COM` commerce/portal/payments · `FIN` enterprise finance & ops ·
`TAX` tax & e-invoicing · `SUS` sustainability & circularity · `PLT` platform &
cross-cutting non-functional.

**Global-market priority.** `P0` = legal/conformance blocker in ≥1 major market
(cannot sell/operate there without it) · `P1` = strongly expected, needed to be
credible against incumbents · `P2` = differentiator / advanced. Priority is at
the **worldwide-product** bar, deliberately *higher* than the Phase-1 pilot bar
used in the existing gap register.

**De-duplication.** Cross-domain overlaps (e-ticket/ePOD, batch tolerances,
in-drum QC, returned concrete, moisture correction) are stated **once** in their
primary domain and cross-referenced (`↔ WR-…`) elsewhere, so a capability is
never double-counted in the gap delta.

---

## 2. WR-STD — Concrete standards, mix design & quality control

*Source domains: EN 206 / BS 8500 (EU/UK), ASTM C94 + ACI 318/301/305.1/306 (US),
AS 1379 (AU/NZ), CSA A23.1/A23.2 (Canada), IS 4926/456/1199/516/10262/4925
(India), ASTM C1074 (maturity), FHWA EDC-6 / AASHTO / NRMCA (e-ticketing).*

| ID | Requirement (testable) | Pri | WHY / source anchor |
|---|---|---|---|
| WR-STD-1 | **Pluggable standards profile** per tenant/plant (EN 206+BS 8500 \| ASTM C94/ACI 318 \| AS 1379 \| CSA A23.1 \| IS 4926/456) that drives tolerances, ticket field-sets, discharge defaults, acceptance math and units — none hard-coded to one country. | P0 | Every rule below differs by region; one hard-coded market can't be sold elsewhere. EN 206 / ASTM C94 / AS 1379 / CSA / IS. |
| WR-STD-2 | **Units & rounding engine**: SI (mm, MPa, °C, kg, m³, kg/m³) and US-customary (in, psi, °F, lb, yd³); canonical SI stored internally; per-profile display + rounding. | P0 | ASTM/ACI use psi/in/°F/yd³; EN/AS/CSA/IS use MPa/mm/°C/m³. Mixing units mis-bills and mis-batches. |
| WR-STD-3 | **Exposure-class catalog** per profile (EN/BS8500 X0/XC/XD/XS/XF/XA + DC; ACI 318 F/S/W/C; IS 456 Mild→Extreme; AS 1379 classes) driving max w/c, min/max cement, cover, min strength, chloride & air limits. | P1 | Exposure class is the master durability key. BS 8500 tables; ACI 318 §19.3; IS 456 Tables 3/5. |
| WR-STD-4 | **Approved, versioned mix-design register** per batch: grade/class, target & max w/c, min/max cementitious, Dmax, consistency/slump class, air target, chloride class, exposure class(es), per-m³ proportions, admixture & SCM dosages. | P0 | Designed/performance concrete requires provable limits, batch-traceable to an approved recipe. EN 206 §6; ASTM C94 §6; ACI 301; IS 456 §9/IS 10262. |
| WR-STD-5 | **Mix-approval workflow with expiry & responsibility typing** (draft→approved→superseded; strength-qualification data ≤24 months per ACI 301; typed Designated/Designed/Prescribed/Proprietary \| Normal/Special class). | P1 | Compliance responsibility (producer vs specifier) shifts by type; qualification data ages out. ACI 301; BS 8500-1; AS 1379. |
| WR-STD-6 | **Region-driven delivery ticket / docket** carrying the superset of mandated fields (producer+plant identity, unique serial, truck/driver, purchaser+site, designation, specified 28-day strength, ordered+cumulative volume, **batch time = first water–cement contact**, on-site/arrival/discharge-start/complete times, **total drum revolutions**, **printed discharge deadline**, batched constituent weights, admixtures, concrete temperature, operator + acceptance signatures). | P0 | The ticket is the legal supply record and invoice/dispute basis; each standard prescribes the field list. EN 206 §8; ASTM C94 §14; CSA A23.1 5.2.5.5.1; IS 4926. ↔ WR-COM-3 (e-ticket delivery), WR-TEL-11 (ePOD). |
| WR-STD-7 | **e-Ticket with digital signature, immutable timestamps, tamper-evident audit, and agency CSV/API export** (AASHTOWare-compatible); issued tickets write-once, corrections as versioned amendments. | P1 | CSA allows e-tickets; FHWA EDC-6 mandates them across ≥10 US DOTs with digital signature/immutability; the single biggest US/Canada export-readiness gap. FHWA EDC-6; Caltrans; CSA A23.1. |
| WR-STD-8 | **Discharge-time clock + drum-revolution limit** started at first water–cement contact, deadline per profile (ASTM 90 min/300 rev, purchaser-stated limit overrides post-2021; IS 4926 120 min/~300 rev; CSA 90→60 min in heat), with waiver/retarder-extension handling. | P0 | Discharging past the workability window without control degrades strength/durability; deadline is standard-specific and now order-configurable in the US. ASTM C94 §11; IS 4926; CSA A23.1. |
| WR-STD-9 | **Governed single site-water addition** bounded by pre-computed trim allowance so design max w/c is not exceeded; forces re-slump, logs +30 revolutions, captures authoriser, prints added quantity; **default PROHIBIT** under EN 206/IS 4926 and flag any add as a conformity breach; full water-source accounting (batched, withheld, ice, aggregate free-moisture, wash). | P0 | Water beyond design w/c voids conformity (EN 206) / is prohibited (IS 4926); ASTM/AS 1379 allow one controlled, documented add only. NRMCA CIP-26; ASTM C94 §11–12. |
| WR-STD-10 | **Fresh-concrete QC capture with tolerance validation**: slump/flow at discharge (auto pass/fail per ASTM +0/−40/−65 mm, AS ±25/±30 mm, EN S/F/V/C classes, IS 1199), **concrete temperature** (ACI 305.1 ≤35 °C, ACI 306 cold triggers, EN +5 °C min), **air content** (±1.5 % of spec; ACI exposure-driven target air), density/yield and (EN) water-penetration. | P0 | Out-of-tolerance slump/air/temperature is a rejection trigger and an unauthorised-water indicator. ASTM C94 §7; AS 1379; EN 206 §4.2.1; ACI 305.1/306; IS 1199. |
| WR-STD-11 | **Per-constituent batch-tolerance validation** (ASTM cement ±1 % / agg ±2 % / water ±3 % / admix ±3 %; IS 4926 cement ±2 % / agg ±3 % / water ±3 % / admix ±5 %) with out-of-tolerance flag/hold. | P0 | Out-of-tolerance batches are non-conforming and must be blocked/dispositioned. ASTM C94 §9; IS 4926/4925. ↔ WR-BCI-9 (actuals-driven check from the controller). |
| WR-STD-12 | **Scale/water-meter calibration register + truck-mixer fitness gating** (scale ±0.15 % cap / ±0.4 % load; water meter ±1.5 % ≥6-monthly; drum-blade wear ≥90 % radial height; working revolution counter) blocking/warning on overdue. | P1 | Tolerances are meaningless without calibrated legal-for-trade devices; NRMCA cert requires it. ASTM C94 §9; NRMCA Plant/Truck Cert; IS 4925. ↔ WR-FIN-13 (CMMS calibration). |
| WR-STD-13 | **Sampling-frequency scheduler with under-sampling alerts** per profile (ACI once/day or /150 yd³ or /5000 ft², ≥5 tests/mix; IS 456 §15.2.2 banded + ≥1/shift; IS 4926 §12 per-50/100 m³; EN initial vs continuous). | P0 | Under-sampling invalidates acceptance and is a common audit finding. ACI 318 §26.12; IS 456 §15; IS 4926 §12; EN 206 §8. |
| WR-STD-14 | **Specimen lifecycle + automated statistical acceptance engine**: sample→specimens→cast→cure→test-age→break; profile-specific acceptance (ACI 318 §26.12.3.1 3-consecutive; IS 456 Table 11 mean-of-4 + individual; EN 206 initial n=3 / continuous n≥15 σ-based; AS 1379 statistical assessment); running SD / required-average-strength (f'cr). | P0 | Acceptance is statistical, not single-cube; the formula differs per market and must be automated to be reliable. ACI 318 §26.12; IS 456 §16 Table 11; EN 206 §8.2.1.3. |
| WR-STD-15 | **Low-strength investigation (NCR) workflow**: failing result opens a case supporting ASTM C42 core testing (85 % avg / 75 % individual), retest, engineer disposition. | P1 | Codes prescribe an investigation path before accept/reject. ACI 318 §26.12.6; ASTM C42. ↔ WR-STD-19. |
| WR-STD-16 | **Chloride-class enforcement**: compute chloride contribution from all constituents/admixtures and block a mix exceeding its class (EN/BS8500 Cl 0.10/0.30/0.40/1.0; ACI 318 Table 19.3.2.1 0.06–1.00; IS 456 0.6/0.4 kg/m³). | P0 | Chloride drives rebar corrosion; exceedance is a hard durability failure. BS 8500; ACI 318 §19.3.2; IS 456 §8.2.5.2. |
| WR-STD-17 | **Exposure-driven w/c + min/max cement enforcement** and **sulfate/aggressive-ground (ACEC/DC/S) class** selecting cement type/limits; intended-working-life (50/100 yr) + cover linkage. | P0 | Durability limiting values are defined per exposure/working-life. IS 456 Tables 4/5; EN 206/BS 8500; ACI 318 §19.3. |
| WR-STD-18 | **Maturity method (ASTM C1074)**: per-mix strength-maturity calibration (Nurse–Saul TTF and/or Arrhenius equivalent-age), field temperature-history ingestion, in-place strength estimate with milestone ("reached 75 % f'c → formwork removal"). | P2 | Non-destructive in-place strength for stripping/opening decisions. ASTM C1074; FHWA maturity guidance. ↔ WR-SUS-4, WR-TEL-4. |
| WR-STD-19 | **Full batch-to-structure traceability + constituent conformity register + NCR + enforced retention**: constituent lot/cert → mix → batch → truck → ticket → placement element → samples → results; supplier certs; retention prevents deletion within statutory period. | P1 | Conformity & defect investigation need end-to-end traceability. EN 206 §9; ASTM C94; CSA A23.1. ↔ WR-BCI-13, WR-TAX-16. |

---

## 3. WR-BCI — Batch-plant controller integration

*Source domains: Command Alkon COMMANDbatch / Marcotte / ULink-BISYNC; Sysdyne
Open API / CloudBatch; Scale-Tron BatchTron; MPAQ TouchBatch; ELKON/Schwing/
Liebherr/Ammann/Simem/Fibo/MEKA; Hydronix moisture; COMMANDassurance / Verifi
in-drum; protocols OPC-UA, Modbus, MQTT, REST, file/CSV, serial.*

| ID | Requirement (testable) | Pri | WHY / source anchor |
|---|---|---|---|
| WR-BCI-1 | **Controller-provider driver registry** (versioned) declaring per provider: protocol(s), transport(s), capability flags (one-way/two-way/autobatch/moisture-report/tolerance-report/inventory-feedback) and driver semver; workflows bind only to advertised capabilities and degrade **explicitly** (recorded) otherwise. | P1 | Controllers are heterogeneous and 15–30-yr-lived; silent capability assumptions cause billing disputes. ULink two-way vs file-drop plants. |
| WR-BCI-2 | **Driver isolation & hot-swap**: each driver independently deployable/versioned per plant; a driver fault never crashes the platform or other tenants' drivers. | P1 | Adding an OEM or patching a ULink quirk must not need a platform release or risk cross-tenant blast radius. |
| WR-BCI-3 | **Per-tenant/plant/controller config object**: provider id, transport params (IP/port, serial, folder, broker/topic, OPC endpoint+node map, REST base), credential ref, unit system, material↔channel/scale/silo mapping, mix-ID mapping, tolerance profile, enable flags — with full tenant isolation of transport & secrets. | P1 | Multi-tenant, multi-plant, mixed-protocol coexistence under one code path with zero shared mutable state. |
| WR-BCI-4 | **Material & scale-channel mapping** resolving physical channels ("SCALE 3") to canonical materials (cement/SCM/water/admix-n/agg-n), silos and moisture-probe↔aggregate bindings; unmapped channel raises a config error, never a silent drop. | P1 | Controllers speak channels; ERP/reconciliation speak materials/inventory. Without the map, actuals can't be attributed. |
| WR-BCI-5 | **Pluggable transport/protocol adapters** — REST/webhook, OPC-UA client, Modbus TCP/RTU, MQTT, file/CSV (watched folder/SFTP), serial, and **ULink/BISYNC** — behind one internal interface (`downloadMix`/`pushOrder`/`readActuals`/`subscribeTelemetry`/`heartbeat`), conformance-tested against simulators. | P1 | Same business logic must run whether the plant speaks OPC-UA, Modbus, ULink, REST or a CSV drop. Normalising at the adapter boundary is the only scalable path. |
| WR-BCI-6 | **Canonical batch data model** (`MixDesign` / `Order-Ticket` / `AsBatched{per-material target,actual,moisture,SSD-corrected,in-tolerance,variance; batch+added water; sequence; timestamps}` / `Delivered{yield,unit-weight,on-site water}`); "missing" is `null + source_unavailable`, never `0`. | P1 | Reconciliation/audit/reporting written once on a stable schema; encoding missing as zero corrupts yield & inventory. |
| WR-BCI-7 | **Two-way mix/recipe download**: push resolved target quantities, tolerances, sequencing, moisture-handling (SSD vs as-is), target slump/w-c, admixture dosing — keyed to ticket/truck, with idempotent supersede/versioning and echo/checksum confirmation. | P1 | The plant batches the *authoritative* office mix (not a stale local copy), eliminating transcription drift. ULink two-way / Sysdyne shared-DB model. ↔ WR-STD-4. |
| WR-BCI-8 | **Autobatch queue coupling**: push the queued order for a specific truck so the controller autobatches, and reflect controller queue/lane status back into dispatch (no manual status re-entry). | P1 | Autobatch is the productivity payoff of two-way integration; one-way push desyncs the yard. ↔ WR-TEL-6. |
| WR-BCI-9 | **Structured as-batched actuals upload** per ticket: actual weight per material, moisture used, moisture-corrected/SSD target, per-material variance + tolerance flag, added & total batch water, sequence, timestamps, operator/override markers. | P1 | Ground truth for QA, yield, inventory depletion and defensible billing. ULink two-way exists precisely to return actual weights. ↔ WR-STD-11. |
| WR-BCI-10 | **Moisture-corrected weight reconstruction** (`free_water = actual_wet − SSD_dry`; effective w/c) from Hydronix (25 Hz, RS-485/Modbus) or manual moisture, per batch, deterministically recomputable. | P1 | Delivered dry material & true w/c depend on batch-to-batch moisture (rain/fogging → ~30 lb water swing/load). Hydronix; ASTM C94 §6/§11. ↔ WR-FIN-9. |
| WR-BCI-11 | **In-transit / in-mixer quality correlation**: attach COMMANDassurance/Verifi slump/temp/water/admix/revolution events to the ticket and reconcile truck-added water against batch water for a delivered-w/c figure, flagging max-w/c breaches. | P1 | Water/admix added after batching changes the delivered product; ignoring it makes the QA record fiction. COMMANDassurance; Verifi. ↔ WR-STD-9, WR-TEL-3. |
| WR-BCI-12 | **Three-way reconciliation (ordered ↔ batched ↔ delivered/yield)** + actual-based inventory depletion cross-checked against silo radar/load-cell sensors; billing quantity configurable to delivered/verified, not target; tolerance/override/exception ledger. | P0* | The most damaging real-world defect is billing target while delivering less; three-way reconciliation is the control that catches it. NRMCA yield TIP-8/CIP-8. *P0 wherever the controller can return actuals. ↔ WR-FIN-3, WR-FIN-5. |
| WR-BCI-13 | **Offline buffering (edge store-and-forward)** with at-least-once + dedup + sequence/clock reconciliation; batching continues during WAN loss; **typed errors + bounded backoff + dead-letter + heartbeat/health/stale-actuals alerting**; **immutable integration audit** (download payload+version, raw+canonical actuals, overrides, exceptions); **per-tenant credential vault + OT-safe read-only/telemetry-only default** with explicit, audited enablement of write paths. | P1 | Plants run flaky 4G links, noisy serial/BISYNC/Modbus, and safety-critical OT networks; a cloud dependency that halts batching or leaks plant access is unshippable. ↔ WR-PLT-4, WR-PLT-6. |

---

## 4. WR-TEL — Telematics, in-transit tracking & dispatch optimization

*Source domains: Command Alkon TrackIt/CONNEXA/COMMANDassurance; Sysdyne
iStrada/Concrete Mobile/DeliveryGo; Trimble/Coretex drum & water sensors;
Samsara/Motive/Geotab/Verizon/Trackunit; INFORM Syncrotess; India AIS-140/NavIC,
US FMCSA ELD, EU smart tachograph; RMC dispatch-optimization literature.*

| ID | Requirement (testable) | Pri | WHY / source anchor |
|---|---|---|---|
| WR-TEL-1 | **Device-agnostic telematics ingestion gateway**: position (lat/lon/speed/heading/HDOP/ts) at configurable cadence from ≥3 hardware classes incl. an **AIS-140/NavIC** device; breadcrumb visible ≤15 s. | P1 | Mixed fleets + 3rd-party haulers; AIS-140/NavIC is legally required for Indian commercial vehicles. TrackIt/iStrada; MapmyIndia AIS-140. |
| WR-TEL-2 | **Drum telematics ingestion**: rotation count, **direction (charge vs discharge)**, RPM, mapped per truck per ticket; cumulative charge-rotations + reversal detection. | P1 | Drum direction/speed is the primary signal for begin-load/begin-pour without driver input; rotation count is a quality proxy. TrackIt/Coretex. ↔ WR-STD-8. |
| WR-TEL-3 | **Water-added-in-transit ingestion** (meter volume, timestamp, geofence context) separating **mix water from washout**; optional **in-drum probe** (slump/temp/volume/w-c) with graceful degradation when absent. | P1 | Water beyond design w/c ruins strength; producers need an auditable record. Trimble WAM; COMMANDassurance. ↔ WR-BCI-11, WR-STD-9. |
| WR-TEL-4 | **Immutable breadcrumb/event log ("snail trail")** + signal-loss/out-of-order tolerance (buffer/dedup/reorder; never fabricate a status from interpolation) + multi-tenant device registry & health (last-seen/battery/fix/tamper alerts) + SI/US unit-datum normalization (WGS-84 & NavIC). | P1 | Dispute/detention evidence; tunnels/basements/rural dead-zones create phantom arrivals that corrupt KPIs & billing; AIS-140 mandates tamper-evidence. Sysdyne snail-trail. |
| WR-TEL-5 | **Configurable per-ticket status finite-state machine** (Scheduled→Loading→Loaded/ToJob→OnSite→Pouring→Washing→Leaving→Returned→Available), tenant-renamable, illegal transitions rejected. | P1 | Every producer's workflow differs; a rigid enum forces process change on customers. TrackIt/iStrada configurable statusing. |
| WR-TEL-6 | **Automatic status transitions from sensor fusion**: **polygonal** plant/site geofences (+ sub-zones) drive Left-Plant/Arrived/Leaving/Returned; drum-direction+location derive Begin-Load/Begin-Pour; fallback ladder (geofence+dwell, then driver button) with **trigger provenance + confidence** recorded; manual override logged and never silently overwritten. | P1 | Statusing without driver action is *the* differentiating RMC telematics capability ("no driver input… eliminates reporting errors"). ↔ WR-BCI-8. |
| WR-TEL-7 | **Derived per-phase durations** (load, to-site, **on-site wait = arrived→begin-pour**, pour, wash, return, total cycle) per ticket/truck/order/plant. | P1 | Atomic inputs to every KPI and to detention/standby billing. ↔ WR-TEL-13, WR-FIN-6. |
| WR-TEL-8 | **ETA engine** (to-site & back-to-plant) from live position + historical route/traffic + remaining state, broadcast to dispatch board, customer portal, notifications; updates each cadence, reflects detours. | P1 | Concrete is perishable (~90-min window); late/cold loads and idle pump crews are the top complaints. ↔ WR-COM-2. |
| WR-TEL-9 | **Event webhooks/subscriptions** on every transition with at-least-once + idempotency for billing, notifications, analytics. | P1 | Auto-status creates value only when it *triggers* things; event-driven core is what "eliminating radio chatter" means. |
| WR-TEL-10 | **Offline-first driver app**: assigned e-ticket (order/mix/qty/site/directions/batch-QA) staying in sync; status buttons, POD, photos, DVIR, time punches captured locally and auto-synced with conflict resolution. | P1 | Sites/yards lack signal; losing a POD/DVIR is legally & commercially unacceptable. Samsara/Motive offline baseline. |
| WR-TEL-11 | **Electronic POD**: on-site e-signature + geotagged/timestamped photos (pour/placement/damage/return) + notes bound immutably to the ticket, retrievable in portal & on invoice. | P1 | POD is the dispute/billing anchor; documents short-loads, returns, site damage. iStrada; CONNEX ePOD. ↔ WR-STD-7, WR-COM-3. |
| WR-TEL-12 | **DVIR / vehicle inspection + timekeeping + region-pluggable driver-hours** (US FMCSA ELD 11/14-hr, EU tachograph 561/2006 9h/11h, generic elsewhere; India records hours + AIS-140 without US ELD cert) + driver water-add guidance + 3rd-party hauler profiles. | P1 | DVIR & HOS are legally divergent and non-interoperable; a global product can't hard-code one regime. FMCSA; Reg (EC) 561/2006; AIS-140. |
| WR-TEL-13 | **Dispatch scheduling & optimization**: order-as-delivery-schedule (volume + pour-rate m³/hr + first-truck + target interval) auto-split into loads; **load-spacing engine** (configurable 20–40 min, warn on cold-joint gap >45 min); **truck-to-order assignment optimizer** (weighted on-site wait/plant wait/empty-return/on-time, hard constraints: capacity, mix compatibility, driver-hours, site window) with rule-based default + optional solver; **multi-plant balancing**; **return-load minimization + returned-concrete capture**; **live re-optimization dispatch board**; scenario/what-if with manual lock authority. | P1 | RMC dispatch is a perishable-goods, time-windowed scheduling problem; manual dispatch leaves utilization/quality on the table (~USD 1.28/truck-min). INFORM Syncrotess; BCMI; Marcotte; RMC dispatch literature. ↔ WR-FIN-6. |
| WR-TEL-14 | **Operational KPI suite from phase durations** (cycle & sub-phases; on-time % vs interval; trucks/hr, loads/truck/day, m³/truck; plant m³/hr; **plant wait vs on-site wait/detention costed at $/min → billable feed**; water/quality-compliance & returned-concrete KPIs) real-time + historical, exportable, with **data lineage** to the source transitions. | P1 | These are the levers of RMC profitability and must be defensible to source events to drive pay/billing. Sysdyne "15 KPIs"; Transpara. ↔ WR-FIN-19. |

---

## 5. WR-COM — Commerce, customer portal, payments & engagement

*Source domains: Command Alkon CONNEX/Customer Portal; Sysdyne ConcreteGO/
DeliveryGo/Slabstack; Cemex Go; Ozinga MyOzinga; RDC; Infra.Market; UPI AutoPay/
e-NACH; India DLT / TCPA / GDPR consent.*

| ID | Requirement (testable) | Pri | WHY / source anchor |
|---|---|---|---|
| WR-COM-1 | **Customer self-service portal/app**: place/edit/cancel orders, repeat-order-from-history, saved sites/mixes/pricing, will-call activation, quote request/accept. | P1 | Self-service ordering is now a baseline buyer expectation; Phase-1 `wa.me`-only is a competitive gap. CONNEX Customer Portal; ConcreteGO; Cemex Go. |
| WR-COM-2 | **Live order & delivery tracking for the customer**: truck-on-map, traffic-adjusted ETA, delivery spacing, per-truck status timeline, batch/mix details, delivery receipts. | P1 | Cuts "where's my truck?" calls; contractors schedule crews/pumps to ETAs. ↔ WR-TEL-8. |
| WR-COM-3 | **Electronic ticket + ePOD delivery to the customer** (self-print/shareable digital ticket, signed receipt, photos) and multi-stakeholder collaboration record (PM/finisher/inspector/DOT). | P1 | Contractors need immediate proof for their own billing; infrastructure jobs need one shared source of truth. iStrada; CONNEX Ticket Portal. ↔ WR-STD-7, WR-TEL-11. |
| WR-COM-4 | **Online payments & AR self-service**: card/ACH/wallet and India-specific **UPI AutoPay / e-NACH** recurring mandates; view/pay invoices & statements; auto-reconciliation; credit-status visibility. | P1 | Faster collection / lower DSO; buyers expect self-service pay; UPI AutoPay/e-NACH are the Indian recurring rails. ↔ WR-FIN-15, WR-FIN-16. |
| WR-COM-5 | **Omnichannel notification engine** (WhatsApp Business API, SMS, email, push, in-app) with templates, delivery status, retries — replacing one-way stateless `wa.me` links. | P1 | Proactive comms are table-stakes; `wa.me` cannot update, be subscribed to, or produce delivery data. |
| WR-COM-6 | **Consent & preference engine** honouring India **DLT/TRAI** (registered templates/headers), **TCPA** (US), and **GDPR/DPDP** consent + opt-out per channel, with auditable consent records. | P0 | Sending B2B/B2C messages without registered consent is illegal (DLT/TCPA/GDPR) and carries penalties. ↔ WR-PLT-8. |
| WR-COM-7 | **CRM + quoting/contract-rate management** feeding orders pre-populated with approved products, job-specific pricing, contacts and exact location; quote→close analytics. | P1 | Eliminates order-taking guesswork/re-entry; supports account-level pricing discipline. BCMI CRM; Slabstack. ↔ WR-FIN-4. |

---

## 6. WR-FIN — Enterprise finance, costing, procurement, maintenance & analytics

*Source domains: Ramco/AccFlex/o2b RMC ERP; NRMCA yield/cost data; Command Alkon
AR; Sysdyne KPIs/QuickLink; QuickBooks/Xero/Sage/Tally/SAP/Dynamics; NTEP/NIST
HB-44/OIML; multi-entity consolidation practice.*

| ID | Requirement (testable) | Pri | WHY / source anchor |
|---|---|---|---|
| WR-FIN-1 | **Four-pool landed cost per m³/yd³** (materials + direct labor + absorbed overhead + delivery) per mix/order/ticket, recomputed on any input change. | P1 | Materials ~55 %, overhead ~35 %, labor ~10 %; at ~$14.59/yd³ avg profit, unallocated cost silently erases margin. NRMCA/Giatec cost data. |
| WR-FIN-2 | **Mix-design cost roll-up** from per-m³ BOM × current standard price, re-rolled on price/recipe change with version history. | P1 | Mix optimization is where margin is made (one producer: −27 % cement / −13 % cost). ↔ WR-STD-4. |
| WR-FIN-3 | **Standard-vs-actual costing with variance decomposition** (price / usage / mix / yield) from batch-controller actuals. | P1 | Tells management whether a margin miss is procurement's or the plant's; batch weights vary ±1 %. ACCA yield-variance method. ↔ WR-BCI-9. |
| WR-FIN-4 | **Margin by order/customer/plant/mix/driver/job** with drill-down to tickets. | P1 | A single GC can be 20–40 % of revenue; per-slice margin is a survival metric. ↔ WR-COM-7. |
| WR-FIN-5 | **Returned/rejected-concrete costing by cause** (material + disposal + truck standing) charged to a returns bucket per order/customer/plant. | P1 | Returns are 2–5 % (up to ~20 %) of output and a top-two cost problem; reclaimer disposal alone ~$30–35k/yr. NRMCA. ↔ WR-SUS-5. |
| WR-FIN-6 | **Standing/fixed-charge absorption + customer-facing standing charges**: demurrage/waiting (free window then $/min), short-load/minimum-load fees, after-hours, environmental/washout, fuel surcharge; delivery costed per-ticket by distance/cycle-time. | P1 | Demurrage ($60–180/hr) and short-load fees ($40–150+) are pure-margin recoveries routinely lost when un-tracked. ↔ WR-TEL-7, WR-TEL-14. |
| WR-FIN-7 | **Multi-currency, multi-UOM standard cost per plant/region** consolidating into a group currency. | P1 | A worldwide SaaS must present each plant natively yet consolidate. ↔ WR-STD-2, WR-PLT-1. |
| WR-FIN-8 | **Procurement**: contract/blanket & spot POs (cement/SCM/agg/admix/fuel/spares) with approval limits; **goods-receipt 3-/4-way match to weighbridge + supplier ticket + PO** with variance hold; **supplier price contracts, tier pricing, rebate accrual/settlement**; **reorder points/safety stock per silo per plant**; supplier performance & multi-source; landed/import cost apportionment. | P1 | Materials dominate cost; un-accrued rebates and unmatched receipts are direct margin leakage on the largest line. |
| WR-FIN-9 | **Perpetual silo/bin inventory** with level-sensor/load-cell feeds, rated-vs-usable capacity, **moisture-corrected dry-basis consumption**, **theoretical-vs-actual yield/variance with tolerance flags**, physical-count shrinkage reconciliation, multi-plant visibility & transfers. | P1 | Yield drift signals scale/moisture/density error that overstates cost or shorts the customer. NRMCA yield. ↔ WR-BCI-10, WR-BCI-12. |
| WR-FIN-10 | **Batch-controller-fed actual consumption** as the source of truth (manual fallback), flagging over-tolerance loads. | P1 | Over-tolerance loads 20–30 %→4–5 % saved ~$25k/plant/yr in one deployment. ↔ WR-BCI-9. |
| WR-FIN-11 | **CMMS**: asset register (plant + fleet), time/meter-based preventive-maintenance work orders, spares tied to WOs, downtime/MTBF/MTTR, fleet fuel/telematics. | P1 | Mixer/plant uptime is critical; reactive-only maintenance strands capacity. Checkproof/Atlas maintenance guides. |
| WR-FIN-12 | *(merged into WR-FIN-11)* — fleet/vehicle maintenance & fuel by odometer/hours. | P1 | — |
| WR-FIN-13 | **Legal-for-trade scale/load-cell calibration records** (date, technician, test-weight cert to 0.01 %/2 yr, as-found/as-left, next-due ≤6-month & after-move alerts, NTEP/NIST HB-44/OIML refs) with a compliance dashboard. | P1 | Loss of calibration changes delivered m³/yield; weights-and-measures require periodic verification. ↔ WR-STD-12. |
| WR-FIN-14 | **AR sub-ledger + ticket-to-invoice** (consolidated/per-ticket, extras, taxes, retentions) + aged AR/statements. | P1 | Ticket-to-invoice accuracy is where billed extras are captured or lost. |
| WR-FIN-15 | **Credit control**: per-customer limits/terms, auto credit-hold on over-limit/overdue, DSO tracking, customer-concentration flag. | P1 | RMC DSO is 45–75 days and one GC can be 20–40 % of revenue; distress shows first in rising DSO. ↔ WR-COM-4. |
| WR-FIN-16 | **AP 3-way match + payment runs + accruals**; **dimensioned multi-company/multi-currency GL** with revaluation; **multi-entity consolidation with intercompany elimination**. | P1 | A worldwide multi-plant operator is inherently multi-entity/multi-currency; automated eliminations are the core month-end pain multi-entity ERP solves. |
| WR-FIN-17 | **Resilient bidirectional accounting integrations** (QuickBooks, Xero, Sage, Tally, SAP, MS Dynamics) with account/tax/dimension mapping, idempotent retries, reconciliation reports. | P1 | Most producers already run one of these; a global SaaS slots in rather than replacing finance wholesale. ↔ WR-PLT-6. |
| WR-FIN-18 | **HR/payroll**: driver/operator timekeeping by ticket segment; **trip/incentive/piece pay** computed from tickets; payroll run or export (ADP/QuickBooks/Tally) with driver detail; license/certification expiry tracking. | P1 | Labor & delivery cost depend on accurate driver time; trip/incentive pay is standard and drives retention. ↔ WR-TEL-12. |
| WR-FIN-19 | **Analytics/BI**: real-time operational + financial KPI dashboards (cost/m³, margin/m³ by dimension, DSO, utilization ~85–90 %, over-tolerance %, yield, return %); **demand forecasting with seasonality** feeding dispatch/reorder; **cross-plant benchmarking**; exception alerting; drill-through + BI/warehouse API export. | P1 | Top vs bottom quartile differ ~$25.87/yd³; benchmarking/forecasting closes the gap. Transpara; Sysdyne. ↔ WR-TEL-14. |

---

## 7. WR-TAX — Tax & e-invoicing / transport-document compliance

*Source domains: India GST IRP/e-way; EU ViDA + Italy SdI, France PDP/PPF/
Factur-X, Poland KSeF, Germany XRechnung/ZUGFeRD, Spain Verifactu/SII, Romania
e-Factura/e-Transport, Belgium Peppol; LATAM CFDI/NF-e/DTE/DIAN; Saudi ZATCA,
UAE PINT-AE, Turkey e-Fatura; Peppol/EN 16931.*

| ID | Requirement (testable) | Pri | WHY / source anchor |
|---|---|---|---|
| WR-TAX-1 | **Pluggable clearance-provider model** (`ClearanceProvider` interface: generate/clear, cancel, status, fetch-artifacts) with adapters (IRP-India, SdI, KSeF, PAC-Mexico, OSE-Peru, ZATCA, Peppol-AP, DIAN, SEFAZ) and **capability negotiation** (supports-clearance, cancel-window, requires-buyer-acceptance, auto-transport-doc). | P0 | No two authorities share API/payload/ID scheme/auth; hardcoding one blocks 20+. Selling to multi-country groups needs the seam. |
| WR-TAX-2 | **Idempotent, retriable, async clearance with a durable outbox** + sandbox/production isolation per tenant. | P0 | CTC portals are rate-limited and flaky; double clearance creates duplicate legal invoices/tax liability. |
| WR-TAX-3 | **Canonical EN 16931 invoice model + pluggable serializers/validators** (Peppol BIS 3.0/UBL 2.1, XRechnung, Factur-X/ZUGFeRD CII, FatturaPA, India INV-01 JSON, LATAM XML) with pre-submission Schematron/XSD validation and **inbound parsing** (Germany receive-obligation live). | P0 | EN 16931 is a semantic model with two syntaxes profiled by dozens of CIUS; model once at the semantic layer. Formats diverge sharply (FatturaPA proprietary, India JSON, Factur-X hybrid PDF/A-3). |
| WR-TAX-4 | **Hybrid human+machine documents** where mandated (Factur-X/ZUGFeRD PDF/A-3+CII, Saudi PDF/A-3+embedded-UBL+TLV-QR, India e-invoice+QR, Brazil DANFE, Mexico/LATAM representación impresa). | P1 | Several regimes legally require both the data and a specific printable artifact carrying the QR/authorization. |
| WR-TAX-5 | **Config-driven, effective-dated tax engine** (determination from seller/buyer registration, place-of-supply, product tax-class, transaction type, date → component set, rates, exemptions, reverse-charge), no hardcoded tax types; India CGST/SGST/IGST+Cess, EU VAT+reverse-charge, Mexico IVA+retenciones, Brazil IBS+CBS+IS (2026 reform), Saudi/UAE VAT. | P0 | The current single hardcoded GST function can't express other regimes or rate reforms; determination must be versioned data. |
| WR-TAX-6 | **Configurable rounding strategy** (per-line vs per-document, half-up vs half-even, document round-off) meeting EN 16931 BR-CO tolerance and LATAM validators; **multi-currency** with document vs tax/reporting currency, rate + source + date. | P0 | Fixed half-up per-line rounding fails EN 16931 rounding-consistency rules → clearance rejection; no currency column blocks exports/multi-country. |
| WR-TAX-7 | **Product tax-classification catalog** (India HSN/SAC with 6-digit enforcement at AATO>₹5cr; Brazil NCM/CEST; Mexico ClaveProdServ; UNSPSC; RMC = HSN 38245010) validated per country. | P0 | Every clearance portal rejects missing/invalid classification codes; today `hsn_sac` is nullable free text. |
| WR-TAX-8 | **Pluggable signing + QR + cryptographic chaining**: XAdES/CAdES (Italy), XML-DSig (LATAM), ZATCA ECDSA + CSID + PIH hash-chain (Saudi), Verifactu chained records (Spain), provider-side (India/Poland); India signed QR, Saudi TLV QR, Verifactu QR; keys in HSM/KMS. | P0 | Signature type is regime-specific and legally load-bearing; chained integrity can't be retrofitted onto a store-only schema. |
| WR-TAX-9 | **Per-jurisdiction immutable archival (WORM)** + retention (India ~6 yr, EU ~10 yr incl. Italian conservazione / Mexican NOM-151, Brazil/Saudi ~5–6 yr) + audit export (SAF-T, SII, XML batch). | P1 | Storing DB rows is not certified legal archival; retention differs 5–10+ yr and several regimes mandate certified preservation. |
| WR-TAX-10 | **First-class legal-status lifecycle state machine** (draft→generated→submitted→cleared/authorized→delivered→cancelled/credited→rejected) gating dispatch on clearance in CTC regimes; polling/reconciliation; regime-specific correction (India 24h IRN cancel + credit note; Italy nota di credito; Mexico reason-codes+acceptance; Poland KOREKTA; Brazil). | P0 | In CTC regimes legal existence *is* the clearance state; a flat status string can't represent submitted/cleared/rejected/cancelled nor gate dispatch. |
| WR-TAX-11 | **Tenant→country/regime binding with legal-entity profiles** and **mandate-scoping by threshold+date** (India ₹5cr/₹10cr; Poland PLN 200m; Germany €800k; Spain; UAE; Saudi waves) auto-enabling obligations; **counterparty registry/validation** (GSTIN checksum, VIES, Peppol SMP/SML, Codice Destinatario, SAT-RFC). | P0 | Multi-tenancy must extend to multi-jurisdiction-per-tenant; thresholds are the compliance switch; routing/clearance fail on bad counterparty IDs. |
| WR-TAX-12 | **India e-invoice (IRN via IRP, INV-01 JSON)** for B2B/export/SEZ at AATO>₹5cr (B2C out of scope; PAN-wide once crossed); store IRN/ack/ack-date/signed-QR and print QR; 30-day reporting bar at ≥₹10cr; 24h full-only cancel then credit note. | P0 | Indian legal e-invoicing; today fields are stored READY-ONLY with no IRP call. GST IRP/NIC. |
| WR-TAX-13 | **India e-way bill** (Part A + Part B) for consignment >₹50k; validity 1 day/200 km (1 day/20 km ODC) from distance; 24h cancel unless transit-verified; MFA, 180-day document bar, Ship-To GSTIN; single-step IRN+e-way where in scope. | P0 | RMC dispatches routinely exceed ₹50k; a concrete truck cannot legally roll without the e-way bill. ↔ WR-TAX-14. |
| WR-TAX-14 | **Transport-document abstraction linked to dispatch** for other regimes (Mexico Carta Porte 3.1, Brazil CT-e/MDF-e, Chile guía de despacho, Peru guía de remisión, Turkey e-İrsaliye, Romania e-Transport), each returning its authority ID + validity. | P1 | Transport clearance is a *separate* mandate from invoice clearance, threshold-gated, and blocks physical movement — on RMC's critical path. ↔ WR-STD-6. |

---

## 8. WR-SUS — Sustainability, carbon & circularity

*Source domains: EN 15804+A2 / ISO 14025 / openEPD / EC3; Buy Clean / CALGreen /
CBAM / CPR-DPP; ASTM C1074 maturity, SmartRock/Maturix/Converge, COMMANDassurance/
Verifi; ASTM C1798 returned concrete, ASTM C94 recycled water; GHG Protocol
Scope 1/2/3, CSRD/ESRS E1, India CCTS.*

| ID | Requirement (testable) | Pri | WHY / source anchor |
|---|---|---|---|
| WR-SUS-1 | **Per-mix/per-load LCA + GWP engine** (EN 15804+A2 modules A1–A3) generating verified **digital EPDs** (ISO 14025 / PCR) with openEPD/EC3 export and portfolio benchmarking; real-time re-authoring on material/spec change. | P1 | Low-carbon procurement, codes and owners increasingly mandate EPDs; Climate Earth/Holcim ECOPact scale digital EPDs. |
| WR-SUS-2 | **Buy Clean / low-carbon procurement rules engine** matching mixes to GWP limits and jurisdictional rules (US Buy Clean/CALGreen, EU CBAM, EU CPR Digital Product Passport) with pass/fail against a project carbon cap. | P1 | Public procurement and border-carbon rules now gate bids on embodied carbon; winning low-carbon bids while minimizing cement. |
| WR-SUS-3 | **Low-carbon mix optimization** (SCM substitution, cement reduction) tied to strength/maturity performance and cost. | P2 | Reduces embodied carbon and cement cost simultaneously. Giatec Roxi; Climate Earth. ↔ WR-FIN-2. |
| WR-SUS-4 | **Maturity & in-place strength telemetry** (ASTM C1074; SmartRock/Maturix/Converge embedded sensors; in-drum COMMANDassurance/Verifi) feeding QC and carbon-optimized early-strippping decisions. | P2 | Enables cement reduction with confidence and faster construction cycles. ↔ WR-STD-18, WR-BCI-11. |
| WR-SUS-5 | **Returned-concrete & recycled-water tracking** (ASTM C1798 returned concrete; ASTM C94 recycled/wash water accounting) with disposition, reuse and waste/CO₂ metrics. | P1 | Returns are 2–5 % (to ~20 %) of output — a cost *and* a sustainability metric; recycled water affects w/c. ↔ WR-FIN-5, WR-STD-9. |
| WR-SUS-6 | **ESG / GHG reporting**: Scope 1/2/3 inventory, CSRD/ESRS E1 disclosures, India CCTS (carbon-credit trading) readiness, per-plant carbon intensity trends. | P2 | Enterprise & EU-listed producers face mandatory climate disclosure; a differentiator turning to table-stakes. |

---

## 9. WR-PLT — Platform & cross-cutting non-functional requirements

*These make the above sellable worldwide and safe at scale; they subsume and
globalise the India-Phase-1 NFRs in `REQUIREMENT_TRACEABILITY_MATRIX.md §13`.*

| ID | Requirement (testable) | Pri | WHY / source anchor |
|---|---|---|---|
| WR-PLT-1 | **Multi-region localization**: units (SI/US-customary), currency, language/i18n, date/number formats, timezone/holiday, per-plant standard & tax profile. | P0 | An m³/INR/English-only build cannot serve US/EU/GCC/LATAM. ↔ WR-STD-1/2, WR-FIN-7, WR-TAX-11. |
| WR-PLT-2 | **Multi-tenant + multi-entity + multi-plant** isolation extended to **multi-jurisdiction per tenant** (a group with entities in several countries under one login, each with its own credentials/regime). | P0 | The stated ambition is multi-country groups; isolation must be per-jurisdiction, not one global regime. |
| WR-PLT-3 | **Integration provider registry + async job queue + webhooks** as the shared backbone for *every* external integration (batch controllers, telematics, clearance, payments, messaging, accounting). | P1 | Every live integration is greenfield until this exists; it is the common substrate for WR-BCI/TEL/TAX/COM/FIN. |
| WR-PLT-4 | **Offline-first resilience** across plant-edge (batching), driver app (POD/DVIR) and dispatch, with store-and-forward, idempotency, conflict resolution and device credential/revocation. | P1 | Plants and jobsites lose connectivity; data loss is unacceptable. ↔ WR-BCI-13, WR-TEL-10. |
| WR-PLT-5 | **Security hygiene at scale**: no default/weak secrets, secrets vault + rotation, at-rest encryption, cookie/rotated-token auth, MFA, per-tenant credential isolation, RLS on all tenant tables. | P0 | Baseline for handling multiple paying tenants' plant-OT and financial data. (Extends existing G1–G3, G9.) |
| WR-PLT-6 | **Resilient integration semantics everywhere**: typed transient/permanent errors, bounded backoff + jitter, dead-letter, idempotency keys, reconciliation — reused by controller, clearance, payment and accounting adapters. | P1 | Noisy OT links, flaky tax portals and payment rails all need the same reliability guarantees. ↔ WR-BCI-13, WR-TAX-2, WR-FIN-17. |
| WR-PLT-7 | **Observability**: structured logs (built), 5xx alerting (built), Prometheus metrics (built) → extend with tracing, per-tenant/per-plant SLOs, integration-health dashboards, external uptime. | P1 | MTTD and per-tenant/noisy-neighbour visibility at scale. (Extends the observability trio already shipped.) |
| WR-PLT-8 | **Global data-protection & consent**: GDPR/DPDP notice+consent, DLT/TCPA messaging consent, breach runbook, DPA, retention enforcement across regions. | P0 | Legal to operate and message per region; penalties are severe. ↔ WR-COM-6. |
| WR-PLT-9 | **HA / DR at scale**: managed/HA Postgres, PITR, quantified RPO/RTO, staging + CD, off-box backups, no single-box SPOF. | P1 | Multi-tenant uptime/SLA commitments; extends existing G4/G5/G13/G14. |

---

## 10. Consolidated readiness summary

Mapping this corpus onto the current build (detail in `WORLDWIDE_GAP_DELTA.md`):

- The current product is a **correct, owner-verified Indian Phase-1 order-to-cash
  core** with a strong multi-tenant isolation/data foundation and a freshly
  added observability trio.
- Against the **worldwide** corpus above it implements a **small fraction** —
  roughly the WR-FIN order-to-cash/AR slice (partially), WR-STD basic
  slump/grade capture (thin), and *stored-but-inert* WR-TAX India fields. The
  entire **integration spine** (WR-BCI, WR-TEL telematics, WR-TAX clearance,
  WR-COM portal/payments, WR-SUS carbon) is **DOC-ONLY or MISSING**.
- **Honest global-readiness read:** the requirements are now ~world-complete on
  paper; the *build* against the worldwide bar is on the order of **~10–15 %**,
  versus ~70–75 % against the *Indian Phase-1* bar it was actually scoped to.
  These are two different yardsticks and both are stated deliberately so neither
  over- nor under-sells the product.

## 11. Sources (by domain)

Full URL lists live in each research stream; the anchoring bodies are:

- **WR-STD** — EN 206 / BS 8500, ASTM C94 + ACI 318/301/305.1/306, AS 1379, CSA
  A23.1/A23.2, IS 4926/456/1199/516/10262/4925, ASTM C1074/C42, FHWA EDC-6 /
  AASHTO / NRMCA (plant/truck cert, yield TIP-8/CIP-8/CIP-26).
- **WR-BCI** — Command Alkon COMMANDbatch/Marcotte/ULink-BISYNC/CONNEX, Sysdyne
  Open API/CloudBatch, Scale-Tron BatchTron, MPAQ TouchBatch/ULink,
  ELKON/Schwing/Liebherr/Ammann/Simem/Fibo/MEKA, Hydronix, COMMANDassurance,
  GCP/Verifi; protocols OPC-UA/Modbus/MQTT/REST/serial/file.
- **WR-TEL** — Command Alkon TrackIt/CONNEXA, Sysdyne iStrada/DeliveryGo,
  Trimble/Coretex, Samsara/Motive/Geotab, INFORM Syncrotess; AIS-140/NavIC,
  FMCSA ELD, EU Reg (EC) 561/2006; NRMCA/Transpara KPI sets, RMC
  dispatch-optimization literature.
- **WR-COM** — Command Alkon CONNEX/Customer Portal, Sysdyne
  ConcreteGO/DeliveryGo/Slabstack, Cemex Go, Ozinga, RDC, Infra.Market; UPI
  AutoPay/e-NACH; TRAI DLT, TCPA, GDPR/DPDP.
- **WR-FIN** — Ramco/AccFlex/o2b RMC ERP, NRMCA cost/yield data, Giatec,
  QuickBooks/Xero/Sage/Tally/SAP/Dynamics; NTEP/NIST HB-44/OIML; multi-entity
  consolidation practice.
- **WR-TAX** — India GST IRP/NIC + e-way; EU ViDA, Italy SdI, France PDP/PPF,
  Poland KSeF, Germany XRechnung/ZUGFeRD, Spain Verifactu/SII, Romania
  e-Factura/e-Transport, Belgium Peppol; Mexico CFDI/Carta Porte, Brazil
  NF-e/CT-e, Chile/Colombia/Peru; Saudi ZATCA, UAE PINT-AE, Turkey e-Fatura;
  Peppol/EN 16931.
- **WR-SUS** — EN 15804+A2, ISO 14025, openEPD/EC3, Climate Earth, Buy
  Clean/CALGreen/CBAM/CPR-DPP, ASTM C1074/C1798/C94, Giatec, GHG Protocol,
  CSRD/ESRS E1, India CCTS.

> **Reminder:** every numeric threshold and clause reference is research-derived
> and must be confirmed against the current purchased edition / official portal
> before being encoded as a hard validation rule.
