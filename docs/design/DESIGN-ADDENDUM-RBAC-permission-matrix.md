# RMC Plant SaaS Software
## Design Addendum: RBAC Role × Permission Matrix

**Status:** Design Stage addendum (completes the RBAC artifact referenced in Design Doc 9 §14 and Design Doc 11 §5).
**Scope:** Phase 1 permissions only. Future-phase permissions are listed and marked *(later)*.
**Basis:** Roles from Design Doc 11 §5.4; permission keys from Design Doc 6 §6.3 and Design Doc 7; approval roles from SRS v1.4 §3.4/§5.6 (via Owner Decision Addenda v1.1 §8.3 and v1.2 §5.3) and Design Doc 2 §5.4.

> These are **default** permission sets. Roles are tenant-editable (Design Doc 6 `roles` / `role_permissions`), so a tenant may tighten or widen any cell. The defaults below follow the least-privilege rules in Section 8.

---

## 1. Role List

### 1.1 Platform Roles (no tenant operational data by default)

| Role key | Scope | Phase |
|----------|-------|-------|
| `super_admin` | SaaS platform only (tenants, plans, billing, coupons, support, platform reports). No tenant business data except via audited support mode. | 1 |
| `support_staff` | No tenant data by default. Time-bound, approved, audited **support mode** only. | 1 |

### 1.2 Tenant Roles

| Role key | Primary responsibility | Phase |
|----------|------------------------|-------|
| `company_owner` | Top tenant authority — oversight, all approvals, full reports. | 1 |
| `company_admin` | Configuration authority — company/plant/user/role setup, masters, integrations. | 1 |
| `plant_manager` | Plant operations — production, dispatch, inventory; negative-stock & stock-adjustment approver. | 1 |
| `sales_manager` | Sales — leads, quotations, rate contracts, orders; discount approver. | 1 |
| `sales_executive` | Sales data entry — leads, quotations, orders (requests discount, cannot approve). | 1 |
| `dispatch_manager` | Dispatch board, vehicle allocation, delivery challans. | 1 |
| `batching_operator` | Batch queue and manual batch tickets (standalone plant app). | 1 |
| `store_staff` | Inventory, material inward, weighbridge, stock requests. (Acts as "Store Manager" when granted approval.) | 1 |
| `qc_engineer` | Mix design create/submit and mix-design approval. | 1 |
| `accounts_manager` | Billing, invoices, receipts, outstanding, Tally export; credit-hold & invoice-cancel approver. | 1 |
| `fleet_manager` | Vehicles, drivers, transporters, document-expiry tracking. | 1 |
| `auditor` | Read-only across all modules + audit-log view/export. No create/edit. | 1 |
| `driver` | Trip execution (mobile). | *2 (later)* |

---

## 2. Permission Key List (Phase 1)

Format: `module.action`.

**Platform (super_admin only):**
`platform.tenants.view/create/edit/suspend/activate` · `platform.plans.manage` · `platform.modules.manage` · `platform.saas_billing.manage` · `platform.coupons.manage` · `platform.support_access.grant` · `platform.reports.view` · `platform.audit.view`

**Company & Settings:**
`company.view/edit` · `legal_entities.manage` · `plants.view/create/edit/deactivate` · `users.view/create/edit/deactivate/reset_password` · `roles.view/manage` · `permissions.assign` · `number_series.manage` · `gst_settings.manage` · `language.manage` · `print_templates.manage` · `integrations.view/manage` · `settings.manage`

**Masters:**
`customers.view/create/edit/block` · `customer_contacts.manage` · `sites.view/create/edit` · `materials.view/create/edit` · `suppliers.view/create/edit` · `grades.view/create/edit` · `mix_designs.view/create/edit/submit/approve/version` · `vehicles.view/create/edit` · `drivers.view/create/edit` · `transporters.manage` · `uoms.manage` · `hsn_tax_rates.manage` · `banks.manage` · `payment_modes.manage` · `rate_contracts.view/create/edit/approve`

**Sales & Orders:**
`leads.view/create/edit/convert` · `quotations.view/create/edit/submit/approve/revise/convert/print/share` · `quotation_discount.approve` · `orders.view/create/edit/confirm/hold/cancel` · `order_items.manage` · `credit_hold.view/request/approve`

**Production & Dispatch:**
`production_plans.view/create/edit/confirm/cancel` · `batch_queue.operate` · `batch_tickets.view/create/edit/print/import` · `batch_ticket.correct` · `dispatches.view/create/assign_vehicle/update_status/reject/return` · `delivery_challans.view/create/issue/print/cancel/share`

**Inventory & Weighbridge:**
`stock.view` · `stock_transactions.view` · `material_inward.view/create/approve/cancel` · `stock.adjust` · `stock_adjustment.approve` · `negative_stock.request/approve` · `weighbridge.view/create/print`

