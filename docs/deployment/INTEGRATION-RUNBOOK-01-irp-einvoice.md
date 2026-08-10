# GST Integration Runbook 01 — IRP / e-invoice (IRN)

> Turning an **approved** `einvoice_irn` action into a real IRN from the Invoice
> Registration Portal, and persisting the government response.
>
> Read `INTEGRATION-RUNBOOK-00-gst-common.md` first — provider abstraction, auth/
> encryption, the approval→execution step, secrets, idempotency, and rollback are
> shared and not repeated here. Gaps: GW-2/3. Requirement: WR-TAX-12 (IND-02).
>
> **Status: held for deployment.** Nothing here transmits from the sandbox.

## 1. When an IRN is required (scope)

- e-invoicing applies to a GSTIN whose **AATO exceeds the current threshold**
  (₹5 cr at time of writing) for **B2B, exports, and credit/debit notes**. RMC
  plants sell B2B to builders/contractors → **in scope** once over threshold.
- **B2C invoices do not get an IRN** (but may still need an e-way bill — see
  runbook 02). A dynamic-QR obligation on B2C is separate and not covered here.
- The IRN must be generated **before the invoice is legally issued / the goods are
  dispatched** — the Specialist agent already flags `einvoice_pending` for issued
  invoices still `not_generated` (WR-TAX-12 citation lives in `specialist.agent.ts`).

## 2. Pre-flight validation (fail fast, before any call)

Reject to `failed` with a clear reason **without** calling the portal if:

- seller GSTIN or buyer GSTIN is malformed (15-char GSTIN regex);
- any line is missing a valid **6-digit HSN/SAC** (already alerted by Specialist);
- `place_of_supply` (state code) is missing, or is inconsistent with CGST/SGST vs
  IGST (intra-state ⇒ CGST+SGST; inter-state ⇒ IGST);
- totals do not reconcile: `Σ line taxable + Σ tax + round_off = total_amount`
  within a ₹1 tolerance;
- document date is in the future, or the invoice is `draft`/`cancelled`;
- `einvoice_status` is already `generated` (idempotency — nothing to do).

These mirror the checks a reviewer would make; catching them locally avoids
burning API calls on rejects and keeps the failure message actionable.

## 3. Payload — INV-01 (schema v1.1)

`buildEinvoicePayload` today emits a **review subset**. The live call needs the
full INV-01. Map as follows (extend the compliance module; unit-test the mapping):

| INV-01 group | Field(s) | Source |
|---|---|---|
| `Version` | `"1.1"` | constant |
| `TranDtls` | `TaxSch=GST`, `SupTyp` (B2B/EXPWP/…), `RegRev` (reverse charge Y/N), `IgstOnIntra` | invoice flags |
| `DocDtls` | `Typ` (INV/CRN/DBN), `No` = `invoice_no`, `Dt` (dd/mm/yyyy) | invoice |
| `SellerDtls` | `Gstin`, `LglNm`, `Addr1`, `Loc`, `Pin`, `Stcd` | company profile |
| `BuyerDtls` | `Gstin`, `LglNm`, `Pos` (place of supply state code), `Addr1`, `Loc`, `Pin`, `Stcd` | customer + invoice |
| `ItemList[]` | per line: `SlNo`, `HsnCd`, `Qty`, `Unit`, `UnitPrice`, `TotAmt`, `AssAmt`, `GstRt`, `IgstAmt`/`CgstAmt`/`SgstAmt`, `CesRt`/`CesAmt`, `TotItemVal` | `invoice_items` |
| `ValDtls` | `AssVal`, `CgstVal`, `SgstVal`, `IgstVal`, `CesVal`, `RndOffAmt`, `TotInvVal` | invoice totals |
| `EwbDtls` (optional) | `TransId`, `TransMode`, `Distance`, `VehNo`, `VehType` | to generate the e-way in the **same** call (see runbook 02 §4) |

Amounts are numbers (2 dp); dates are `dd/mm/yyyy`. Confirm the exact minor
version and mandatory-field set against **your GSP's current schema** — NIC
revises it periodically.

