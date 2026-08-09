# Research Sources & Benchmarks — Mix Nova RMC

> The external evidence base for this audit: the Indian RMC domain/competitor/
> compliance research and the architecture-pattern benchmarks, with a comparison
> of Mix Nova against the market and against modern best practice. Every
> non-obvious claim carries a source. **Method caveat:** direct page retrieval
> (WebFetch) was egress-blocked for most vendor/regulatory domains, so claims are
> synthesised from WebSearch result summaries of those URLs; vendor-marketing and
> forecast figures are labelled as such and should be re-verified before they
> drive commercial or compliance decisions.

## 1. Domain facts that shape the product

- **RMC workflow:** enquiry → quotation (IS 4926 specimen enquiry; designed vs
  prescribed mix) → order → mix design (with **moisture correction**) → **batching
  on a PLC/computer controller** → dispatch (transit mixer + delivery challan) →
  weighbridge → invoice → payment [D5,D7,D19,D24].
- **The 90-minute clock:** concrete must be discharged within **90 minutes of
  adding water or 300 drum revolutions**, whichever first; a site delay beyond
  ~30 min shifts liability to the contractor. Site water addition must be recorded
  on the challan with a producer representative present (IS 4926) [D19]. → This is
  why offline, local-first capture is not optional, and why load accept/reject and
  site-water are human-attested, never automated.
- **Offline reality:** plants sit at quarries/highways/greenfield sites with
  unreliable connectivity; offline-capable capture "prevents adoption failures and
  data-entry backlogs" [D22].

## 2. India compliance (design to these, verify before go-live)

| Rule | Current position | Confidence | Source |
|---|---|---|---|
| GST **e-invoicing / IRN** mandatory | AATO **> ₹5 crore**, since **1 Aug 2023** (CBIC Notif. 10/2023-CT) | **High / authoritative** | [D17] |
| 30-day IRP reporting | AATO ≥ ₹10 cr must report within **30 days** of doc date, from **1 Apr 2025** | High | [D15] |
| "₹2 crore from Oct 2025" | **UNCONFIRMED rumor — no CBIC notification.** Do **not** design to it | Flagged unverified | [D15] |
| **E-way bill** | > **₹50,000 inter-state**; intra-state varies by state; Part A/B; validity ~1 day/100 km; no EWB for docs >180 days (Jan 2025); **mandatory 2FA** | High | [D18] |
| **GST returns** | GSTR-1 + GSTR-3B monthly (>₹5 cr / non-QRMP), quarterly under QRMP (≤₹5 cr), GSTR-9 annual; 3B Table 3.2 non-editable from Apr 2025 | High | [D12] |
| **RMC tax** | **18% GST, HSN 3824 5010** (incl. transit-mixer delivery) | High | [D12] |
| **IS 4926:2003 (R2017)** | Code of Practice for RMC — ordering, batching tolerances, 90-min/300-rev, challan content, sampling; BIS process certification | High | [D5,D6,D7,D19] |
| **QCI RMCPCS** | Voluntary 3rd-party plant certification (RMC Capability / RMC 9000+); NABCB-accredited; production-control criteria | High | [D20] |
| **DPDP Act 2023 + Rules 2025** | Notified 13–14 Nov 2025; obligations ~May 2027; Rule 6 safeguards (encryption/masking/RBAC/logging/IR); Rule 7 breach: principals "without delay", Board detailed within **72 h of awareness**; penalties up to ₹250 cr / ₹200 cr | High (verify Rule 7 wording) | [A31,A32,A36,A37] |

## 3. Competitor benchmark

| Product | Layer | Deployment | Notable | Source |
|---|---|---|---|---|
| **Command Alkon COMMANDbatch / Batch** | Plant automation | On-prem → cloud multi-plant (Apr 2026) | Most-deployed globally; precision water, sensors | [D4,D14] |
| **Sysdyne (ConcreteGo/BatchGo/iStrada)** | Cloud platform | Cloud-native | Paperless e-ticketing, GPS/ETAs/truck-spacing, two-way accounting | [D13] |
| **Ramco ERP for RMC** | RMC ERP | Cloud | Two-way batch-controller, dump-and-divert, IoT drum slump/temp, "predictive ERP" | [D21] |
| **NYGGS RMC/Batching** | RMC ERP | Cloud + mobile | Markets **offline mode** for poor connectivity | [D8,D22] |
| Bhavantu / Syvasoft / Nspiretech / Winklix / Concord / Inniti | India RMC ERP | Web/cloud | Commercially strong (GST/dispatch/GPS/multi-plant); batch-integration + offline depth **varies, vendor-asserted** | [D1,D2,D3,D22] |

**Reading:** the plant-automation tier owns the PLC/quality layer and is moving to
cloud; the crowded Indian ERP tier is commercially strong but **two-way
batch-controller integration and offline resilience vary**. Today's "autonomy" is
mostly automation (recipe download, GPS, alerts), not closed-loop.

