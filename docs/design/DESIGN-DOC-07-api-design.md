# RMC Plant SaaS Software
## Design Stage Document 7: API Design

## 1. Purpose of This Document

This document defines the API design for the RMC Plant SaaS software.

This API design must support:

- Multi-tenant SaaS platform
- Super Admin portal
- Tenant web portal
- Standalone plant app
- Future driver app
- Future sales app
- Future customer portal
- Offline sync
- Role-based access control
- Approval workflows
- Audit logs
- WhatsApp API integration
- Tally export
- Batching integration-ready structure
- Weighbridge integration-ready structure
- GPS integration-ready structure
- E-invoice/e-way bill-ready fields in Phase 1

This document is part of the **Design Stage**.

No development should start before API design, database design, architecture design, and security design are reviewed.

---

# 2. API Design Principles

## 2.1 SaaS-First API

Every tenant-level API must be tenant-aware.

The API must never allow one tenant to access another tenant’s data.

Tenant filtering must happen at:

- Authentication middleware
- Authorization middleware
- Database query level
- Report/export level
- Offline sync level

---

## 2.2 API Versioning

All APIs must be versioned.

Base path:

```text
/api/v1
```

Example:

```text
/api/v1/orders
/api/v1/customers
/api/v1/invoices
```

Future breaking changes should use:

```text
/api/v2
```

---

## 2.3 API Style

Recommended style:

```text
REST API + WebSocket events
```

REST API will handle:

- CRUD operations
- Transactions
- Reports
- Exports
- Sync
- Approvals

WebSocket will handle:

- Dispatch board live updates
- Sync notifications
- Approval notifications
- Low stock alerts
- WhatsApp delivery status
- Vehicle/trip status updates

---

## 2.4 Standard Response Format

All successful responses should follow:

```json
{
  "success": true,
  "data": {},
  "message": "Operation completed successfully",
  "meta": {}
}
```

List responses should follow:

```json
{
  "success": true,
  "data": [],
  "meta": {
    "page": 1,
    "per_page": 25,
    "total": 100,
    "total_pages": 4
  }
}
```

