# Controlled pilot operating checklist — one-of-each order-to-cash

A single, end-to-end run of the core RMC flow on the pilot tenant, to prove the
live system works before wider use. **Operating checklist only** — no code, no
deploy; run it as the owner in the app.

> **▶ Interactive version** — run this step-by-step in your browser with progress,
> evidence tracking, and print: **[Pilot run sheet](https://claude.ai/code/artifact/405a0ad0-e3a3-4921-8b4b-6008ff20e223)**.
> Companion: **[Visual approval sheet](https://claude.ai/code/artifact/65dc6e10-4259-42fe-a9a1-da7d476130e0)** — complete the UI sign-off first.
> *(Artifacts are private to the owner's Claude account until shared from the sheet's share menu.)*

## Scope

- Run as the **owner login on the pilot tenant**.
- Do **one** of each item below, **in order**. Each step should complete cleanly,
  carry the correct number series, transition status, compute correct amounts, and
  (where noted) generate a PDF.

### Explicitly OFF during this pilot — do NOT enable or test

QC (slump / cubes) · GPS live tracking · e-invoice / e-way (IRN / EWB) ·
Tally export · payment gateway · customer portal · mobile app · AI assistant ·
procurement / purchase · payroll · GL · bank reconciliation.

*(The invoice step uses plain GST math only — no IRN / e-way generation.)*

## The run

| # | Step | Do | Verify | PDF |
|---|---|---|---|:--:|
| 1 | **Customer** | Masters → Customers → create 1 | Saved; appears in list; GSTIN / state captured | — |
| 2 | **Site / Project** | Create 1 site under that customer | Linked to the customer | — |
| 3 | **Quotation** | New quotation: grade + qty + rate → submit → approve | Totals correct; status → Approved | ✅ |
| 4 | **Order** | Convert quotation → order draft → confirm (credit check passes) | Order created; status → Confirmed; number series correct | — |
| 5 | **Production plan** | Create 1 plan for the order | Scheduled against plant / date | — |
| 6 | **Batch ticket** | Create 1 batch ticket from the plan / queue | Ticket qty matches order; status set | ✅ |
| 7 | **Delivery challan** | Create 1 challan (vehicle + qty) | Challan issued; qty ties to ticket | ✅ |
| 8 | **Invoice** | Generate 1 invoice from the challan / order | Amounts + GST correct; status → Issued *(no IRN / e-way)* | ✅ |
| 9 | **Receipt** | Record 1 receipt against the invoice | Payment posted; allocated to the invoice | — |
| 10 | **Outstanding** | Billing → Outstanding | Customer balance = invoice − receipt; correct aging bucket | — |
| 11 | **Report** | Run one report (sales / billing / production) | Figures match the records just created | — |

At every step also confirm: the document **number series** is correct, the **status
transition** is right, the **amounts/totals** are correct, and **RBAC** lets the
owner perform the action.

## What to capture (evidence the pilot passed)

- The **5 PDFs**: quotation, batch ticket, challan, invoice, receipt.
- On-screen shots of: the **confirmed order**, the **outstanding aging** (after the
  receipt), and the **report**.
- Name files by step so the sequence is self-evident, e.g. `03-quotation.pdf`,
  `07-challan.pdf`, `10-outstanding.png`.

## Blocker vs. can-wait (pilot)

**BLOCKER (fix before pilot go-live):**
- A core step **can't complete** (customer / quotation / order / batch ticket / challan / invoice / receipt)
- **Wrong money** — incorrect totals, tax, or outstanding balance
- Invoice or challan **PDF won't generate**
- Any sign of **cross-tenant data leakage** or an RBAC gap the owner can see

**Can wait (post-pilot):**
- Minor visual / wording nits on any screen
- Refinement of empty / error states
- Everything in the **OFF** module list above — deferred by design, not a pilot gate
