# GST Integration Runbook 02 — e-way bill

> Turning an **approved** `eway_bill` action into a real e-way bill from the EWB
> system, and persisting the government response.
>
> Read `INTEGRATION-RUNBOOK-00-gst-common.md` first — provider abstraction, auth/
> encryption, the approval→execution step, secrets, idempotency, and rollback are
> shared. Related: `INTEGRATION-RUNBOOK-01-irp-einvoice.md`. Gap: GW-4.
> Requirement: WR-TAX-13 (IND-07).
>
> **Status: held for deployment.** Nothing here transmits from the sandbox.

## 1. When an e-way bill is required (scope)

- Required for movement of goods where the **consignment value exceeds ₹50,000**
  (some states set a different **intra-state** threshold — a few use ₹1,00,000; a
  handful exempt intra-city moves under ~50 km from Part-B). Make the threshold
  and the intra-state distance exemption **config per state**, defaulting to
  ₹50,000.
- RMC concrete moves by **transit mixer** on a delivery challan/invoice → **in
  scope** for most dispatches over threshold. The Specialist already flags
  `eway_pending` for issued invoices `> ₹50,000` still `not_generated`.
- Unlike the IRN, e-way applies to **B2C over threshold and to delivery challans**
  (job-work, branch/stock transfer) too — so an e-way may be needed where **no IRN
  exists**. Both paths are covered in §4.

## 2. Pre-flight validation (fail fast, before any call)

Reject to `failed` without calling the portal if:

- consignment value ≤ the applicable threshold (nothing to file);
- from/to GSTIN malformed, or to-state code missing;
- transport details incomplete for the chosen mode — road ⇒ **vehicle number**
  (validate the RTA format, e.g. `TN01AB1234`) **or** a transporter id; rail/air/
  ship ⇒ transport document no + date;
- `distance_km` missing or ≤ 0 (needed for validity — see §5);
- HSN missing on lines (same master-data gate as the IRN);
- `eway_status` already `generated` (idempotency).

## 3. Part A + Part B

| Part | Fields | Source |
|---|---|---|
| **Part A** | `supplyType` (O/I), `subSupplyType` (supply/job-work/…), `docType` (INV/CHL/…), `docNo`, `docDate`, from/to GSTIN + state + pincode, `itemList` (HSN, qty, unit, taxable, GST rate), `totInvValue`, `transDistance` | invoice / challan + `distance_km` |
| **Part B** | `transMode` (1=road,2=rail,3=air,4=ship), `vehicleType` (R/O), `vehicleNo`, or `transporterId` + `transDocNo`/`transDocDate` | invoice transport fields (`transport_mode`, `vehicle_no`, `transporter_name`) |

For own-fleet RMC dispatch: `transMode=1` (road), `vehicleType=R`, `vehicleNo`
from the invoice. Part B **must** be present before the vehicle moves; an e-way
with only Part A is not valid for transit.

## 4. Two generation paths — prefer generating from the IRN

**Path A — from the IRN (single call, preferred when an IRN exists).** Include
`EwbDtls` (Part-B: transport mode, distance, vehicle no) in the **e-invoice**
generate call (runbook 01 §3). The IRP returns the **e-way bill number alongside
the IRN** — one call, no separate EWB auth. Use this whenever the invoice is B2B
and an IRN is being generated anyway.

**Path B — standalone EWB API (no IRN).** For B2C-over-threshold, or delivery
challans (job-work, branch transfer), call the EWB system directly:

| Action | Method + path (NIC direct) | Notes |
|---|---|---|
| Generate | `POST {EWB}/ewayapi/` (`action=GENEWAYBILL`) | Part A + Part B |
| Update Part B (vehicle) | `POST {EWB}/ewayapi/` (`action=VEHEWB`) | breakdown / transshipment |
| Extend validity | `POST {EWB}/ewayapi/` (`action=EXTENDVALIDITY`) | within 8h before/after expiry, with reason |
| Cancel | `POST {EWB}/ewayapi/` (`action=CANEWB`) | within **24h**, before verification by an officer |

Confirm the exact `action`/path scheme with your GSP; the adapter maps the
runbook-00 interface onto it.

## 5. Validity — already computed

Validity is **1 day per 200 km** (regular cargo), minimum 1 day — exactly
`ewayValidityDays(distance_km)` in `compliance.util.ts` (unit-tested:
`ceil(350/200) = 2`). On success, persist `eway_valid_until = eway_bill_date +
validityDays`. Over-dimensional cargo uses a different rule (1 day per 20 km) — not
applicable to concrete, but keep the rule pluggable.

## 6. Response → persistence

| Response field | Invoice column |
|---|---|
| `ewayBillNo` (12-digit) | `eway_bill_no` |
| `ewayBillDate` | `eway_bill_date` |
| `validUpto` | `eway_valid_until` |
| (from request) | `distance_km`, `transport_mode`, `transporter_name`, `vehicle_no` (persist what was sent) |
| (derived) status | `eway_status = 'generated'` |

Print the e-way bill number on the dispatch document / challan (wire into the
existing PDF renderer).

## 7. Update, extend, cancel

- **Vehicle change (breakdown/transshipment):** update Part B (`VEHEWB`) with the
  new vehicle before the goods continue. Wire as an approval
  (`actionKind = eway_update_vehicle`).
- **Extend validity:** allowed within **8 hours before/after** expiry with a
  reason; only if goods are genuinely in transit. Approval `eway_extend`.
- **Cancel:** within **24h** and only if not yet verified by an officer; reason
  required. Approval `eway_cancel` → `eway_status = 'cancelled'`. After 24h it
  cannot be cancelled — it simply lapses at `validUpto`.

## 8. Common error codes (handle explicitly)

| Symptom | Handling |
|---|---|
| Duplicate e-way for the same doc | Reconcile the existing `ewayBillNo` onto the invoice; close job (treat as success) |
| Invalid/expired auth token | Re-authenticate (§00.3), retry once |
| Invalid vehicle no / GSTIN / HSN / pincode | `failed` with the field message; fix master data, re-approve |
| Distance not serviceable / pincode mismatch | `failed`; verify from/to pincodes |
| Rate limit / 5xx | Backoff, bounded retries, leave `queued` |

## 9. Sandbox test plan

1. Seed an invoice `> ₹50,000` with a valid vehicle no, `distance_km`, HSN, and
   from/to GSTINs.
2. Prepare (`POST /agents/automation/run { compliance: 'eway', invoiceId }`) →
   pending approval `actionKind = eway_bill`.
3. Approve → job executes (Path B in sandbox; Path A if an IRN was generated).
4. Assert: `eway_bill_no`, `eway_bill_date`, `eway_valid_until` populated;
   `eway_status = 'generated'`; validity = `ceil(distance/200)` days; audit shows
   `gst.eway.generated` with the EWB no + approver.
5. Update Part B (new vehicle) → succeeds; cancel within 24h → `cancelled`.
6. Negative: value ≤ threshold, missing vehicle for road mode, bad vehicle format,
   `distance_km ≤ 0` → each rejected in pre-flight **without** a portal call.

## 10. Definition of done

- Part A/B mapping unit-tested; pre-flight rejects the bad cases above.
- Path A (from IRN) used when an IRN exists; Path B for challan/B2C.
- State-configurable threshold + intra-state distance exemption in place.
- Sandbox plan (§9) green incl. update + cancel; validity persisted correctly.
- EWB no printed on the dispatch document; visible in UI + audit.
- Rollback (`GST_PROVIDER=disabled`) reverts to prepare-only.
- Owner sign-off on one production pilot dispatch.