**Table-stakes for a real Indian RMC platform (vs a billing tool):** (1) two-way
batch-controller integration, (2) RS232/RS485/Modbus/TCP weighbridge capture,
(3) GPS transit-mixer tracking, (4) local/offline operation with sync [D16,D21,D23].

## 4. Mix Nova vs market vs best practice

| Capability | Mix Nova today | Typical India competitor | Modern best practice |
|---|---|---|---|
| Order-to-cash core | **Strong, tested, verified** | Present | Present + margin-aware quoting |
| GST invoice (mixed HSN/SAC) | **Built, correct math** | Present | + built-in IRN/e-way with sign-off |
| e-invoice / e-way | **Stored fields only (manual/outside)** | Add-on/GSP | Built-in, deferred/offline-queued |
| Batch-controller integration | **None (manual entry)** | One-way common; two-way top tier | **Native two-way, multi-brand** |
| Weighbridge | Manual only | RS232/Modbus common | Serial+Modbus+TCP, RFID/unmanned |
| GPS/telematics | Columns only | GPS common | + drum/PTO sensors, predictive maint |
| Offline | **Real MVP, 3/10 ops, fragile cursor** | Varies; some offline mode | Local-first + change-feed + idempotency |
| Multi-tenancy | **Pooled RLS, safe recipe** | Usually single-tenant/on-prem | Hybrid pool→silo, deployment stamps |
| Auth/session | localStorage tokens | Varies | Cookie + rotation + MFA |
| Observability | Minimal | Varies | OTel metrics/logs/traces per-tenant |
| Autonomy | L0–L2, safe | Automation only | Supervised L1–L3 with guardrails |

**Where Mix Nova already leads the typical Indian competitor:** DB-enforced
multi-tenant isolation done to the safe standard, real RBAC with SoD, append-only
audit, and a tested offline MVP — most local ERPs are single-tenant/on-prem and
weaker on isolation and audit. **Where it trails:** the two hardest, most
defensible differentiators — **two-way batch-controller integration and robust
offline** — plus live compliance integrations.

## 5. Architecture best-practice benchmarks (applied to Mix Nova)

| Area | Best practice | Mix Nova standing |
|---|---|---|
| **Multi-tenancy** | Pooled RLS → hybrid silo for big tenants; deployment stamps [A1,A2,A4] | Pooled RLS ✅; hybrid = proposed (ADR-07) |
| **RLS hardening** | FORCE RLS + non-owner role + `SET LOCAL` + `USING`/`WITH CHECK` + tenant_id-leading indexes + fail-closed [A7,A8,A9] | **Matches the safe recipe exactly** ✅ |
| **Offline sync** | Local store → outbox + **idempotency keys (UUIDv7)** + change-feed cursor; event-sourced for money/inventory; **never LWW** [A12,A15,A16,A17] | Outbox ✅ but wall-clock cursor ❌, no idempotency key ❌ → fix (ADR-08) |
| **Sync tooling** | PowerSync (writes via your API) if Postgres + broad offline [A16,A20] | Custom outbox; build-vs-buy open (ADR-09) |
| **Agentic autonomy** | L0–L3 in production; HITL for irreversible; guardrails as a layer; financial/legal = mandatory HITL [A23,A24,A25,A26] | L0–L2 today; guardrail engine proposed (ADR-12) |
| **Auth** | Access in memory + refresh in httpOnly cookie + rotation + reuse detection; CSRF; RFC 8725 [A38,A39,A40] | localStorage tokens ❌ → fix (ADR-10) |
| **AppSec** | OWASP ASVS 5.0 **Level 2**; secrets manager; secret scanning in CI [A41,A44] | Partial; secrets vault proposed (ADR-14) |
| **Reliability** | Honest SLO + error budget; RPO/RTO; **rehearsed restore**; per-tenant restore [A46,A49] | Restore drill ✅; RPO/RTO + PITR + off-box = gaps |
| **Delivery** | Test/Staging/Prod; blue-green/canary; **k6 smoke in CI**; OTel tagged by tenant [A50,A52,A46] | CI ✅; staging/CD/observability = gaps |
| **HA** | Single box at pilot → multi-AZ managed HA when SLAs arrive [A1,A49,A50] | Single box; HA = Wave 5 |

The standout: **the RLS implementation matches the benchmark's "safe recipe"
point-for-point** — an independent validation that the hardest security decision
was made correctly.

## 6. Sources

