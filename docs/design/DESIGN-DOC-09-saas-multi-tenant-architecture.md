# RMC Plant SaaS Software
## Design Stage Document 9: SaaS Multi-Tenant Architecture

## 1. Purpose of This Document

This document defines the SaaS multi-tenant architecture for the RMC Plant SaaS software.

The product must be built as a SaaS platform from day one, supporting many independent RMC companies on the same platform.

This document covers:

- Multi-tenant architecture model
- Tenant isolation
- Tenant resolution
- Shared application design
- Database tenancy model
- Tenant-aware APIs
- Subscription and module enforcement
- Super Admin architecture
- Support access model
- Tenant settings
- File storage isolation
- Cache and queue isolation
- Backup and export strategy
- Scaling strategy
- Recommended SaaS technical stack

---

# 2. SaaS Architecture Goal

The system must support many RMC companies, where each company is a separate tenant.

Example:

```text
Tenant 1: ABC Ready Mix Concrete
Tenant 2: XYZ RMC Pvt Ltd
Tenant 3: Sri Concrete Works
Tenant 4: Multi-plant RMC Group
```

Each tenant must have isolated:

- Users
- Plants
- Customers
- Orders
- Dispatches
- Batch tickets
- Delivery challans
- Inventory
- Invoices
- Payments
- Reports
- Settings
- Integrations
- Files
- Audit logs

One tenant must never see or affect another tenant’s data.

---

# 3. Recommended Multi-Tenant Model

## 3.1 Phase 1 Recommended Model

Use:

```text
Shared application + shared PostgreSQL database + tenant_id isolation
```

This means:

- One SaaS application serves all tenants.
- One main cloud database stores tenant data.
- Every tenant business table includes `tenant_id`.
- Every API request is filtered by tenant context.
- Row-level security or strict query middleware must enforce tenant separation.

This is the best Phase 1 model because it is:

- Faster to build
- Easier to operate
- Cost-effective
- SaaS-ready
- Easier to scale for many small and medium RMC tenants

---

## 3.2 Future Enterprise Option

For large enterprise tenants, support future upgrade to:

```text
Dedicated tenant database
```

This may be useful for:

- Very large RMC groups
- High-volume production tenants
- Enterprise security requirement
- Dedicated backup/restore requirement
- Custom integration-heavy tenants

Future supported models:

```text
Model A: Shared DB with tenant_id
Model B: Dedicated DB per enterprise tenant
Model C: Hybrid model
```

Phase 1 will implement Model A.

---

# 4. Core Architecture Overview

## 4.1 High-Level Architecture

```text
Users / Devices
   |
   |-- Web Browser
   |-- Standalone Plant App
   |-- Future Mobile Apps
   |
Load Balancer / API Gateway
   |
Web App / API Server
   |
Tenant Context Middleware
   |
Permission + Subscription Middleware
   |
Business Modules
   |
PostgreSQL Database
Redis Cache / Queue
Object Storage
Background Workers
Integration Services
```

---

## 4.2 Main System Components

### 1. Web Frontend

Used by:

- Super Admin
- Company Owner
- Tenant Admin
- Sales
- Dispatch
- Accounts
- Store
- QC
- Fleet
- Support users

Recommended technology:

```text
Next.js / React
```

---

### 2. Backend API

Used by:

- Web frontend
- Standalone plant app
- Future mobile apps
- Integration services

Recommended technology:

```text
NestJS / Node.js or FastAPI
```

Final selection can be made in the technical stack decision, but the architecture must support:

- REST APIs
- WebSocket events
- Background jobs
- Multi-tenant middleware
- Strong audit logging
- Offline sync APIs

---

### 3. Cloud Database

Recommended:

```text
PostgreSQL
```

Reason:

- Strong relational data support
- Good transaction handling
- JSONB support
- Indexing
- Row-level security support
- Good SaaS scalability

---

### 4. Local Plant Database

From Design Doc 8:

```text
SQLite for Phase 1 standalone plant app
```

Future enterprise option:

```text
Local PostgreSQL
```

---

### 5. Cache and Queue

Recommended:

```text
Redis
```

Used for:

- Session/cache support
- Background jobs
- Rate limiting
- Notification queue
- Sync processing queue
- WhatsApp message queue
- Report export queue

---

### 6. Object Storage

Used for:

- Company logos
- Signatures
- Delivery photos
- Receiver signatures
- Invoice PDFs
- Challan PDFs
- Vehicle documents
- Driver documents
- QC attachments
- Export files
- Backup files