**Billing & Payment:**
`invoices.view/create/issue/cancel/print/share` · `invoice_cancellation.approve` · `receipts.view/create/allocate/cancel/print` · `outstanding.view` · `einvoice_fields.view/edit` · `ewaybill_fields.view/edit`

**Integrations & Control:**
`tally_export.generate/download` · `whatsapp.templates.manage` · `whatsapp.send` · `notification_logs.view` · `approvals.view/act` · `audit_logs.view/export` · `reports.view/export` · `sync.view/manage` · `devices.manage` · `support.access`

**Future-phase permissions *(later)*:**
`driver_app.*` *(P2)* · `gps.live.*` *(P2)* · `qc.tests.* / qc.certificate.*` *(P2)* · `purchase.*` *(P2)* · `credit_note.* / debit_note.*` *(P3)* · `ledger.full.* / vendor_ledger.*` *(P3)* · `einvoice.generate/cancel` *(P3)* · `ewaybill.generate/cancel` *(P3)* · `payment_gateway.*` *(P3)* · `customer_portal.*` *(P4)* · `ai.*` *(P5)*

---

## 3. Module Access Matrix (Tenant Roles — Phase 1 Defaults)

Legend: **F** = Full (view/create/edit + module actions) · **CE** = Create + Edit + View · **V** = View only · **—** = No access.
Master-column scope notes are in the footnotes.

| Role | Settings | Users & Roles | Masters | Sales¹ | Orders | Production/Batch | Dispatch/Challan | Inventory/WB | Billing | Reports | Audit |
|------|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| company_owner | V | V | V | V | V | V | V | V | V | F | V |
| company_admin | F | F | F | CE | CE | V | V | V | V | F | V |
| plant_manager | — | — | V² | V | CE | F | F | CE | V | CE | — |
| sales_manager | — | — | CE³ | F | F | V | V | — | V⁴ | CE | — |
| sales_executive | — | — | CE³ | CE | CE | — | — | — | V⁴ | V | — |
| dispatch_manager | — | — | V | V | V | CE | F | V | — | V | — |
| batching_operator | — | — | V⁵ | — | V | CE⁶ | V | V | — | — | — |
| store_staff | — | — | CE⁷ | — | — | V | — | F | — | V | — |
| qc_engineer | — | — | CE⁸ | — | V | V | — | — | — | V | — |
| accounts_manager | — | — | V³ | V | V | — | V | V | F | CE | — |
| fleet_manager | — | — | CE⁹ | — | V | V | CE¹⁰ | — | — | V | — |
| auditor | V | V | V | V | V | V | V | V | V | F | F¹¹ |

Footnotes:
1. **Sales** = Leads + Quotations + Rate Contracts.
2. Plant manager sees master data read-only (grades, mix designs, vehicles) needed to plan.
3. Scoped to **Customer/Site** masters (and Rate Contracts for sales_manager).
4. **Outstanding view only** — full ledger is Phase 3.
5. Scoped to **Grade/Mix Design** (view approved mix only).
6. Batch queue + **manual batch ticket create/print**; cannot approve mix design.
7. Scoped to **Material/Supplier** masters.
8. Scoped to **Grade/Mix Design** (create + submit for approval).
9. Scoped to **Vehicle/Driver/Transporter** masters.
10. Vehicle **allocation** only (not challan issue).
11. Auditor: audit **view + export**, no edit.

> Integration configuration lives under **Settings** (`integrations.manage`); plant-level integration config may be delegated to `plant_manager` if the tenant grants it.

---

## 4. Sensitive & Approval Permission Matrix

`✓` = granted by default · `—` = not granted · `◐` = granted only if the tenant explicitly permits.
Approver sets are pinned to the requirement decisions (citations at right).

| Permission | Owner | Admin | Plant Mgr | Sales Mgr | Accounts Mgr | Store Staff | QC | Auditor | Source |
|------------|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|--------|
| `settings.manage` | ✓ | ✓ | — | — | — | — | — | — | — |
| `users.manage` / `roles.manage` | ✓ | ✓ | — | — | — | — | — | — | — |
| `integrations.manage` (credentials) | ✓ | ✓ | ◐ (plant only) | — | — | — | — | — | Doc 11 §12 |
| `number_series.manage` | ✓ | ✓ | — | — | — | — | — | — | — |
| `credit_hold.approve` | ✓ | ✓ | — | ◐ | ✓ | — | — | — | SRS §8.3 |
| `negative_stock.approve` | ✓ | ✓ | ✓ | — | — | ◐ (as Store Mgr) | — | — | v1.2 §5.3 |
| `quotation_discount.approve` | ✓ | ✓ | — | ✓ | — | — | — | — | Doc 2 §5.4 |
| `invoice_cancellation.approve` | ✓ | ✓ | — | — | ✓ | — | — | — | Doc 2 §5.4 |
| `stock_adjustment.approve` | ✓ | ✓ | ✓ | — | — | ◐ | — | — | v1.2 §5 |
| `mix_design.approve` | ✓ | — | ◐ | — | — | — | ✓ | — | Doc 2 §13.4 |
| `invoice.create` / `invoice.issue` | — | — | — | — | ✓ | — | — | — | — |
| `invoice.cancel` (request) | — | — | — | — | ✓ | — | — | — | — |
| `receipts.cancel` (request) | — | — | — | — | ✓ | — | — | — | — |
| `tally_export.generate` | — | ✓ | — | — | ✓ | — | — | — | — |
| `audit_logs.view` | ✓ | ✓ | ◐ (plant) | — | — | — | — | ✓ | Doc 11 §14 |
| `audit_logs.export` | ✓ | ✓ | — | — | — | — | — | ✓ | Doc 11 §17 |

