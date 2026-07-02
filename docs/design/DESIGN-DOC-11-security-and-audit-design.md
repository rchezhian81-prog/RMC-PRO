# RMC Plant SaaS Software
## Design Stage Document 11: Security and Audit Design

## 1. Purpose of This Document

This document defines the security and audit design for the RMC Plant SaaS software.

The system is a multi-tenant SaaS platform for many RMC companies, so security must protect:

- Tenant data
- User accounts
- Plant operations
- Customer data
- Financial data
- GST invoice data
- Batch and dispatch records
- Inventory records
- Integration credentials
- Offline local plant data
- Files and documents
- Audit trail

This document covers:

- Authentication security
- Authorization and role-based access
- Tenant isolation security
- Plant access control
- SaaS subscription enforcement
- API security
- Offline app security
- Local database protection
- File and document security
- Integration credential protection
- Webhook security
- Audit log strategy
- Support access security
- Approval security
- Backup and recovery controls
- Security monitoring
- Incident handling
- Phase-wise security scope

---

# 2. Security Design Goal

The system must ensure:

1. One tenant cannot access another tenant’s data.
2. Users can only access allowed modules.
3. Users can only access allowed plants.
4. Sensitive actions are permission-controlled.
5. Critical changes are audit logged.
6. Offline plant app is secure.
7. Integration credentials are protected.
8. Financial and GST records cannot be silently modified.
9. Support access is controlled and logged.
10. All important system activity is traceable.

---

# 3. Security Architecture Overview

Recommended stack from Design Doc 9:

```text
Frontend: Next.js / React / TypeScript
Backend: NestJS / TypeScript
Cloud Database: PostgreSQL
Local Plant DB: SQLite in Phase 1
Cache / Queue: Redis
Object Storage: S3-compatible storage
Deployment: Docker + Nginx / Load Balancer
```

Security must be enforced at:

```text
Frontend UI
Backend API
Middleware
Database
File storage
Cache
Queue
Offline sync
Integrations
Reports
Exports
```

---

# 4. Authentication Security

## 4.1 Login Model

Use:

```text
JWT access token + refresh token
```

Access token:

- Short-lived
- Used for API requests
- Contains user and tenant context

Refresh token:

- Longer-lived
- Revocable
- Stored securely
- Rotated when refreshed

---

## 4.2 Login Identifiers

Users can log in using:

- Email
- Mobile number
- User ID if configured

Tenant users must be linked to a valid tenant.

---

## 4.3 Token Claims

JWT access token should include:

```text
user_id
tenant_id
user_type
role_ids
plant_ids
language
token_version
issued_at
expiry
```

Do not store sensitive data in token.

Do not store:

- Password
- API keys
- Payment credentials
- WhatsApp token
- Tally credentials
- GPS credentials

---

## 4.4 Password Security

Password requirements:

- Minimum length configurable
- Strong password recommended
- Password stored only as hash
- Never store plain text password
- Password reset token must expire
- Password reset must be audit logged

Recommended hashing:

```text
bcrypt or argon2
```

---

## 4.5 Login Protection

Required protections:

- Rate limit login attempts
- Lock account temporarily after repeated failed attempts
- Record failed login attempts
- Record device/IP
- Show generic error message
- Do not reveal whether email/mobile exists

Error example:

```text
Invalid login credentials
```

Do not show:

```text
User does not exist
```

---

## 4.6 Two-Factor Authentication

Phase 1:

```text
2FA-ready architecture
```

Recommended for:

- Super Admin
- Company Owner
- Company Admin
- Accounts Manager
- Support Staff

Phase 2/3:

```text
Enable OTP / authenticator app based 2FA
```

---

## 4.7 Session Management

System must support:

- Logout
- Logout from all devices
- Token revocation
- Session timeout
- Refresh token rotation
- Device/session list

Recommended session timeout:

```text
Web idle timeout: configurable
Admin idle timeout: shorter than normal users
Offline app session: maximum 3 days without online validation
```

---

# 5. Authorization Security

## 5.1 Permission Model

Use the role and permission tables from Design Doc 6:

```text
users
roles
permissions
role_permissions
user_roles
user_plant_access
```

---

## 5.2 Authorization Layers

Every protected request must check:

1. User authenticated
2. Tenant active
3. Subscription valid
4. Module enabled
5. User has permission
6. User has plant access
7. Record belongs to same tenant
8. Record belongs to allowed plant if plant-scoped

---

## 5.3 Permission Format

Permission keys should follow:

```text
module.action
```