Recommended storage model:

```text
S3-compatible object storage
```

Storage paths must be tenant-isolated.

Example:

```text
tenants/{tenant_id}/invoices/{invoice_id}.pdf
tenants/{tenant_id}/challans/{challan_id}.pdf
tenants/{tenant_id}/documents/vehicles/{vehicle_id}.pdf
```

---

# 5. Tenant Resolution Design

Every request must be resolved to the correct tenant.

## 5.1 Tenant Resolution Sources

Tenant can be resolved using:

1. Authenticated user token
2. Tenant subdomain
3. Tenant code in login
4. API key for integrations
5. Device registration for standalone app

---

## 5.2 Recommended Phase 1 Tenant Resolution

Use:

```text
JWT token + tenant_id claim
```

After login, the token must contain:

```text
user_id
tenant_id
role_id
plant_access
permissions
subscription_status
```

Super Admin users may not have normal `tenant_id`, unless they enter audited support mode.

---

## 5.3 Future Subdomain Support

Support tenant subdomains later:

```text
abc-rmc.appdomain.com
xyz-concrete.appdomain.com
```

Subdomain maps to tenant.

Table required:

```text
tenant_domains
```

Future fields:

```text
id
tenant_id
domain_name
domain_type
is_primary
verification_status
created_at
updated_at
```

---

# 6. Tenant Isolation Rules

## 6.1 Application-Level Isolation

Every service method must receive tenant context.

Example:

```text
tenant_id = current_user.tenant_id
```

All queries must filter by tenant.

Example:

```text
WHERE tenant_id = current_tenant_id
```

---

## 6.2 API-Level Isolation

APIs must never accept arbitrary tenant_id from normal tenant users.

Wrong design:

```text
GET /api/v1/orders?tenant_id=other-tenant
```

Correct design:

```text
GET /api/v1/orders
```

The backend must derive tenant_id from token/session.

Only Super Admin platform APIs may explicitly pass tenant_id.

---

## 6.3 Database-Level Isolation

Every tenant business table must include:

```text
tenant_id
```

Recommended:

- Foreign key to `tenants.id`
- Composite indexes with `tenant_id`
- Unique constraints scoped by tenant
- Optional PostgreSQL Row Level Security

Example unique constraint:

```text
tenant_id + invoice_no
tenant_id + order_no
tenant_id + challan_no
tenant_id + customer_code
tenant_id + vehicle_no
```

---

## 6.4 Report-Level Isolation

Reports must also enforce tenant filter.

Required rule:

```text
No report query should run without tenant_id condition.
```

Report exports must be tenant-scoped.

---

## 6.5 File-Level Isolation

Every file must belong to:

```text
tenant_id
```

File access must check:

- Tenant
- User permission
- Record access
- Signed URL expiry

---

## 6.6 Cache-Level Isolation

Cache keys must include tenant_id.

Example:

```text
tenant:{tenant_id}:dashboard:owner
tenant:{tenant_id}:permissions:user:{user_id}
tenant:{tenant_id}:stock:plant:{plant_id}
```

---

## 6.7 Queue-Level Isolation

Background jobs must include tenant_id.

Example job payload:

```json
{
  "tenant_id": "uuid",
  "job_type": "send_invoice_whatsapp",
  "reference_id": "invoice_uuid"
}
```

---

# 7. Tenant Context Middleware

## 7.1 Middleware Responsibility

Tenant context middleware must:

1. Read authenticated user.
2. Resolve tenant.
3. Check tenant status.
4. Check subscription status.
5. Attach tenant context to request.
6. Prevent cross-tenant access.

---

## 7.2 Tenant Status Checks

Tenant status values:

```text
trial
active
grace
suspended
cancelled
```

Rules:

- trial: allow enabled modules until trial expiry.
- active: allow normal operation.
- grace: allow limited operation and show warning.
- suspended: block tenant user login/transactions.
- cancelled: block all tenant operations except billing/support.

---

## 7.3 Middleware Output

Request context should include:

```text
tenant_id
user_id
roles
permissions
plant_ids
plan_id
enabled_modules
subscription_status
language
```

---

# 8. Subscription and Module Enforcement

## 8.1 Subscription Enforcement

Every tenant API request must check:

- Is tenant active?
- Is subscription valid?
- Is tenant within grace period?
- Is requested module enabled?
- Has usage limit been exceeded?

---

## 8.2 Plan Limit Enforcement