**Separation-of-duties note:** invoice **creation** (`accounts_manager`) and invoice-**cancellation approval** (`owner`/`admin`/`accounts_manager`) should not, in practice, be the same person for the same document where the tenant has enough staff; the approval engine records the requester and approver separately (Doc 11 §15).

---

## 5. Plant Access Rules

- Plant scope is controlled by `user_plant_access` (Design Doc 6 §6.6): **All plants / selected plants / one plant**.
- Plant-scoped modules (access must be checked against the user's assigned plants): `production_plans`, `batch_queue`, `batch_tickets`, `dispatches`, `delivery_challans`, `stock_balances`, `stock_transactions`, `material_inwards`, `weighbridge_entries`, `vehicles`, `local_number_reservations`, `devices`, and all plant reports.
- **Frontend plant filters are never trusted** — the backend re-verifies plant access on every request; unauthorized ⇒ `PLANT_ACCESS_DENIED` (Design Doc 11 §7.3).
- A single-plant user defaults to that plant; a multi-plant user gets an "All / per-plant" filter.

---

## 6. Super Admin vs Tenant Admin Separation

| Aspect | `super_admin` (platform) | `company_admin` (tenant) |
|--------|--------------------------|--------------------------|
| Manages | Tenants, plans, modules, SaaS billing, coupons, support access, platform reports/health | Company profile, legal entities, plants, users, roles, number series, GST/language/print settings, integrations, masters |
| Tenant business data (orders, invoices, stock) | **No access by default** — only via audited, time-bound **support mode** | Full within own tenant (subject to plant access) |
| Cross-tenant access | Platform APIs only; may pass explicit `tenant_id` | Never — `tenant_id` is derived from token (Doc 11 §6.3) |
| Billing to whom | Raises SaaS invoices *to* tenants | Pays tenant subscription; cannot change platform billing |
| Audit | Platform audit logs | Tenant audit logs only |

Rule: **no single account is both platform operator and tenant operator** except through the explicit support-mode grant, which is logged.

---

## 7. Support Access Limitations

Support access (`support_staff` + `support.access`) is governed by Design Doc 9 §10 and Doc 11 §16:

- Must be **requested → approved (Tenant Owner/Admin or Super Admin) → time-bound → auto-expiring**.
- **Every action is audit-logged** to `support_access_logs` and `audit_logs`.
- Support users **must not**: export financial data (unless explicitly approved), change credentials, view integration secrets, cancel/delete transactions (unless explicitly permitted), or change subscription billing.
- Tenant can view its own **support-access history**.
- Recommended maximum session validity is short and configurable; access ends automatically at expiry.

---

## 8. Least-Privilege Rules

1. Every role receives only the minimum permissions for its job (Design Doc 11 §5.5).
2. Approvals are separated from data entry: a requester should not approve their own request; the approval engine records both parties (Doc 11 §15).
3. Operational roles do not get configuration rights: `plant_manager`, `dispatch_manager`, `store_staff`, `batching_operator`, `qc_engineer`, `sales_*`, `fleet_manager`, `accounts_manager` have **no** `settings.manage` / `users.manage` by default.
4. Financial actions are constrained: only `accounts_manager` creates invoices/receipts; cancellation requires approval + reason + audit (Doc 11 §18).
5. Secrets are never exposed to any role's frontend; integration screens show status only (Doc 11 §12.2).
6. Read-only roles (`auditor`) can never create/edit/cancel.
7. Plant-scoped roles cannot reach other plants' data even if IDs are guessed (backend re-verifies; RLS as defense-in-depth, Doc 11 §6.4).
8. Future-phase permissions remain disabled until their phase ships and the plan enables the module (`MODULE_NOT_ENABLED`).

---

## 9. Acceptance

This addendum is accepted when:

1. Role list is defined (platform + tenant, with phase).
2. Phase-1 permission keys are listed; future permissions marked *(later)*.
3. Module access matrix is defined for all Phase-1 tenant roles.
4. Sensitive/approval matrix is pinned to the requirement decisions.
5. Plant access rules are defined.
6. Super Admin vs Tenant Admin separation is defined.
7. Support access limitations are defined.
8. Least-privilege rules are defined.