Error responses should follow:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Credit limit exceeded",
    "details": {}
  }
}
```

---

## 2.5 Standard HTTP Methods

Use standard HTTP methods:

```text
GET     Read data
POST    Create data / perform action
PUT     Full update
PATCH   Partial update / status update
DELETE  Soft delete or deactivate
```

---

## 2.6 Pagination, Filtering, and Sorting

All list APIs must support:

```text
?page=1
?per_page=25
?sort_by=created_at
?sort_order=desc
?status=active
?search=keyword
```

Common filters:

```text
date_from
date_to
tenant_id
plant_id
customer_id
site_id
vehicle_id
driver_id
grade_id
status
created_by
```

---

## 2.7 Idempotency Requirement

Critical create APIs must support idempotency to prevent duplicates.

Required header:

```text
Idempotency-Key: unique-client-generated-key
```

Required for:

- Orders
- Delivery challans
- Invoices
- Receipts
- Batch tickets
- Offline sync records
- Payment callbacks
- WhatsApp message triggers

---

## 2.8 Optimistic Locking

Important update APIs should support record version checking.

Use:

```text
version
updated_at
```

If two users update the same record, the API should detect conflict.

Error code:

```text
VERSION_CONFLICT
```

---

## 2.9 Soft Delete Rule

Master records may be soft deleted or deactivated.

Transaction records should not be deleted.

Examples:

- Invoice: cancel, not delete
- Challan: cancel, not delete
- Payment: reverse/cancel with approval
- Batch ticket: correction with audit log, not delete

---

# 3. Authentication and Authorization APIs

## 3.1 Auth APIs

### Login

```text
POST /api/v1/auth/login
```

Request:

```json
{
  "login": "user@example.com",
  "password": "password",
  "device_id": "optional-device-id",
  "language": "en"
}
```

Response:

```json
{
  "access_token": "jwt-token",
  "refresh_token": "refresh-token",
  "user": {},
  "tenant": {},
  "permissions": []
}
```

---

### Refresh Token

```text
POST /api/v1/auth/refresh
```

---

### Logout

```text
POST /api/v1/auth/logout
```

---

### Forgot Password

```text
POST /api/v1/auth/forgot-password
```

---

### Reset Password

```text
POST /api/v1/auth/reset-password
```

---

### Current User

```text
GET /api/v1/auth/me
```

Returns:

- User profile
- Tenant details
- Role
- Permissions
- Plant access
- Language preference
- Subscription status

---

## 3.2 Authorization Rules

Every request must check:

1. Is user authenticated?
2. Is tenant active?
3. Is subscription valid?
4. Is module enabled for tenant plan?
5. Does user have permission?
6. Does user have plant access?
7. Is record inside the same tenant?

---

# 4. Super Admin SaaS APIs

These APIs are for platform owners only.

## 4.1 Tenant APIs

```text
GET    /api/v1/platform/tenants
POST   /api/v1/platform/tenants
GET    /api/v1/platform/tenants/{tenant_id}
PATCH  /api/v1/platform/tenants/{tenant_id}
POST   /api/v1/platform/tenants/{tenant_id}/activate
POST   /api/v1/platform/tenants/{tenant_id}/suspend
POST   /api/v1/platform/tenants/{tenant_id}/reactivate
GET    /api/v1/platform/tenants/{tenant_id}/usage
GET    /api/v1/platform/tenants/{tenant_id}/health
```

Tenant list filters:

```text
status
plan_id
trial
subscription_expiring
search
```

---

## 4.2 Subscription Plan APIs

```text
GET    /api/v1/platform/plans
POST   /api/v1/platform/plans
GET    /api/v1/platform/plans/{plan_id}
PATCH  /api/v1/platform/plans/{plan_id}
DELETE /api/v1/platform/plans/{plan_id}
```

Plan module APIs:

```text
GET   /api/v1/platform/plans/{plan_id}/modules
PUT   /api/v1/platform/plans/{plan_id}/modules
```

---

## 4.3 Tenant Subscription APIs

```text
GET   /api/v1/platform/tenant-subscriptions
POST  /api/v1/platform/tenant-subscriptions
GET   /api/v1/platform/tenant-subscriptions/{subscription_id}
PATCH /api/v1/platform/tenant-subscriptions/{subscription_id}
POST  /api/v1/platform/tenant-subscriptions/{subscription_id}/renew
POST  /api/v1/platform/tenant-subscriptions/{subscription_id}/cancel
```

---

## 4.4 SaaS Billing APIs

```text
GET   /api/v1/platform/saas-invoices
POST  /api/v1/platform/saas-invoices
GET   /api/v1/platform/saas-invoices/{invoice_id}
POST  /api/v1/platform/saas-invoices/{invoice_id}/send
POST  /api/v1/platform/saas-invoices/{invoice_id}/cancel
```

SaaS payment APIs:

```text
GET   /api/v1/platform/saas-payments
POST  /api/v1/platform/saas-payments
GET   /api/v1/platform/saas-payments/{payment_id}
```

---

## 4.5 Coupon APIs

```text
GET    /api/v1/platform/coupons
POST   /api/v1/platform/coupons
PATCH  /api/v1/platform/coupons/{coupon_id}
DELETE /api/v1/platform/coupons/{coupon_id}
GET    /api/v1/platform/coupons/{coupon_id}/usage
```

---

## 4.6 Support Access APIs

```text
POST /api/v1/platform/support-access/request
POST /api/v1/platform/support-access/{request_id}/approve
POST /api/v1/platform/support-access/{request_id}/revoke
GET  /api/v1/platform/support-access/logs
```

---

# 5. Tenant Setup APIs

## 5.1 Company APIs

```text
GET   /api/v1/company
PATCH /api/v1/company
POST  /api/v1/company/logo
POST  /api/v1/company/signature
```

---

## 5.2 Legal Entity APIs

```text
GET    /api/v1/legal-entities
POST   /api/v1/legal-entities
GET    /api/v1/legal-entities/{id}
PATCH  /api/v1/legal-entities/{id}
DELETE /api/v1/legal-entities/{id}
```

---

## 5.3 Plant APIs

```text
GET    /api/v1/plants
POST   /api/v1/plants
GET    /api/v1/plants/{plant_id}
PATCH  /api/v1/plants/{plant_id}
DELETE /api/v1/plants/{plant_id}
```

Plant integration settings:

```text
GET   /api/v1/plants/{plant_id}/integrations
PUT   /api/v1/plants/{plant_id}/integrations
```

---

## 5.4 Number Series APIs

```text
GET   /api/v1/number-series
POST  /api/v1/number-series
PATCH /api/v1/number-series/{series_id}
POST  /api/v1/number-series/preview
POST  /api/v1/number-series/reserve
```

Reserve is required for offline numbering.

---

## 5.5 Tenant Settings APIs

```text
GET   /api/v1/settings
GET   /api/v1/settings/{setting_key}
PUT   /api/v1/settings/{setting_key}
```

Important settings:

```text
negative_stock_policy
credit_block_stage
default_language
whatsapp_enabled
einvoice_phase1_mode
ewaybill_phase1_mode
```

---

# 6. User, Role, and Permission APIs

## 6.1 User APIs

```text
GET    /api/v1/users
POST   /api/v1/users
GET    /api/v1/users/{user_id}
PATCH  /api/v1/users/{user_id}
POST   /api/v1/users/{user_id}/deactivate
POST   /api/v1/users/{user_id}/activate
POST   /api/v1/users/{user_id}/reset-password
```

---

## 6.2 Role APIs

```text
GET    /api/v1/roles
POST   /api/v1/roles
GET    /api/v1/roles/{role_id}
PATCH  /api/v1/roles/{role_id}
DELETE /api/v1/roles/{role_id}
```

---

## 6.3 Permission APIs

```text
GET /api/v1/permissions
GET /api/v1/roles/{role_id}/permissions
PUT /api/v1/roles/{role_id}/permissions
```

---

## 6.4 User Plant Access APIs

```text
GET /api/v1/users/{user_id}/plant-access
PUT /api/v1/users/{user_id}/plant-access
```

---

# 7. Master Data APIs

## 7.1 Customer APIs

```text
GET    /api/v1/customers
POST   /api/v1/customers
GET    /api/v1/customers/{customer_id}
PATCH  /api/v1/customers/{customer_id}
DELETE /api/v1/customers/{customer_id}
POST   /api/v1/customers/{customer_id}/block
POST   /api/v1/customers/{customer_id}/unblock
GET    /api/v1/customers/{customer_id}/outstanding
GET    /api/v1/customers/{customer_id}/summary
```

Customer contacts:

```text
GET  /api/v1/customers/{customer_id}/contacts
POST /api/v1/customers/{customer_id}/contacts
PATCH /api/v1/customers/{customer_id}/contacts/{contact_id}
DELETE /api/v1/customers/{customer_id}/contacts/{contact_id}
```

---

## 7.2 Site / Project APIs

```text
GET    /api/v1/sites
POST   /api/v1/sites
GET    /api/v1/sites/{site_id}
PATCH  /api/v1/sites/{site_id}
DELETE /api/v1/sites/{site_id}
```

Filters:

```text
customer_id
status
search
```

---

## 7.3 Material APIs

```text
GET    /api/v1/materials
POST   /api/v1/materials
GET    /api/v1/materials/{material_id}
PATCH  /api/v1/materials/{material_id}
DELETE /api/v1/materials/{material_id}
```

---

## 7.4 Supplier APIs

```text
GET    /api/v1/suppliers
POST   /api/v1/suppliers
GET    /api/v1/suppliers/{supplier_id}
PATCH  /api/v1/suppliers/{supplier_id}
DELETE /api/v1/suppliers/{supplier_id}
```

---

## 7.5 Concrete Grade APIs

```text
GET    /api/v1/concrete-grades
POST   /api/v1/concrete-grades
GET    /api/v1/concrete-grades/{grade_id}
PATCH  /api/v1/concrete-grades/{grade_id}
DELETE /api/v1/concrete-grades/{grade_id}
```

---

## 7.6 Mix Design APIs

```text
GET   /api/v1/mix-designs
POST  /api/v1/mix-designs
GET   /api/v1/mix-designs/{mix_design_id}
PATCH /api/v1/mix-designs/{mix_design_id}
POST  /api/v1/mix-designs/{mix_design_id}/submit-approval
POST  /api/v1/mix-designs/{mix_design_id}/approve
POST  /api/v1/mix-designs/{mix_design_id}/reject
POST  /api/v1/mix-designs/{mix_design_id}/create-version
```

Mix design material APIs:

```text
GET /api/v1/mix-designs/{mix_design_id}/materials
PUT /api/v1/mix-designs/{mix_design_id}/materials
```

---

## 7.7 Vehicle APIs

```text
GET    /api/v1/vehicles
POST   /api/v1/vehicles
GET    /api/v1/vehicles/{vehicle_id}
PATCH  /api/v1/vehicles/{vehicle_id}
DELETE /api/v1/vehicles/{vehicle_id}
GET    /api/v1/vehicles/available
GET    /api/v1/vehicles/{vehicle_id}/documents
```

---

## 7.8 Driver APIs

```text
GET    /api/v1/drivers
POST   /api/v1/drivers
GET    /api/v1/drivers/{driver_id}
PATCH  /api/v1/drivers/{driver_id}
DELETE /api/v1/drivers/{driver_id}
GET    /api/v1/drivers/available
```

---

## 7.9 Common Master APIs

For Doc 6.1 master tables:

```text
GET    /api/v1/uoms
POST   /api/v1/uoms
PATCH  /api/v1/uoms/{id}