Examples:

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
settings.manage
```

---

## 5.4 Role Examples

System roles:

```text
super_admin
company_owner
company_admin
plant_manager
sales_manager
sales_executive
dispatch_manager
batching_operator
store_staff
qc_engineer
accounts_manager
fleet_manager
driver
support_staff
auditor
```

---

## 5.5 Least Privilege Rule

Every role must receive only the minimum permissions needed.

Examples:

- Batching operator should not access billing.
- Driver should not access customer ledger.
- Sales executive should not approve credit hold unless permitted.
- Store staff should not cancel invoice.
- Support staff should not access tenant data without support mode.

---

# 6. Tenant Isolation Security

## 6.1 Core Rule

One tenant must never access another tenant’s data.

Tenant isolation must be enforced at:

- API
- Service layer
- Database query
- Reports
- Exports
- Files
- Cache
- Queue
- WebSocket
- Offline sync

---

## 6.2 Tenant ID Rule

Every tenant business table must include:

```text
tenant_id
```

Every tenant query must include:

```text
WHERE tenant_id = current_tenant_id
```

---

## 6.3 API Tenant Rule

Tenant users must not pass arbitrary tenant_id in normal APIs.

Wrong:

```text
GET /api/v1/orders?tenant_id=other-tenant
```

Correct:

```text
GET /api/v1/orders
```

Backend must derive tenant_id from authenticated token.

Only Super Admin platform APIs can access tenant IDs explicitly.

---

## 6.4 PostgreSQL Row-Level Security

Recommended defense-in-depth:

```text
PostgreSQL Row-Level Security
```

RLS policy example:

```text
tenant_id = current_setting('app.current_tenant_id')
```

This helps protect data even if a developer forgets tenant filtering.

---

## 6.5 Tenant-Scoped Unique Constraints

Document numbers must be unique per tenant or tenant+plant.

Examples:

```text
tenant_id + order_no
tenant_id + invoice_no
tenant_id + challan_no
tenant_id + batch_ticket_no
tenant_id + receipt_no
tenant_id + customer_code
tenant_id + vehicle_no
```

For plant-wise numbers:

```text
tenant_id + plant_id + document_type + document_no
```

---

# 7. Plant Access Security

## 7.1 Plant Access Rule

Users may access:

- All plants
- Selected plants
- One plant only

Use:

```text
user_plant_access
```

---

## 7.2 Plant-Scoped APIs

Plant-scoped data must check plant access.

Examples:

- production_plans
- dispatches
- delivery_challans
- batch_tickets
- stock_transactions
- weighbridge_entries
- vehicles
- plant reports

---

## 7.3 Plant Filter Security

Frontend plant filters must not be trusted.

Even if user changes plant_id manually in API request, backend must verify plant access.

If unauthorized:

```text
PLANT_ACCESS_DENIED
```

---

# 8. SaaS Subscription Security

## 8.1 Subscription Enforcement

Every tenant request must check:

- Tenant status
- Subscription status
- Plan validity
- Enabled modules
- Usage limits

Tenant statuses:

```text
trial
active
grace
suspended
cancelled
```

---

## 8.2 Suspended Tenant Behavior

If tenant is suspended:

- Normal users cannot create transactions.
- Admin may be allowed to access billing/renewal page.
- Reports may be read-only if configured.
- Super Admin can manage tenant from platform portal.

---

## 8.3 Module Access

If module is disabled by plan:

```text
MODULE_NOT_ENABLED
```

Examples:

- driver_app
- customer_portal
- gps
- batching_integration
- tally_export
- whatsapp_api

---

# 9. API Security

## 9.1 API Authentication

All private APIs must require valid JWT.

Public APIs should be minimal and protected.

Public or semi-public APIs:

- Login
- Forgot password
- Reset password
- Webhooks
- File signed URL access
- Future customer payment callback

---

## 9.2 Rate Limiting

Rate limiting required for:

- Login
- Password reset
- OTP
- WhatsApp sending
- Payment gateway webhooks
- GPS webhooks
- File uploads
- Sync push
- Report exports

---

## 9.3 Idempotency

Critical APIs must support idempotency.

Required header:

```text
Idempotency-Key
```

Required for:

- Orders
- Delivery challans
- Invoices
- Receipts
- Batch tickets
- Sync push
- Payment callbacks
- WhatsApp message triggers

---

## 9.4 Input Validation

All API inputs must be validated.

Validation required for:

- Required fields
- Data type
- Number range
- Date range
- GSTIN format
- Email/mobile format
- Quantity greater than zero
- Tax rate validity
- Tenant and plant access
- Duplicate document numbers

---

## 9.5 API Error Codes

Use standard error codes from Doc 7.

Important examples:

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
SYNC_CONFLICT
INTEGRATION_FAILED
```