Plan limits may include:

- Number of plants
- Number of users
- Storage usage
- Enabled modules
- Mobile app access
- WhatsApp message limit
- Integration access
- Report export limits

---

## 8.3 Module Enforcement

Each module should have a module key.

Examples:

```text
orders
dispatch
billing
inventory
weighbridge
batching_integration
gps
driver_app
customer_portal
tally_export
whatsapp_api
offline_sync
```

If module is disabled:

API must return:

```text
MODULE_NOT_ENABLED
```

---

## 8.4 Usage Enforcement

Examples:

If plan allows 1 plant and tenant tries to create 2nd plant:

```text
PLAN_LIMIT_EXCEEDED
```

If plan allows 10 users and tenant tries to create 11th user:

```text
PLAN_LIMIT_EXCEEDED
```

---

# 9. Super Admin Architecture

## 9.1 Super Admin Responsibilities

Super Admin manages:

- Tenants
- Plans
- Modules
- Subscriptions
- SaaS invoices
- Payments
- Coupons
- Support access
- Global settings
- System health
- Audit logs

---

## 9.2 Super Admin Data Access Rule

Super Admin should not freely browse tenant operational data by default.

To access tenant data for support:

1. Support mode must be requested.
2. Reason must be entered.
3. Access must be time-bound.
4. Access must be audit logged.
5. Tenant Admin/Owner approval should be supported where required.

---

## 9.3 Platform Tables

Platform-level tables may not require tenant_id.

Examples:

```text
tenants
subscription_plans
plan_modules
coupons
platform_users
global_modules
integration_providers
```

Tenant-level tables must include tenant_id.

---

# 10. Support Access Model

## 10.1 Purpose

Support staff may need temporary access to tenant data to fix issues.

Support access must be controlled.

---

## 10.2 Support Access Flow

1. Tenant raises support issue or Super Admin creates support request.
2. Support user requests access.
3. Tenant Owner/Admin or Super Admin approves.
4. Support user enters support mode.
5. Every support action is logged.
6. Access expires automatically.

---

## 10.3 Support Access Log

Use table:

```text
support_access_logs
```

Must record:

```text
tenant_id
support_user_id
access_reason
access_start_at
access_end_at
approved_by
status
created_at
updated_at
```

---

## 10.4 Support Access Restrictions

Support user should not be allowed to:

- Export financial reports unless approved.
- Delete or cancel transactions unless explicitly permitted.
- Change subscription billing without platform permission.
- Access tenant secrets directly.

---

# 11. Tenant Settings Architecture

## 11.1 Tenant Settings

Tenant-specific settings must be stored in:

```text
tenant_settings
```

Examples:

```text
credit_block_stage = order_booking
negative_stock_policy = approval_required
default_language = en
whatsapp_enabled = true
einvoice_phase1_mode = ready_fields_only
ewaybill_phase1_mode = ready_fields_only
offline_cache_days = 7
offline_login_validity_days = 3
```

---

## 11.2 Plant-Level Settings

Some settings must be plant-specific.

Examples:

- Batching controller brand
- Weighbridge availability
- Number series
- Local device settings
- Plant capacity
- Printer settings
- Sync configuration

These can be stored in:

```text
plants
tenant_integrations
number_series
device_settings
```

---

# 12. Multi-Plant Architecture

A tenant can have one or many plants.

## 12.1 Plant Isolation Inside Tenant

Users may access:

- All plants
- Selected plants
- One plant only

Use:

```text
user_plant_access
```

---

## 12.2 Plant Filter Rule

All operational screens must support plant filter:

```text
All Plants
Plant A
Plant B
Plant C
```

If user has access to one plant only, show that plant by default.

---

## 12.3 Plant-Level Data

Plant-scoped tables include:

- production_plans
- batch_queue
- batch_tickets
- dispatches
- delivery_challans
- stock_balances
- stock_transactions
- material_inwards
- weighbridge_entries
- vehicles
- local_number_reservations
- devices

---

# 13. Authentication Architecture

## 13.1 Recommended Authentication

Use:

```text
JWT access token + refresh token
```

Access token should be short-lived.

Refresh token should be securely stored and revocable.

---

## 13.2 Token Claims

Access token should include:

```text
user_id
tenant_id
user_type
role_ids
plant_ids
language
token_version
```

Do not store sensitive credentials in token.

---

## 13.3 Login Types

Supported login users:

- Super Admin
- Tenant user
- Support user
- Driver user in Phase 2
- Customer user in Phase 4