GET    /api/v1/hsn-tax-rates
POST   /api/v1/hsn-tax-rates
PATCH  /api/v1/hsn-tax-rates/{id}

GET    /api/v1/transporters
POST   /api/v1/transporters
PATCH  /api/v1/transporters/{id}

GET    /api/v1/banks
POST   /api/v1/banks
PATCH  /api/v1/banks/{id}

GET    /api/v1/payment-modes
POST   /api/v1/payment-modes
PATCH  /api/v1/payment-modes/{id}
```

---

# 8. Sales APIs

## 8.1 Lead APIs

```text
GET    /api/v1/leads
POST   /api/v1/leads
GET    /api/v1/leads/{lead_id}
PATCH  /api/v1/leads/{lead_id}
POST   /api/v1/leads/{lead_id}/convert-to-customer
POST   /api/v1/leads/{lead_id}/mark-lost
```

---

## 8.2 Quotation APIs

```text
GET   /api/v1/quotations
POST  /api/v1/quotations
GET   /api/v1/quotations/{quotation_id}
PATCH /api/v1/quotations/{quotation_id}
POST  /api/v1/quotations/{quotation_id}/submit-approval
POST  /api/v1/quotations/{quotation_id}/approve
POST  /api/v1/quotations/{quotation_id}/reject
POST  /api/v1/quotations/{quotation_id}/revise
POST  /api/v1/quotations/{quotation_id}/convert-to-order
GET   /api/v1/quotations/{quotation_id}/pdf
POST  /api/v1/quotations/{quotation_id}/send-whatsapp
```

Quotation items:

```text
GET /api/v1/quotations/{quotation_id}/items
PUT /api/v1/quotations/{quotation_id}/items
```

---

## 8.3 Rate Contract APIs

Rate contracts are required from Doc 6.1.

```text
GET    /api/v1/rate-contracts
POST   /api/v1/rate-contracts
GET    /api/v1/rate-contracts/{rate_contract_id}
PATCH  /api/v1/rate-contracts/{rate_contract_id}
POST   /api/v1/rate-contracts/{rate_contract_id}/activate
POST   /api/v1/rate-contracts/{rate_contract_id}/expire
POST   /api/v1/rate-contracts/{rate_contract_id}/revise
```

Rate contract items:

```text
GET /api/v1/rate-contracts/{rate_contract_id}/items
PUT /api/v1/rate-contracts/{rate_contract_id}/items
```

---

# 9. Order and Credit Control APIs

## 9.1 Order APIs

Orders must support multi-grade structure in database/API from day one.

Phase 1 UI may still allow only one grade per order.

```text
GET   /api/v1/orders
POST  /api/v1/orders
GET   /api/v1/orders/{order_id}
PATCH /api/v1/orders/{order_id}
POST  /api/v1/orders/{order_id}/cancel
POST  /api/v1/orders/{order_id}/hold
POST  /api/v1/orders/{order_id}/release
POST  /api/v1/orders/{order_id}/confirm
```

Order item APIs:

```text
GET /api/v1/orders/{order_id}/items
PUT /api/v1/orders/{order_id}/items
```

Order pricing source must support:

```text
quotation
rate_contract
manual_approved_rate
```

---

## 9.2 Credit Check API

```text
POST /api/v1/orders/credit-check
```

Request:

```json
{
  "customer_id": "uuid",
  "estimated_order_value": 50000
}
```

Response:

```json
{
  "credit_status": "passed",
  "credit_limit": 100000,
  "current_outstanding": 40000,
  "overdue_amount": 0,
  "available_credit": 60000
}
```

If failed:

```json
{
  "credit_status": "failed",
  "reason": "Credit limit exceeded",
  "credit_limit": 100000,
  "current_outstanding": 120000,
  "estimated_order_value": 50000
}
```

---

## 9.3 Credit Hold APIs

```text
GET  /api/v1/credit-holds
POST /api/v1/orders/{order_id}/credit-hold/request
GET  /api/v1/credit-holds/{request_id}
POST /api/v1/credit-holds/{request_id}/approve
POST /api/v1/credit-holds/{request_id}/reject
```

Rule:

```text
Credit limit blocks at order booking.
```

---

# 10. Production and Batching APIs

## 10.1 Production Plan APIs

```text
GET   /api/v1/production-plans
POST  /api/v1/production-plans
GET   /api/v1/production-plans/{plan_id}
PATCH /api/v1/production-plans/{plan_id}
POST  /api/v1/production-plans/{plan_id}/confirm
POST  /api/v1/production-plans/{plan_id}/cancel
```

Production plan items:

```text
GET  /api/v1/production-plans/{plan_id}/items
PUT  /api/v1/production-plans/{plan_id}/items
POST /api/v1/production-plans/{plan_id}/send-to-batch-queue
```

---

## 10.2 Batch Queue APIs

```text
GET  /api/v1/batch-queue
POST /api/v1/batch-queue/{queue_id}/start
POST /api/v1/batch-queue/{queue_id}/hold
POST /api/v1/batch-queue/{queue_id}/complete
```

---

## 10.3 Batch Ticket APIs

```text
GET   /api/v1/batch-tickets
POST  /api/v1/batch-tickets
GET   /api/v1/batch-tickets/{batch_ticket_id}
PATCH /api/v1/batch-tickets/{batch_ticket_id}
GET   /api/v1/batch-tickets/{batch_ticket_id}/print
POST  /api/v1/batch-tickets/import
```

Batch ticket material APIs:

```text
GET /api/v1/batch-tickets/{batch_ticket_id}/materials
PUT /api/v1/batch-tickets/{batch_ticket_id}/materials
```

---

## 10.4 Batching Connector APIs

Phase 1:

```text
GET  /api/v1/batching/connectors/config
PUT  /api/v1/batching/connectors/config
POST /api/v1/batching/import/manual
POST /api/v1/batching/import/file
```

Phase 2:

```text
POST /api/v1/batching/connectors/test
POST /api/v1/batching/connectors/sync
GET  /api/v1/batching/connectors/logs
```

Must support Putzmeister/IDS and future multi-brand connector design.

---

# 11. Dispatch and Delivery APIs

## 11.1 Dispatch APIs

```text
GET   /api/v1/dispatches
POST  /api/v1/dispatches
GET   /api/v1/dispatches/{dispatch_id}
PATCH /api/v1/dispatches/{dispatch_id}
POST  /api/v1/dispatches/{dispatch_id}/assign-vehicle
POST  /api/v1/dispatches/{dispatch_id}/mark-loaded
POST  /api/v1/dispatches/{dispatch_id}/mark-left-plant
POST  /api/v1/dispatches/{dispatch_id}/mark-reached-site
POST  /api/v1/dispatches/{dispatch_id}/mark-pouring
POST  /api/v1/dispatches/{dispatch_id}/mark-completed
POST  /api/v1/dispatches/{dispatch_id}/mark-delayed
POST  /api/v1/dispatches/{dispatch_id}/reject-load
POST  /api/v1/dispatches/{dispatch_id}/record-return
```

---

## 11.2 Dispatch Board API

```text
GET /api/v1/dispatch-board
```

Filters:

```text
date
plant_id
status
vehicle_id
customer_id
```

Response must return grouped statuses:

```text
waiting
under_batching
loaded
left_plant
reached_site
pouring
completed
delayed
rejected
```

---

## 11.3 Delivery Challan APIs

```text
GET   /api/v1/delivery-challans
POST  /api/v1/delivery-challans
GET   /api/v1/delivery-challans/{challan_id}
PATCH /api/v1/delivery-challans/{challan_id}
POST  /api/v1/delivery-challans/{challan_id}/issue
POST  /api/v1/delivery-challans/{challan_id}/mark-delivered
POST  /api/v1/delivery-challans/{challan_id}/cancel
GET   /api/v1/delivery-challans/{challan_id}/pdf
POST  /api/v1/delivery-challans/{challan_id}/send-whatsapp
```

---

# 12. Inventory and Weighbridge APIs

## 12.1 Stock Balance APIs

```text
GET /api/v1/stock-balances
GET /api/v1/stock-balances/{material_id}
```

Filters:

```text
plant_id
material_id
category
low_stock
negative_stock
```

---

## 12.2 Stock Transaction APIs

```text
GET  /api/v1/stock-transactions
POST /api/v1/stock-transactions
GET  /api/v1/stock-transactions/{transaction_id}
```

---

## 12.3 Material Inward APIs

```text
GET   /api/v1/material-inwards
POST  /api/v1/material-inwards
GET   /api/v1/material-inwards/{inward_id}
PATCH /api/v1/material-inwards/{inward_id}
POST  /api/v1/material-inwards/{inward_id}/approve
POST  /api/v1/material-inwards/{inward_id}/cancel
```

---

## 12.4 Weighbridge APIs

```text
GET   /api/v1/weighbridge-entries
POST  /api/v1/weighbridge-entries
GET   /api/v1/weighbridge-entries/{entry_id}
PATCH /api/v1/weighbridge-entries/{entry_id}
POST  /api/v1/weighbridge-entries/{entry_id}/create-material-inward
GET   /api/v1/weighbridge-entries/{entry_id}/print
```

Phase 2 direct integration APIs:

```text
POST /api/v1/weighbridge/integration/test
POST /api/v1/weighbridge/integration/read-weight
GET  /api/v1/weighbridge/integration/logs
```

---

## 12.5 Negative Stock APIs

```text
GET  /api/v1/negative-stock-requests
POST /api/v1/negative-stock-requests
GET  /api/v1/negative-stock-requests/{request_id}
POST /api/v1/negative-stock-requests/{request_id}/approve
POST /api/v1/negative-stock-requests/{request_id}/reject
```

Rule:

```text
Negative stock is allowed only with approval.
```

---

# 13. Billing and Payment APIs

## 13.1 Invoice APIs

```text
GET   /api/v1/invoices
POST  /api/v1/invoices
GET   /api/v1/invoices/{invoice_id}
PATCH /api/v1/invoices/{invoice_id}
POST  /api/v1/invoices/from-challans
POST  /api/v1/invoices/{invoice_id}/issue
POST  /api/v1/invoices/{invoice_id}/cancel
GET   /api/v1/invoices/{invoice_id}/pdf
POST  /api/v1/invoices/{invoice_id}/send-whatsapp
```

---

## 13.2 Invoice Item Requirement

Invoice item API payload must support:

```json
{
  "item_type": "concrete",
  "hsn_sac": "3824",
  "description": "Ready Mix Concrete M25",
  "uom": "M3",
  "quantity_m3": 10,
  "rate": 5000,
  "tax_rate": 18,
  "cess_rate": 0,
  "cess_amount": 0,
  "line_total": 59000
}
```

Item types:

```text
concrete
pumping
transport
waiting_charge
other
```

---

## 13.3 E-Invoice Ready Field APIs

Phase 1 fields only:

```text
GET  /api/v1/invoices/{invoice_id}/einvoice-fields
PUT  /api/v1/invoices/{invoice_id}/einvoice-fields
```

Phase 3 direct API:

```text
POST /api/v1/invoices/{invoice_id}/einvoice/generate
POST /api/v1/invoices/{invoice_id}/einvoice/cancel
GET  /api/v1/invoices/{invoice_id}/einvoice/status
```

---

## 13.4 E-Way Bill Ready Field APIs

Phase 1 fields only:

```text
GET  /api/v1/invoices/{invoice_id}/ewaybill-fields
PUT  /api/v1/invoices/{invoice_id}/ewaybill-fields
```

Phase 3 direct API:

```text
POST /api/v1/invoices/{invoice_id}/ewaybill/generate
POST /api/v1/invoices/{invoice_id}/ewaybill/cancel
GET  /api/v1/invoices/{invoice_id}/ewaybill/status
```

---

## 13.5 Payment / Receipt APIs

```text
GET   /api/v1/payments
POST  /api/v1/payments
GET   /api/v1/payments/{payment_id}
PATCH /api/v1/payments/{payment_id}
POST  /api/v1/payments/{payment_id}/cancel
GET   /api/v1/payments/{payment_id}/pdf
POST  /api/v1/payments/{payment_id}/send-whatsapp
```

Payment allocation:

```text
GET /api/v1/payments/{payment_id}/allocations
PUT /api/v1/payments/{payment_id}/allocations
```

---

## 13.6 Outstanding APIs

Phase 1:

```text
GET /api/v1/customers/{customer_id}/outstanding
GET /api/v1/outstanding
```

Phase 3:

```text
GET /api/v1/customers/{customer_id}/ledger
GET /api/v1/vendor-ledgers
```

Phase rule:

```text
Phase 1 = basic outstanding view
Phase 3 = full ledger with credit note/debit note
```

---

# 14. Tally Export APIs

Phase 1: export-ready files.

```text
GET  /api/v1/tally/exports
POST /api/v1/tally/exports
GET  /api/v1/tally/exports/{export_id}
GET  /api/v1/tally/exports/{export_id}/download
POST /api/v1/tally/exports/{export_id}/retry
```

Export types:

```text
invoice_export
receipt_export
customer_ledger_export
gst_sales_export
```

Phase rule:

```text
Phase 1: basic export readiness
Phase 3: full Tally integration and full ledger/CN/DN exports
```

---

# 15. WhatsApp and Notification APIs

## 15.1 Template APIs

```text
GET    /api/v1/notification-templates
POST   /api/v1/notification-templates
GET    /api/v1/notification-templates/{template_id}
PATCH  /api/v1/notification-templates/{template_id}
DELETE /api/v1/notification-templates/{template_id}
```

---

## 15.2 Notification Log APIs

```text
GET  /api/v1/notification-logs
GET  /api/v1/notification-logs/{log_id}
POST /api/v1/notification-logs/{log_id}/retry
```

---

## 15.3 WhatsApp Send APIs

```text
POST /api/v1/whatsapp/send-template
POST /api/v1/whatsapp/send-document
POST /api/v1/whatsapp/webhook
GET  /api/v1/whatsapp/status/{message_id}
```

Required events:

```text
quotation_approved
order_confirmed
dispatch_started
challan_generated
invoice_generated
payment_reminder
subscription_alert
```

---

# 16. Approval APIs

Generic approval engine APIs:

```text
GET  /api/v1/approvals
POST /api/v1/approvals
GET  /api/v1/approvals/{approval_id}
POST /api/v1/approvals/{approval_id}/approve
POST /api/v1/approvals/{approval_id}/reject
POST /api/v1/approvals/{approval_id}/clarification
```

Approval types:

```text
credit_hold_release
negative_stock
quotation_discount
invoice_cancellation
stock_adjustment
mix_design_approval
```

---

# 17. Audit Log APIs

```text
GET /api/v1/audit-logs
GET /api/v1/audit-logs/{audit_id}
```

Filters:

```text
module_key
action_key
user_id
record_type
record_id
date_from
date_to
```

Audit logs must not be editable by normal users.

---

# 18. Offline Sync APIs

## 18.1 Device Registration

```text
POST /api/v1/sync/devices/register
GET  /api/v1/sync/devices
PATCH /api/v1/sync/devices/{device_id}
```

---

## 18.2 Initial Sync

```text
GET /api/v1/sync/bootstrap
```

Bootstrap must return:

- Plant settings
- User permissions
- Customers
- Sites
- Materials
- Vehicles
- Drivers
- Orders for allowed date range
- Number reservations
- Last sync token

---

## 18.3 Push Local Changes

```text
POST /api/v1/sync/push
```

Request:

```json
{
  "device_id": "uuid",
  "sync_token": "token",
  "changes": [
    {
      "entity_name": "delivery_challans",
      "operation": "create",
      "local_id": "local-uuid",
      "payload": {}
    }
  ]
}
```

Response:

```json
{
  "accepted": [],
  "failed": [],
  "conflicts": []
}
```

---

## 18.4 Pull Cloud Changes

```text
GET /api/v1/sync/pull?since_token=token
```

---

## 18.5 Sync Conflict APIs

```text
GET  /api/v1/sync/conflicts
GET  /api/v1/sync/conflicts/{conflict_id}
POST /api/v1/sync/conflicts/{conflict_id}/resolve
```

Resolution options:

```text
use_cloud
use_local
manual_merge
```

---

## 18.6 Offline Number Reservation APIs

```text
POST /api/v1/sync/number-reservations
GET  /api/v1/sync/number-reservations
```

Used for:

- Delivery challan numbers
- Batch ticket numbers
- Receipt numbers if allowed offline
- Weighbridge slip numbers

---

# 19. Integration APIs

## 19.1 Integration Provider APIs

```text
GET /api/v1/integration-providers
```

---

## 19.2 Tenant Integration APIs

```text
GET   /api/v1/integrations
POST  /api/v1/integrations
GET   /api/v1/integrations/{integration_id}
PATCH /api/v1/integrations/{integration_id}
POST  /api/v1/integrations/{integration_id}/test
GET   /api/v1/integrations/{integration_id}/logs
```

Integration types:

```text
batching_controller
weighbridge
gps
whatsapp
sms
email
payment_gateway
accounting
```

---

## 19.3 GPS APIs

Phase 2:

```text
GET  /api/v1/gps/vehicles/live
GET  /api/v1/gps/vehicles/{vehicle_id}/history
POST /api/v1/gps/webhook
POST /api/v1/gps/providers/{provider_id}/test
```

Must support:

- BharatBenz inbuilt GPS
- Other GPS providers
- Driver mobile GPS later

---

# 20. Language and Translation APIs

```text
GET /api/v1/languages
GET /api/v1/translations?language=ta
PUT /api/v1/users/me/language
```

Admin translation APIs:

```text
GET  /api/v1/admin/translation-keys
POST /api/v1/admin/translation-keys
PUT  /api/v1/admin/translations
```

Rules:

- English is default.
- Indian languages must be supported by architecture.
- UI labels must not be hardcoded.

---

# 21. Report APIs

## 21.1 Report Center

```text
GET /api/v1/reports
```

---

## 21.2 Sales Reports

```text
GET /api/v1/reports/sales/orders
GET /api/v1/reports/sales/quotations
GET /api/v1/reports/sales/customer-wise
GET /api/v1/reports/sales/grade-wise
```

---

## 21.3 Production Reports

```text
GET /api/v1/reports/production/daily
GET /api/v1/reports/production/plant-wise
GET /api/v1/reports/production/batch-tickets
GET /api/v1/reports/production/material-variance
```

---

## 21.4 Dispatch Reports

```text
GET /api/v1/reports/dispatch/daily
GET /api/v1/reports/dispatch/vehicle-wise
GET /api/v1/reports/dispatch/delayed
GET /api/v1/reports/dispatch/return-concrete
```

---

## 21.5 Inventory Reports

```text
GET /api/v1/reports/inventory/stock
GET /api/v1/reports/inventory/inward
GET /api/v1/reports/inventory/consumption
GET /api/v1/reports/inventory/low-stock
```

---

## 21.6 Finance Reports

```text
GET /api/v1/reports/finance/invoices
GET /api/v1/reports/finance/payments
GET /api/v1/reports/finance/outstanding
GET /api/v1/reports/finance/gst-sales
```

Phase rule:

```text
Phase 1: basic outstanding and GST sales report
Phase 3: full ledger, CN/DN, and full GST/Tally depth
```

---

## 21.7 Export Report APIs

Every report should support:

```text
?format=json
?format=excel
?format=pdf
```

Or:

```text
POST /api/v1/reports/{report_key}/export
```

---

# 22. Dashboard APIs

## 22.1 Owner Dashboard

```text
GET /api/v1/dashboards/owner
```

Must return:

- Today orders
- Today production
- Today dispatch
- Today billing
- Today collection
- Total outstanding
- Credit hold orders
- Low stock alerts
- Pending approvals
- Delayed deliveries
- Plant-wise performance

---

## 22.2 Plant Dashboard

```text
GET /api/v1/dashboards/plant
```

---

## 22.3 Sales Dashboard

```text
GET /api/v1/dashboards/sales
```

---

## 22.4 Dispatch Dashboard

```text
GET /api/v1/dashboards/dispatch
```

---

## 22.5 Accounts Dashboard

```text
GET /api/v1/dashboards/accounts
```

---

## 22.6 Super Admin Dashboard

```text
GET /api/v1/platform/dashboard
```

---

# 23. File and Document APIs

## 23.1 File Upload

```text
POST /api/v1/files/upload
```

Use for:

- Company logo
- Signature
- Delivery photo
- Receiver signature
- Vehicle documents
- Driver license
- QC attachments
- Invoice PDFs
- Challan PDFs

---

## 23.2 File Access

```text
GET /api/v1/files/{file_id}
DELETE /api/v1/files/{file_id}
```

Rules:

- File access must check tenant permission.
- Sensitive documents must use signed URLs.
- File deletion should be soft delete if referenced.

---

# 24. WebSocket Event Design

WebSocket namespace:

```text
/ws
```

Events:

```text
dispatch.updated
order.credit_hold
approval.created
approval.completed
stock.low
sync.failed
sync.conflict
whatsapp.status_updated
invoice.created
payment.received
```

Each event payload must include:

```json
{
  "tenant_id": "uuid",
  "plant_id": "uuid",
  "event": "dispatch.updated",
  "data": {}
}
```

Users must only receive events for their tenant and allowed plants.

---

# 25. API Security Requirements

## 25.1 Authentication

Use:

```text
JWT access token + refresh token
```

Admin users should support 2FA.

---

## 25.2 Authorization

Every API must check:

- Tenant
- Role
- Permission
- Plant access
- Module plan access
- Record ownership where required

---

## 25.3 Rate Limiting

Rate limits required for:

- Login
- Password reset
- WhatsApp sending
- Public webhooks
- File upload
- Sync push

---

## 25.4 Webhook Security

Webhook APIs must verify signatures.

Required for:

- WhatsApp webhooks
- Payment gateway webhooks
- GPS webhooks
- Future GST/e-invoice webhooks if used

---

# 26. API Error Codes

Standard error codes:

```text
AUTH_REQUIRED
INVALID_TOKEN
TENANT_SUSPENDED
SUBSCRIPTION_EXPIRED
MODULE_NOT_ENABLED
PERMISSION_DENIED
PLANT_ACCESS_DENIED
VALIDATION_ERROR
RECORD_NOT_FOUND
DUPLICATE_RECORD
VERSION_CONFLICT
CREDIT_LIMIT_EXCEEDED
NEGATIVE_STOCK_APPROVAL_REQUIRED
MIX_DESIGN_NOT_APPROVED
VEHICLE_NOT_AVAILABLE
INVOICE_ALREADY_EXISTS
SYNC_CONFLICT
INTEGRATION_FAILED
WHATSAPP_SEND_FAILED
```

---

# 27. Phase 1 API Scope

Phase 1 must include APIs for:

## SaaS

- Auth
- Tenants
- Plans
- Plan modules
- Tenant subscriptions
- SaaS billing foundation

## Setup

- Company
- Plants
- Users
- Roles
- Permissions
- Number series
- Settings

## Masters

- Customers
- Sites
- Materials
- UOMs
- HSN/tax rates
- Suppliers
- Transporters
- Banks
- Payment modes
- Concrete grades
- Mix designs
- Vehicles
- Drivers

## Sales and Orders

- Leads
- Quotations
- Rate contracts
- Orders
- Order items
- Credit check
- Credit hold approvals

## Production and Dispatch

- Production plans
- Batch queue
- Manual batch tickets
- Dispatches
- Delivery challans

## Inventory and Weighbridge

- Stock balances
- Stock transactions
- Material inward
- Manual weighbridge entry
- Negative stock approvals

## Billing and Payments

- GST invoices
- Invoice items
- E-invoice ready fields
- E-way bill ready fields
- Payments
- Basic outstanding

## Integrations

- WhatsApp API foundation
- Tally export-ready APIs
- Integration settings
- Integration logs

## Offline

- Device registration
- Bootstrap sync
- Push sync
- Pull sync
- Conflict handling
- Number reservations

## Control

- Approvals
- Audit logs
- Reports
- Dashboards
- Language/translation readiness

---

# 28. Phase 2 API Additions

Phase 2 should add:

- Driver app APIs
- Sales app APIs
- GPS tracking APIs
- Putzmeister/IDS direct integration APIs
- Multi-brand batching connector APIs
- Direct weighbridge APIs
- QC/lab APIs
- Purchase APIs
- Pump APIs
- Vehicle maintenance APIs
- Advanced WhatsApp automation APIs

---

# 29. Phase 3 API Additions

Phase 3 should add:

- Full customer ledger APIs
- Vendor ledger APIs
- Credit note APIs
- Debit note APIs
- Direct Tally integration APIs
- E-invoice direct API
- E-way bill direct API
- Payment gateway APIs
- Advanced GST reports
- Full SaaS subscription billing automation

---

# 30. Phase 4 API Additions

Phase 4 should add:

- Customer portal APIs
- Customer app APIs
- Customer order request APIs
- Customer invoice download APIs
- Customer QC certificate APIs
- Complaint APIs
- Payment link APIs

---

# 31. Phase 5 API Additions

Phase 5 should add:

- AI dispatch suggestion APIs
- AI material forecast APIs
- AI QC risk APIs
- AI collection priority APIs
- Predictive maintenance APIs
- Profit per m³ APIs
- Plant ranking APIs

---

# 32. API Acceptance Criteria

This API design is accepted when:

1. API versioning is defined.
2. Standard response format is defined.
3. Error format is defined.
4. Auth APIs are defined.
5. Tenant SaaS APIs are defined.
6. Setup APIs are defined.
7. User/role/permission APIs are defined.
8. Master APIs are defined.
9. Sales and quotation APIs are defined.
10. Rate contract APIs are defined.
11. Multi-grade order APIs are defined.
12. Credit hold APIs are defined.
13. Production APIs are defined.
14. Batch ticket APIs are defined.
15. Dispatch and challan APIs are defined.
16. Inventory and weighbridge APIs are defined.
17. Negative stock approval APIs are defined.
18. Invoice and payment APIs are defined.
19. E-invoice/e-way ready field APIs are defined.
20. Tally export APIs are defined.
21. WhatsApp APIs are defined.
22. Offline sync APIs are defined.
23. Report APIs are defined.
24. Dashboard APIs are defined.
25. Integration APIs are defined.
26. Language APIs are defined.
27. WebSocket events are defined.
28. Phase-wise API scope is separated.

---

# 33. Next Design Document

Next document to prepare:

**Design Document 8: Offline Sync Architecture**

This will define:

- Standalone plant app sync model
- Local database approach
- Sync queue
- Conflict detection
- Offline document numbering
- Sync retry
- Local backup
- Plant-level offline safety rules