---

# 10. Offline App Security

## 10.1 Offline Login

When offline:

- Only cached users can log in.
- User permissions must be cached securely.
- Offline login must expire after configured period.
- Deactivated user is blocked after next sync.

Recommended Phase 1:

```text
Offline login valid for maximum 3 days without online validation
```

---

## 10.2 Local Database Protection

Local SQLite database must be protected.

Required:

- Local database encryption where possible
- No plain text password
- No plain text API secrets
- Device registration required
- Local audit log
- User permission checks
- Local backup protection

---

## 10.3 Offline Permission Enforcement

Offline app must still enforce:

- Role permissions
- Plant access
- Allowed offline actions
- Restricted offline actions

Offline restricted examples:

- Tenant setup
- Subscription changes
- User permission changes
- Cloud-only approvals
- Final Tally export
- Direct e-invoice/e-way bill API

---

## 10.4 Device Security

Each standalone plant app must register as a device.

Device record must include:

```text
tenant_id
plant_id
device_id
device_name
last_seen_at
status
app_version
```

Admin must be able to:

- Activate device
- Deactivate device
- Revoke sync access
- View sync logs
- Force logout

---

# 11. File and Document Security

## 11.1 File Storage Rule

Every file must be tenant-scoped.

Storage path example:

```text
tenants/{tenant_id}/invoices/{invoice_id}.pdf
tenants/{tenant_id}/challans/{challan_id}.pdf
tenants/{tenant_id}/delivery-proof/{challan_id}/photo.jpg
```

---

## 11.2 File Access Rule

Before serving file, system must check:

- User is authenticated
- User belongs to tenant
- User has permission
- User has plant access if plant-scoped
- File belongs to accessible record

---

## 11.3 Signed URLs

Sensitive files should use signed URLs.

Recommended expiry:

```text
5 to 15 minutes
```

---

## 11.4 Upload Security

File uploads must validate:

- File type
- File size
- Malware scan if available
- Tenant ownership
- Storage path
- Permission

Allowed document examples:

- PDF
- JPG
- PNG
- XLSX/CSV for imports

---

# 12. Integration Credential Security

## 12.1 Secrets Rule

Never store secrets as plain text.

Sensitive secrets:

- WhatsApp API token
- Payment gateway key
- GPS API credentials
- Tally connector credentials
- Email SMTP password
- SMS gateway token
- Webhook secrets

Use:

```text
Secret manager
or encrypted database field
```

---

## 12.2 Frontend Restriction

Secrets must never be sent to frontend.

Frontend can show:

```text
Configured / Not configured
Last tested
Last success
Last failure
```

But not raw token/password.

---

## 12.3 Credential Rotation

System should support:

- Update credential
- Test connection
- Disable integration
- Audit credential change
- Revoke old credential

---

# 13. Webhook Security

## 13.1 Webhook Sources

Webhooks may come from:

- WhatsApp provider
- Payment gateway
- GPS provider
- Future e-invoice/e-way bill provider
- Future customer app/payment link

---

## 13.2 Webhook Verification

Every webhook must verify:

- Signature
- Secret
- Timestamp if available
- Duplicate event ID
- Provider identity
- Reference mapping

---

## 13.3 Webhook Idempotency

Duplicate webhook events must not create duplicate records.

Example:

- Payment webhook should not create two receipts.
- WhatsApp delivery webhook should not create duplicate logs.
- GPS webhook should not duplicate same event.

---

## 13.4 Webhook Logging

Every webhook must be logged:

```text
provider
event_type
reference_id
raw_payload
verification_status
processing_status
error_message
created_at
```

---

# 14. Audit Log Strategy

## 14.1 Audit Goal

Every important action must be traceable.

Audit should answer:

- Who did it?
- When?
- From which device/IP?
- What changed?
- What was old value?
- What is new value?
- Why was it changed?
- Was it approved?

---

## 14.2 Audit Log Table

Use:

```text
audit_logs
```

Fields:

```text
id
tenant_id
user_id
module_key
action_key
record_type
record_id
old_value_json
new_value_json
ip_address
device_info
reason
created_at
```

---

## 14.3 Mandatory Audit Areas

Audit logs are mandatory for:

### SaaS / Tenant

- Tenant created
- Tenant suspended
- Tenant reactivated
- Plan changed
- Module access changed
- SaaS invoice cancelled
- Support access granted

### User / Role

- User created
- User deactivated
- Password reset
- Role changed
- Permission changed
- Plant access changed

### Customer / Credit