---

## 13.4 Tenant Login Rules

If tenant is suspended:

- Tenant users cannot log in.
- Owner/Admin may be redirected to subscription renewal page if allowed.
- Super Admin can still view tenant from platform side.

---

# 14. Authorization Architecture

## 14.1 Permission Model

Use:

```text
roles
permissions
role_permissions
user_roles
user_plant_access
```

---

## 14.2 Authorization Check

Every protected API must check:

1. Authentication
2. Tenant status
3. Subscription status
4. Module enabled
5. Permission
6. Plant access
7. Record belongs to tenant

---

## 14.3 Permission Examples

```text
orders.view
orders.create
orders.edit
orders.cancel
credit_hold.approve
negative_stock.approve
invoice.create
invoice.cancel
dispatch.update_status
batch_ticket.create
stock.adjust
```

---

# 15. Database Architecture

## 15.1 Cloud Database

Use:

```text
PostgreSQL
```

Phase 1 model:

```text
Shared database with tenant_id
```

---

## 15.2 Tenant-Aware Tables

Every tenant business table must include:

```text
tenant_id
```

Examples:

- customers
- sites
- orders
- order_items
- dispatches
- invoices
- payments
- materials
- vehicles
- stock_transactions

---

## 15.3 PostgreSQL Row-Level Security

Recommended for stronger protection:

```text
PostgreSQL Row Level Security
```

RLS can enforce:

```text
tenant_id = current_setting('app.current_tenant_id')
```

Even if a developer misses a tenant filter, RLS can reduce risk.

---

## 15.4 Migration Rule

All migrations must be SaaS-safe.

Migration rules:

- Never create tenant business table without tenant_id.
- Never add global unique constraint for tenant-specific document numbers.
- Use tenant-scoped unique constraints.
- Add indexes with tenant_id.
- Avoid destructive migrations without backup.
- Use additive migrations where possible.

---

# 16. Caching Architecture

Use Redis for cache.

## 16.1 Cache Use Cases

- User permission cache
- Tenant settings cache
- Plan/module cache
- Dashboard summary cache
- Report temporary cache
- Rate limiting
- Session/token blacklist
- Sync status cache

---

## 16.2 Cache Key Rule

Every tenant-level cache key must include tenant_id.

Example:

```text
tenant:{tenant_id}:settings
tenant:{tenant_id}:user:{user_id}:permissions
tenant:{tenant_id}:plant:{plant_id}:stock-summary
```

---

## 16.3 Cache Invalidation

Invalidate cache when:

- User role changes
- Permission changes
- Tenant plan changes
- Module access changes
- Tenant settings change
- Plant settings change
- Stock changes
- Order/dispatch changes

---

# 17. Background Job Architecture

Use background workers for long-running tasks.

## 17.1 Job Types

- WhatsApp message sending
- Email sending
- Report export
- PDF generation
- Tally export generation
- Sync processing
- Subscription renewal reminders
- Low stock alerts
- Backup jobs
- Integration polling
- Webhook processing

---

## 17.2 Job Payload Rule

Every tenant-level job must include tenant_id.

Example:

```json
{
  "tenant_id": "uuid",
  "plant_id": "uuid",
  "job_type": "generate_invoice_pdf",
  "reference_id": "invoice_id"
}
```

---

## 17.3 Job Safety

Jobs must be:

- Idempotent
- Retryable
- Logged
- Tenant-aware
- Permission-safe where relevant

---

# 18. File Storage Architecture

## 18.1 File Storage Structure

Recommended structure:

```text
tenants/{tenant_id}/company/logo/
tenants/{tenant_id}/invoices/
tenants/{tenant_id}/challans/
tenants/{tenant_id}/delivery-proof/
tenants/{tenant_id}/vehicle-documents/
tenants/{tenant_id}/driver-documents/
tenants/{tenant_id}/exports/
tenants/{tenant_id}/backups/
```

---

## 18.2 File Access Rule

A user can access a file only if:

- User belongs to same tenant.
- User has required permission.
- File reference belongs to accessible record.
- Plant access is valid if plant-specific.

---

## 18.3 Signed URL

Sensitive files should be accessed through signed URLs.

Signed URL expiry:

```text
5 to 15 minutes
```

---

# 19. Integration Architecture

Tenant integrations must be configurable per tenant and sometimes per plant.

Use:

```text
integration_providers
tenant_integrations
integration_logs
```

---