## 4. Endpoints (reference — confirm versions with your GSP)

| Action | Method + path (NIC direct) | Notes |
|---|---|---|
| Generate IRN | `POST {IRP}/eivital/v1.04/invoice` | body `{ "Data": AES(Sek, INV-01) }` |
| Cancel IRN | `POST {IRP}/eicore/v1.03/invoice/cancel` | within **24h** of generation |
| Get IRN details | `GET {IRP}/eivital/v1.04/invoice/irn/{irn}` | reconciliation |

A GSP will expose its own paths/bearer scheme — the adapter maps the interface in
runbook 00 §2 onto whatever the GSP provides.

## 5. Response → persistence

On success the portal returns (inside the AES-encrypted `Data`):

| Response field | Invoice column |
|---|---|
| `Irn` (64-char hash) | `irn` |
| `AckNo` | `ack_number` |
| `AckDt` | `ack_date` |
| `SignedQRCode` | `signed_qr_code` |
| (derived) status | `einvoice_status = 'generated'` |

`SignedInvoice` (a JWT) can be stored/logged to a document store if you want the
signed copy; at minimum persist the QR (it must print on the invoice PDF — wire it
into the existing invoice PDF renderer). Verify the QR decodes to the IRN + key
fields before marking `generated`.

## 6. Cancellation & corrections

- **Within 24h:** cancel via the cancel endpoint with `CnlRsn` +
  `CnlRem` (remarks). Reason codes: `1`=Duplicate, `2`=Data entry mistake,
  `3`=Order cancelled, `4`=Other. Wire cancellation as its own approval
  (`actionKind = einvoice_cancel`) so a human authorises it, then set
  `einvoice_status = 'cancelled'`. An IRN, once cancelled, **cannot be
  regenerated for the same DocNo** — a new document number is required.
- **After 24h:** no cancel. Issue a **credit note** (with its own IRN) instead —
  this is the standard correction path; document it for finance.

## 7. Common error codes (handle explicitly)

| Code | Meaning | Handling |
|---|---|---|
| `2150` | Duplicate IRN (already generated for this DocNo) | **Treat as success** — reconcile the returned IRN onto the invoice, close the job |
| `2172` | IRN already cancelled | Set `cancelled`; do not retry |
| `1005`/`1006`/`1007` | Invalid/expired auth token / login | Re-authenticate (§00.3), retry once |
| `2xxx` (schema) | Missing/invalid field | `failed` with the field message; surface to the operator to fix master data |
| Rate limit / `429`/5xx | Portal busy | Exponential backoff, bounded retries; leave job `queued` |

## 8. Sandbox test plan

1. Seed a B2B invoice with valid test GSTINs, HSN on every line, reconciling
   totals, a real place-of-supply.
2. Prepare (`POST /agents/automation/run { compliance: 'einvoice', invoiceId }`) →
   pending approval with `actionKind = einvoice_irn`.
3. Approve (`POST /agents/approvals/:id/decide { decision: 'approved' }`) → the job
   executes against sandbox.
4. Assert: `irn`, `ack_number`, `ack_date`, `signed_qr_code` populated;
   `einvoice_status = 'generated'`; QR decodes; audit shows `gst.irn.generated`
   with the IRN + approver.
5. Re-run the same prepare/approve → expect duplicate `2150` reconciled (no second
   IRN).
6. Cancel within 24h → `einvoice_status = 'cancelled'`.
7. Negative: malformed GSTIN, missing HSN, non-reconciling totals → each rejected
   in pre-flight **without** a portal call.

## 9. Definition of done

- Full INV-01 mapping unit-tested; pre-flight rejects the bad cases above.
- Sandbox plan (§8) green including duplicate + cancel.
- QR printed on the invoice PDF; IRN visible in the UI and audit.
- Rollback (`GST_PROVIDER=disabled`) reverts to prepare-only.
- Owner sign-off on one production pilot invoice.