- Customer created
- Customer blocked/unblocked
- Credit limit changed
- Credit hold created
- Credit hold approved/rejected

### Sales

- Quotation created
- Quotation revised
- Rate changed
- Discount approved
- Quotation approved/rejected

### Orders

- Order created
- Order confirmed
- Order put on hold
- Order cancelled
- Order released from credit hold

### Production / Batch

- Mix design created
- Mix design approved
- Mix design version changed
- Batch ticket created
- Batch ticket corrected
- Manual batch override

### Dispatch

- Vehicle assigned
- Challan generated
- Dispatch status changed
- Load rejected
- Return quantity recorded
- Challan cancelled

### Inventory

- Material inward
- Stock adjustment
- Negative stock request
- Negative stock approval
- Batch consumption
- Weighbridge mismatch

### Billing / Payment

- Invoice created
- Invoice cancelled
- Receipt created
- Receipt edited/cancelled
- E-invoice ready field updated
- E-way bill ready field updated

### Integration

- Integration configured
- Credential changed
- Test connection run
- WhatsApp failed/retried
- Tally export generated
- Batch import failed/retried

### Offline Sync

- Device registered
- Offline transaction created
- Sync failed
- Sync conflict created
- Conflict resolved
- Number reservation generated

---

## 14.4 Audit Log Immutability

Audit logs must not be editable by normal users.

Audit logs should not be deleted through normal UI.

Retention should be configurable, but recommended:

```text
Minimum 7 years for financial/security audit logs where applicable
```

---

# 15. Approval Security

## 15.1 Approval Engine

Use generic approval system:

```text
approval_requests
approval_actions
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

## 15.2 Approval Rules

Approvals must check:

- User permission
- Tenant
- Plant access
- Approval type
- Amount/impact limit if configured
- Request status
- Duplicate approval prevention

---

## 15.3 Approval Audit

Every approval action must log:

```text
approved/rejected by
date/time
remarks
old status
new status
business impact
```

---

# 16. Support Access Security

## 16.1 Support Access Principle

Support users must not freely browse tenant data.

Support access must be:

- Requested
- Approved
- Time-limited
- Permission-limited
- Fully audit logged

---

## 16.2 Support Access Flow

1. Support request is created.
2. Support user requests tenant access.
3. Tenant Owner/Admin or Super Admin approves.
4. Support session starts.
5. All actions are logged.
6. Session expires automatically.

---

## 16.3 Support Restrictions

Support user should not:

- Export financial data unless approved.
- Change credentials.
- Delete/cancel transactions unless explicitly permitted.
- Access integration secrets.
- Change subscription billing without platform permission.

---

# 17. Report and Export Security

## 17.1 Report Access

Reports must check:

- Tenant
- Role permission
- Plant access
- Module access
- Subscription plan

---

## 17.2 Export Access

Exports must be permission-controlled.

Sensitive exports:

- Customer ledger
- Outstanding
- Invoice report
- GST sales report
- Audit logs
- User list
- Tally export

---

## 17.3 Export Audit

Every export must be audit logged.

Audit data:

```text
report_name
filters_used
export_format
exported_by
exported_at
record_count
file_id
```

---

# 18. Financial Record Security

## 18.1 Invoice Security

Invoice should not be deleted.

Allowed actions:

```text
draft
issue
cancel with approval
```

Invoice cancellation must require:

- Permission
- Reason
- Approval if configured
- Audit log

---

## 18.2 Payment Security

Payments/receipts should not be silently edited.

Allowed:

- Create receipt
- Allocate receipt
- Cancel/reverse receipt with approval
- Audit all changes

---

## 18.3 Phase Rule

Phase 1:

```text
Basic invoice, receipt, and outstanding view
```

Phase 3:

```text
Full ledger, credit note, debit note, GST depth, direct Tally sync
```

---

# 19. Data Backup and Recovery Security

## 19.1 Backup Requirements

System must support:

- Full database backup
- Tenant-wise backup
- File storage backup
- Offline local backup
- Pre-migration backup
- Backup health check

---

## 19.2 Backup Security

Backups must be:

- Encrypted where possible
- Access-controlled
- Stored securely
- Retained by policy
- Tested periodically

---

## 19.3 Restore Security

Restore actions must be:

- Admin-only
- Approved if tenant data is affected
- Audit logged
- Tested in non-production where possible

---

# 20. Monitoring and Security Alerts

## 20.1 Security Events to Monitor

Monitor:

- Repeated failed logins
- Login from unusual device/location
- Tenant isolation violation attempt
- Permission denied spikes
- API rate limit hits
- Suspicious export activity
- Support access usage
- Integration credential changes
- Webhook verification failures
- Sync conflict spikes

---

## 20.2 Alerts

Alerts should be generated for:

- Super Admin login failure spike
- Tenant suspended but API usage attempted
- Many failed payment webhooks
- WhatsApp token failure
- GPS webhook failure
- Offline device not synced for long time
- Backup failure
- Integration credential test failed
- Audit log write failure

---

# 21. Security Testing Requirements

## 21.1 Required Tests

Before production, test:

- Authentication
- Role permissions
- Plant access
- Tenant isolation
- Subscription enforcement
- Module enforcement
- File access
- Report export access
- Offline sync authorization
- Webhook signature verification
- Support access audit
- Invoice cancellation approval
- Negative stock approval
- Credit hold approval

---

## 21.2 Tenant Isolation Tests

Mandatory test cases:

1. Tenant A user cannot access Tenant B customer.
2. Tenant A user cannot open Tenant B invoice file.
3. Tenant A user cannot query Tenant B order by ID.
4. Tenant A export does not contain Tenant B data.
5. WebSocket event for Tenant B is not received by Tenant A.
6. Offline sync device from Tenant A cannot push Tenant B data.

---

# 22. Incident Handling

## 22.1 Security Incident Examples

- Unauthorized data access
- Credential leak
- Tenant isolation issue
- Suspicious export
- Payment webhook abuse
- Compromised support account
- Offline device stolen/lost
- Malware upload attempt

---

## 22.2 Incident Response Flow

1. Detect issue.
2. Log incident.
3. Disable affected account/device/integration if needed.
4. Preserve logs.
5. Investigate scope.
6. Notify affected tenant if required.
7. Patch issue.
8. Rotate credentials if needed.
9. Document corrective action.

---

# 23. Phase 1 Security Scope

Phase 1 must include:

- JWT authentication
- Refresh token
- Password hashing
- Role and permission enforcement
- Tenant isolation
- Plant access control
- Subscription/module foundation
- API validation
- Rate limiting for login and critical APIs
- Audit logs for critical actions
- Approval audit
- Support access log foundation
- Secure file access foundation
- Integration credential encryption foundation
- Offline device registration
- Offline login expiry rule
- Sync authorization
- Webhook signature-ready structure
- Export permission controls
- Backup foundation

---

# 24. Phase 2 Security Enhancements

Phase 2 should add:

- Driver app security
- Sales app security
- GPS webhook security
- Direct batching integration security
- Direct weighbridge integration security
- Advanced approval limits
- Mobile device management
- Stronger notification security
- More detailed security alerts

---

# 25. Phase 3 Security Enhancements

Phase 3 should add:

- 2FA enforcement for admin/finance users
- Payment gateway webhook verification
- Direct Tally credential security
- E-invoice/e-way bill API credential security
- Credit note/debit note security
- Full ledger audit depth
- Advanced GST compliance audit logs

---

# 26. Phase 4 Security Enhancements

Phase 4 should add:

- Customer portal authentication
- Customer document access rules
- Customer payment link security
- Customer complaint privacy
- Customer user audit logs

---

# 27. Phase 5 Security Enhancements

Phase 5 should add:

- AI data access controls
- AI recommendation audit
- AI model input/output logging
- Sensitive data masking for AI
- AI decision explainability logs

---

# 28. Security and Audit Acceptance Criteria

This security and audit design is accepted when:

1. Authentication security is defined.
2. Password security is defined.
3. Token security is defined.
4. Authorization model is defined.
5. Role and permission security is defined.
6. Tenant isolation security is defined.
7. Plant access security is defined.
8. Subscription/module enforcement is defined.
9. API security rules are defined.
10. Offline app security is defined.
11. Local database protection is defined.
12. File security is defined.
13. Integration credential security is defined.
14. Webhook security is defined.
15. Audit log strategy is defined.
16. Mandatory audit areas are defined.
17. Approval security is defined.
18. Support access security is defined.
19. Report/export security is defined.
20. Financial record security is defined.
21. Backup security is defined.
22. Monitoring and alerting are defined.
23. Security testing requirements are defined.
24. Incident handling is defined.
25. Phase-wise security scope is separated.

---

# 29. Next Design Document

Next document to prepare:

**Design Document 12: Report / PDF Design and Final Design Sign-Off Checklist**

This will define:

- Report categories
- Report layouts
- PDF/print formats
- Quotation PDF
- Delivery challan PDF
- Batch ticket print
- Weighbridge slip
- GST invoice PDF
- Receipt PDF
- Report export rules
- Final design-stage sign-off checklist