## 19.1 Integration Types

Supported:

- Batching controller
- Weighbridge
- GPS
- WhatsApp
- SMS
- Email
- Payment gateway
- Accounting/Tally
- Future GST/e-invoice/e-way bill API

---

## 19.2 Credentials Rule

Integration credentials must not be stored as plain text.

Use:

```text
Encrypted database field
or
Secret manager
```

---

## 19.3 Tenant-Level Integrations

Examples:

- WhatsApp API credentials
- Tally export settings
- Payment gateway settings
- Email/SMS provider

---

## 19.4 Plant-Level Integrations

Examples:

- Batching controller
- Weighbridge
- GPS vehicle mapping
- Local file import path
- Printer settings

---

# 20. Offline Sync and SaaS Architecture

Offline sync must respect tenant and plant boundaries.

## 20.1 Device Registration

Every standalone plant app device must belong to:

```text
tenant_id
plant_id
device_id
```

---

## 20.2 Sync Bootstrap

Bootstrap sync must only download:

- Data for tenant
- Data for assigned plant
- Data allowed by user permissions
- Data within allowed cache window

---

## 20.3 Sync Security

Sync APIs must verify:

- Device is registered
- Tenant is active
- User has plant access
- Device belongs to tenant/plant
- Subscription allows offline sync module if plan-based

---

# 21. WebSocket Tenant Isolation

WebSocket events must be tenant-scoped.

Event payload:

```json
{
  "tenant_id": "uuid",
  "plant_id": "uuid",
  "event": "dispatch.updated",
  "data": {}
}
```

Users should only receive:

- Events from their tenant
- Events from plants they can access
- Events from enabled modules

---

# 22. SaaS Billing Architecture

## 22.1 Subscription Flow

1. Super Admin creates tenant.
2. Assigns plan.
3. Trial starts or subscription starts.
4. Tenant uses enabled modules.
5. Subscription invoice is generated.
6. Tenant pays.
7. Plan renews.
8. If unpaid, tenant enters grace/suspended status.

---

## 22.2 SaaS Billing Tables

Use:

- tenants
- subscription_plans
- plan_modules
- tenant_subscriptions
- saas_invoices
- saas_payments
- coupons
- tenant_coupon_usage

---

## 22.3 SaaS Billing Enforcement

If tenant subscription expires:

Options:

```text
grace mode
read-only mode
suspended mode
```

Recommended:

- Grace period: allow usage with warning.
- After grace: block new transactions.
- Still allow admin to view billing and pay renewal.

---

# 23. Tenant Backup and Export Strategy

## 23.1 Backup Types

Required:

- Full platform backup
- Tenant-wise backup
- Plant-wise export
- Offline local backup
- Pre-migration backup

---

## 23.2 Tenant-Wise Backup

Tenant backup should include:

- Tenant data
- Company settings
- Plants
- Users
- Customers
- Orders
- Dispatches
- Invoices
- Payments
- Files
- Audit logs
- Integration settings excluding secrets or using secure export method

---

## 23.3 Restore Strategy

Restore must support:

- Full system restore
- Tenant-level restore in future
- Point-in-time recovery if cloud provider supports it
- Local app restore from backup

---

# 24. Observability and Monitoring

The SaaS platform must include monitoring.

## 24.1 Required Logs

- API logs
- Error logs
- Audit logs
- Integration logs
- Sync logs
- Job logs
- Payment logs
- WhatsApp logs
- Support access logs

---

## 24.2 Health Checks

Health checks required for:

- API server
- Database
- Redis
- Background workers
- Object storage
- Sync service
- WhatsApp provider
- Payment gateway
- Integration services

---

## 24.3 Alerts

Alerts should trigger for:

- API failure spike
- Database errors
- Sync failures
- Queue backlog
- Payment webhook failure
- WhatsApp API failure
- Tenant storage limit exceeded
- Subscription renewal failure
- Backup failure

---

# 25. Scaling Architecture

## 25.1 Horizontal Scaling

The application must support horizontal scaling.

Stateless backend servers should allow:

```text
multiple API instances behind load balancer
```

---

## 25.2 Database Scaling

Phase 1:

```text
Single managed PostgreSQL with proper indexes
```

Future:

```text
Read replicas
Partitioning by tenant/date
Dedicated tenant database for enterprise
```

---

## 25.3 Worker Scaling

Background workers should be scalable by job type.

Examples:

- Notification workers
- Report workers
- Sync workers
- Integration workers
- PDF workers