### Domain / competitor / compliance (D-series)
- [D1][D2] Bhavantu RMC ERP — bhavantusoftware.com (vendor, undated)
- [D3] India RMC ERP set — winklix.com, nspiretech.com, syvasoft.com, rmcerp.com (vendor, undated)
- [D4][D14] Command Alkon Batch cloud multi-plant — rockproducts.com (24 Apr 2026), commandalkon.com
- [D5] IS 4925:2004 batching plant / specimen enquiry — law.resource.org
- [D6] BIS RMC process certification (IS 4926) — bis.gov.in
- [D7][D19] IS 4926:2003 RMC code; 90-min/300-rev; challan/site-water — law.resource.org, constrofacilitator.com, aparnarmc.com
- [D8][D22] NYGGS RMC + offline mode; industrial offline — nyggs.com, oxmaint.ai, concorderp.com
- [D12] GST returns + RMC 18%/HSN 3824 5010 — indiafilings.com, busy.in, eximpe.com
- [D13] Sysdyne cloud concrete platform — sysdynetechnologies.com
- [D15] e-invoicing limits 2025-26 incl. 30-day rule (contains unverified ₹2 cr claim) — gimbooks.com, busy.in
- [D16] Weighbridge protocols RS232/RS485/Modbus/TCP — imagicsolution.com, robatosystems.com, endel.digital
- [D17] **CBIC e-invoicing ₹5 cr w.e.f. 1 Aug 2023 (Notif. 10/2023-CT)** — ey.com, livelaw.in (authoritative)
- [D18] E-way bill rules 2025-26 (₹50k, validity/km, 2FA, 180-day) — busy.in, cleartax.in
- [D20] QCI RMCPCS scheme — qcin.org
- [D21] Ramco ERP for RMC — ramco.com
- [D23] RMC ERP ↔ batch controller two-way — innitisoftware.com
- [D24] PLC batching + moisture correction — civil4m.com, aimix
- [D25] Concrete-mixer telematics / predictive maintenance — rocktoroad.com, truckx.com
- [D26] Schwing Stetter MCI + SCADA — schwingstetterindia.com, equipmenttimes.in
- [D27] Sicoma twin-shaft mixers — daswellmachinery.ph
- [D28] Ajax Fiori ARGO IoT telematics — nbmcw.com
- [D30] AI mix optimisation & dispatch (peer-reviewed + industry) — sciencedirect.com S2352012425022581, rocktoroad.com

### Architecture patterns (A-series)
- [A1] Azure Architecture Center — Tenancy models — learn.microsoft.com
- [A2] Multi-tenant DB design patterns — daily.dev
- [A4] SaaS with PostgreSQL multi-tenancy — adiagr.com
- [A7] Crunchy Data — RLS for tenants in Postgres — crunchydata.com
- [A8] techbuddies.io — Postgres RLS for multi-tenant SaaS (Jan 2026)
- [A9] OneUptime — RLS in PostgreSQL (Jan 2026)
- [A12] EDUCBA — Offline-first: outbox, idempotency, conflict — educba.com
- [A15] Microsoft Learn — PWA Background Sync — learn.microsoft.com
- [A16][A20] PowerSync vs ElectricSQL (vendor) — powersync.com; QueryPlane comparison
- [A17] CRDT / OT / event-sourcing — askantech.com; DZone LWW vs CRDT
- [A23] Feng, McDonald & Zhang — Levels of Autonomy for AI Agents — Knight First Amendment / arXiv 2506.12469
- [A24] Anthropic — Measuring AI agent autonomy (2026)
- [A25] Idea Forge — Human-in-the-Loop autonomy playbook (L0–L4, Jul 2026)
- [A26] Elementum — HITL agentic AI (2025)
- [A31] MeitY — DPDP Act 2023 official text — meity.gov.in
- [A32] DPDP Rules 2025 — en.wikipedia.org
- [A36] Matters.ai — DPDP breach notification 72-hour rule
- [A37] MediaNama — DPDP breach reporting timeline (Nov 2025)
- [A38] Wisp CMS — localStorage vs httpOnly cookies for JWT (2025-26)
- [A39] Crosscheck — Cookies vs JWT (2026)
- [A40] Cyber Chief — secure JWT token storage
- [A41] OWASP ASVS 5.0 — owasp.org / github.com/OWASP/ASVS
- [A44] Cycode — secrets management best practices
- [A46] Google SRE — Error budget policy / Monitoring — sre.google
- [A49] SRE School — RTO/RPO, failover, restore rehearsal (2026)
- [A50] Keploy — software deployment strategies (2026)
- [A52] Harness / FrugalTesting — k6 load testing in CI/CD

### Confidence flags
- **High/authoritative:** e-invoicing ₹5 cr threshold [D17]; e-way mechanics [D18];
  RMC 18%/HSN [D12]; IS 4926 timings [D19]; DPDP text [A31]; RLS recipe [A7–A9].
- **Vendor-marketing (directional, not audited):** competitor feature depth and
  ROI/savings percentages [D21,D25,D30]; PowerSync-vs-Electric framing [A16,A20].
- **Explicitly unverified:** "₹2 cr e-invoicing from Oct 2025" [D15]; India RMC
  market-size figures (wide inter-source variance); Gartner agent adoption/
  cancellation figures (cited second-hand). **"Mix Nova RMC" has no public web
  footprint** — a pre-launch/private product, as expected.