---

# 26. Recommended Technical Stack

This is the recommended advanced SaaS stack.

## 26.1 Frontend

```text
Next.js / React
TypeScript
Responsive web UI
i18n-ready frontend
```

---

## 26.2 Backend

Recommended:

```text
NestJS with TypeScript
```

Reason:

- Strong modular architecture
- Good for SaaS APIs
- Good WebSocket support
- Good background job ecosystem
- Works well with TypeScript frontend

Alternative:

```text
FastAPI with Python
```

Either is possible, but the recommended stack for this product is:

```text
Next.js + NestJS + PostgreSQL + Redis + SQLite local app
```

---

## 26.3 Database

Cloud:

```text
PostgreSQL
```

Standalone plant app:

```text
SQLite in Phase 1
Local PostgreSQL optional for enterprise later
```

---

## 26.4 Queue / Cache

```text
Redis
```

---

## 26.5 Object Storage

```text
S3-compatible object storage
```

---

## 26.6 Deployment

Recommended:

```text
Docker containers
Nginx / Load Balancer
Managed PostgreSQL
Managed Redis where possible
CI/CD pipeline
```

Future:

```text
Kubernetes for scale
```

---

# 27. Phase 1 SaaS Architecture Scope

Phase 1 must include:

- Shared SaaS application
- Shared PostgreSQL database with tenant_id
- Tenant context middleware
- Subscription/plan foundation
- Module enforcement foundation
- Super Admin tenant management
- Tenant setup
- Role/permission enforcement
- Plant access control
- Tenant-aware APIs
- Tenant-aware reports
- Tenant-aware file storage
- Basic support access logs
- Offline sync tenant/plant/device enforcement
- WhatsApp API foundation
- Tally export-ready foundation
- Language-ready architecture

---

# 28. Phase 2 SaaS Architecture Enhancements

Phase 2 should add:

- Driver app tenant/device security
- Sales app tenant/device security
- GPS provider tenant configuration
- Direct batching connector framework
- Direct weighbridge integration
- Advanced approval workflows
- Advanced QC/lab module
- Mobile push notifications

---

# 29. Phase 3 SaaS Architecture Enhancements

Phase 3 should add:

- Full SaaS subscription billing automation
- Direct Tally integration
- Payment gateway integration
- E-invoice API integration
- E-way bill API integration
- Full ledger architecture
- Credit note/debit note support
- Stronger finance audit controls

---

# 30. Phase 4 SaaS Architecture Enhancements

Phase 4 should add:

- Customer portal tenant isolation
- Customer user accounts
- Customer document access
- Customer order request
- Customer payment links
- Complaint module
- Customer app security

---

# 31. Phase 5 SaaS Architecture Enhancements

Phase 5 should add:

- AI services
- Predictive analytics
- Profitability engine
- Material forecasting engine
- Dispatch optimization engine
- QC risk model
- Collection priority model

---

# 32. SaaS Architecture Acceptance Criteria

This SaaS architecture is accepted when:

1. Multi-tenant model is defined.
2. Shared application model is defined.
3. Shared PostgreSQL with tenant_id strategy is defined.
4. Future dedicated database option is defined.
5. Tenant resolution is defined.
6. Tenant isolation rules are defined.
7. Tenant context middleware is defined.
8. Subscription enforcement is defined.
9. Module enforcement is defined.
10. Super Admin architecture is defined.
11. Support access model is defined.
12. Tenant settings architecture is defined.
13. Multi-plant architecture is defined.
14. Authentication architecture is defined.
15. Authorization architecture is defined.
16. Database tenancy rules are defined.
17. Cache isolation is defined.
18. Background job isolation is defined.
19. File storage isolation is defined.
20. Integration tenancy is defined.
21. Offline sync tenancy is defined.
22. WebSocket tenant isolation is defined.
23. SaaS billing architecture is defined.
24. Backup/export strategy is defined.
25. Monitoring and scaling are defined.
26. Recommended technical stack is defined.
27. Phase-wise SaaS architecture scope is separated.

---

# 33. Next Design Document

Next document to prepare:

**Design Document 10: Integration Architecture**

This will define:

- Batching controller integration
- Putzmeister/IDS support
- Multi-brand batching connector model
- Weighbridge integration
- BharatBenz GPS and multi-provider GPS model
- WhatsApp API integration
- Tally export/direct integration path
- Payment gateway integration
- E-invoice/e-way bill future integration
- Integration logs and retry model
