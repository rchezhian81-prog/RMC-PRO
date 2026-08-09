# RMC Plant SaaS Software
## Design Stage Document 10: Integration Architecture

## 1. Purpose of This Document

This document defines the integration architecture for the RMC Plant SaaS software.

The system must support integrations with:

- Batching plant controllers
- Putzmeister / IDS batching controller
- Future multi-brand batching controllers
- Weighbridge
- BharatBenz inbuilt GPS
- Future multi-provider GPS
- WhatsApp Business API
- Tally export and future direct Tally integration
- Payment gateway
- Email and SMS providers
- E-invoice and e-way bill future API
- Printers and PDF generation
- File import/export
- Background integration logs and retry system

This document is part of the **Design Stage**.

---

# 2. Integration Design Goal

The integration design must be:

- SaaS-ready
- Tenant-wise configurable
- Plant-wise configurable where required
- Provider-based
- Secure
- Retryable
- Auditable
- Phase-wise expandable
- Not hardcoded to one vendor

The software must support your current plant setup but also support different tenants with different hardware and software.

Current known setup:

```text
Batching controller: Putzmeister / IDS
Weighbridge: Available
Truck GPS: BharatBenz inbuilt GPS
Accounting: Tally
WhatsApp: Direct API required
E-invoice/e-way bill: Phase 1 ready fields only, direct API in Phase 3
```

---

# 3. Integration Architecture Principle

## 3.1 Provider-Based Model

Every integration must use a provider-based model.

Do not hardcode one brand directly into business logic.

Example:

```text
Integration Type: batching_controller
Provider: Putzmeister / IDS
Plant: Plant A
Integration Method: file import / database / API
```

Another tenant may use:

```text
Integration Type: batching_controller
Provider: Schwing Stetter
Plant: Plant B
Integration Method: CSV import
```

---

## 3.2 Required Integration Tables

Use the tables from Design Doc 6:

```text
integration_providers
tenant_integrations
integration_logs
batching_connector_configs
notification_templates
notification_logs
tally_export_batches
tally_export_items
```

---

## 3.3 Integration Scope Levels

Integrations can be configured at different levels.

### Tenant-Level Integrations

Examples:

- WhatsApp API
- Tally export settings
- Email provider
- SMS provider
- Payment gateway
- SaaS billing payment settings

### Plant-Level Integrations

Examples:

- Batching controller
- Weighbridge
- GPS mapping
- Printer settings
- Local file import path

### Vehicle-Level Integrations

Examples:

- BharatBenz GPS device mapping
- Third-party GPS device ID
- Driver mobile GPS fallback

---

# 4. Integration Provider Registry

## 4.1 Purpose

The system must maintain a registry of supported integration providers.

Table:

```text
integration_providers
```

Fields:

```text
id
provider_key
provider_name
provider_type
description
is_active
created_at
updated_at
```

Provider types:

```text
batching_controller
weighbridge
gps
whatsapp
sms
email
payment_gateway
accounting
einvoice
ewaybill
printer
file_import
```

---

## 4.2 Example Providers

```text
putzmeister_ids
schwing_stetter
macons
apollo
universal_batching
manual_batching
generic_csv_import
generic_excel_import
generic_weighbridge_serial
bharatbenz_gps
generic_gps_api
whatsapp_cloud_api
tally_export
tally_direct
razorpay
cashfree
smtp_email
```

---

# 5. Tenant Integration Configuration

## 5.1 Purpose

Each tenant must configure integrations separately.

Table:

```text
tenant_integrations
```

Important fields:

```text
id
tenant_id
provider_id
plant_id
config_json
credentials_ref
is_active
created_at
updated_at
```

---

## 5.2 Credential Storage Rule

Credentials must never be stored as plain text.

Sensitive data includes:

- API keys
- Access tokens
- Passwords
- Webhook secrets
- Payment gateway keys
- WhatsApp tokens
- GPS provider credentials
- Tally connector credentials

Use:

```text
Encrypted database field
or
Secret manager
```

---

## 5.3 Integration Config Examples

### WhatsApp Config

```json
{
  "sender_number": "919999999999",
  "provider": "whatsapp_cloud_api",
  "default_language": "en",
  "retry_enabled": true
}
```

### Batching Controller Config

```json
{
  "controller_brand": "Putzmeister/IDS",
  "integration_method": "file_import",
  "file_format": "csv",
  "watch_folder": "C:/IDS/Export",
  "mapping_profile": "putzmeister_ids_v1"
}
```

### GPS Config

```json
{
  "provider": "bharatbenz_gps",
  "api_base_url": "provider-url",
  "vehicle_mapping_key": "vehicle_no"
}
```

---

# 6. Integration Log Design

Every integration activity must be logged.

Table:

```text
integration_logs
```

Fields:

```text
id
tenant_id
provider_id
reference_type
reference_id
request_summary
response_summary
status
error_message
created_at
```

Status values:

```text
pending
success
failed
retrying
cancelled
```

---

# 7. Integration Retry Design

## 7.1 Retryable Integrations

The following integrations must support retry:

- WhatsApp message sending
- Email sending
- SMS sending
- Tally export upload in future
- Payment gateway webhook processing
- GPS data polling
- Batch file import
- Weighbridge read
- E-invoice/e-way bill API in Phase 3

---

## 7.2 Retry Strategy

Recommended retry pattern:

```text
Retry 1: after 1 minute
Retry 2: after 5 minutes
Retry 3: after 15 minutes
Retry 4: after 30 minutes
Then mark failed and require manual retry
```

---

## 7.3 Integration Error Visibility

Each integration screen must show:

- Last successful sync
- Last failed sync
- Error reason
- Retry count
- Manual retry button
- Integration status
- Provider response summary

---

# 8. Batching Controller Integration

## 8.1 Purpose

Batching integration captures production data from batching plant controller/software.

The system must support your current controller:

```text
Putzmeister / IDS
```

But SaaS must support other tenant brands also.

---

## 8.2 Multi-Brand Batching Architecture

Batching integration must be plugin/connector-based.

Supported methods:

```text
Manual entry
CSV import
Excel import
File watcher
Local database read
API integration
OPC/PLC connector in future
Custom connector
```

---

## 8.3 Batching Connector Config Table

Use:

```text
batching_connector_configs
```

Fields:

```text
id
tenant_id
plant_id
controller_brand
controller_model
integration_type
file_path
api_endpoint
database_connection_ref
mapping_config_json
is_active
created_at
updated_at
```

---

## 8.4 Supported Batching Brands

The architecture must be ready for:

```text
Putzmeister / IDS
Schwing Stetter
Macons
Apollo
Universal
KYB Conmat
Meka
Liebherr
Other
Manual / Generic
```

Phase 1:

```text
Manual batch ticket entry
Putzmeister/IDS import-ready structure
Generic CSV/Excel import-ready design
```

Phase 2:

```text
Putzmeister/IDS direct integration
Multi-brand connector framework
```

---

## 8.5 Required Batch Data

Batch integration must capture:

```text
tenant_id
plant_id
batch_ticket_no
order_id
batch_queue_id
vehicle_id
driver_id
grade_id
mix_design_id
batch_quantity_m3
batch_start_time
batch_end_time
operator_user_id
source_type
import_source
sync_status
status
```

Material-wise data:

```text
material_id
target_quantity
actual_quantity
variance_quantity
variance_percentage
uom
```

---

## 8.6 Batch Data Mapping

Each tenant/plant must map batching controller fields to system fields.

Example mapping:

```json
{
  "ticket_no": "batch_ticket_no",
  "vehicle": "vehicle_no",
  "grade": "grade_code",
  "mix_code": "mix_code",
  "quantity": "batch_quantity_m3",
  "cement": "cement_actual_qty",
  "water": "water_actual_qty",
  "admixture": "admixture_actual_qty"
}
```

---

## 8.7 Batch Import Validation Rules

On import, system must validate:

- Tenant and plant
- Duplicate batch ticket number
- Existing order
- Existing vehicle
- Existing grade
- Approved mix design
- Quantity greater than zero
- Material mapping
- Batch date/time
- Material variance tolerance

---

## 8.8 Batch Import Error Handling

If import fails:

- Do not silently discard file.
- Save failed record.
- Show error reason.
- Allow user correction.
- Allow re-import.
- Audit import action.

Error examples:

```text
Unknown vehicle number
Unknown grade
Duplicate batch ticket
Mix design not approved
Material mapping missing
```

---

# 9. Weighbridge Integration

## 9.1 Purpose

Weighbridge integration captures material inward weight and supports stock update.

Your plant has a weighbridge now.

---

## 9.2 Phase Handling

Phase 1:

```text
Manual weighbridge entry
Weighbridge slip print
Material inward link
Stock update
```

Phase 2:

```text
Direct weighbridge integration
Auto gross/tare/net reading
Supplier challan matching
Mismatch alert
```

---

## 9.3 Weighbridge Integration Methods

Supported methods:

```text
Manual entry
Serial port read
TCP/IP read
CSV import
Excel import
Vendor API
Local database read
```

---

## 9.4 Required Weighbridge Data

```text
tenant_id
plant_id
slip_no
vehicle_no
supplier_id
material_id
gross_weight
tare_weight
net_weight
supplier_challan_no
entry_datetime
operator_user_id
status
remarks
```

---

## 9.5 Weighbridge Validation Rules

System must validate:

- Slip number uniqueness
- Vehicle number
- Supplier
- Material
- Gross weight > tare weight
- Net weight > 0
- Duplicate supplier challan warning
- Material inward linkage
- Mismatch tolerance

---

## 9.6 Weighbridge to Inventory Flow

```text
Weighbridge Entry
   ↓
Material Inward
   ↓
Quantity Accepted
   ↓
Stock Transaction
   ↓
Stock Balance Update
```

---

# 10. GPS Integration

## 10.1 Purpose

GPS integration tracks transit mixer movement and delivery status.

Current known GPS:

```text
BharatBenz truck inbuilt GPS
```

SaaS must support different GPS providers for different tenants.

---

## 10.2 GPS Provider Architecture

GPS integration must be provider-based.

Supported GPS sources:

```text
BharatBenz inbuilt GPS
Third-party GPS API
Driver mobile GPS
Manual dispatch status fallback
```

---

## 10.3 GPS Data Required

```text
tenant_id
plant_id
vehicle_id
vehicle_no
gps_provider_id
device_id
latitude
longitude
speed
ignition_status
recorded_at
trip_id
dispatch_id
```

---

## 10.4 GPS Events

GPS integration should support:

```text
vehicle_location_updated
vehicle_left_plant
vehicle_reached_site
vehicle_idle
route_deviation
trip_completed
```

---

## 10.5 Geofence Rules

The system should support geofence logic for:

- Plant location
- Customer site
- Waiting zone
- Return to plant

Geofence events:

```text
plant_exit
site_arrival
site_departure
plant_return
```

---

## 10.6 Phase Handling

Phase 1:

```text
GPS-ready vehicle configuration
Manual dispatch status
BharatBenz GPS configuration fields
```

Phase 2:

```text
BharatBenz GPS integration
Multi-provider GPS framework
Driver app GPS fallback
Live dispatch map
ETA calculation
```

---

# 11. WhatsApp API Integration

## 11.1 Purpose

The system must support direct WhatsApp API integration.

WhatsApp is required for:

- Quotation sharing
- Order confirmation
- Dispatch alert
- Delivery challan sharing
- Invoice sharing
- Payment reminder
- Subscription alert
- QC certificate sharing in later phase

---

## 11.2 WhatsApp Architecture

Use:

```text
notification_templates
notification_logs
notification_rules
tenant_integrations
integration_logs
background workers
```

---

## 11.3 WhatsApp Provider Support

Recommended providers:

```text
WhatsApp Cloud API
Approved WhatsApp Business API provider
```

Architecture must allow provider switching.

---

## 11.4 WhatsApp Template Management

Each tenant must configure templates.

Template fields:

```text
template_name
module_key
event_key
language_code
provider_template_id
template_body
variables_json
is_active
```

---

## 11.5 Required WhatsApp Events

Phase 1 events:

```text
quotation_approved
order_confirmed
credit_hold_created
dispatch_started
challan_generated
invoice_generated
payment_received
payment_reminder
subscription_alert
sync_failed_alert
```

Later phase events:

```text
vehicle_reached_site
qc_certificate_ready
complaint_update
driver_trip_assigned
customer_order_status
```

---

## 11.6 WhatsApp Message Flow

```text
Business event occurs
   ↓
Notification rule checks if WhatsApp is enabled
   ↓
Template is selected
   ↓
Variables are filled
   ↓
Message job is queued
   ↓
Worker sends message through provider
   ↓
Provider response is logged
   ↓
Delivery status webhook updates log
```

---

## 11.7 WhatsApp Offline Behavior

If standalone app is offline:

- WhatsApp messages are queued locally if triggered locally.
- Actual sending happens only after internet returns.
- Message should not be marked sent until provider confirms.
- Failed messages must be retryable.

---

# 12. Tally Integration

## 12.1 Purpose

The system must support Tally for accounting.

User preference:

```text
Tally
```

---

## 12.2 Phase Handling

Phase 1:

```text
Tally-ready export files
Invoice export
Receipt export
Basic customer outstanding export
Basic GST sales export
```

Phase 3:

```text
Direct Tally integration
Full customer ledger
Vendor ledger
Credit note
Debit note
GST sales voucher sync
Receipt voucher sync
```

---

## 12.3 Tally Export Data

Required export data:

```text
Customer ledger name
GSTIN
Invoice number
Invoice date
Plant / cost center
Taxable value
CGST
SGST
IGST
Round off
Total amount
Receipt amount
Payment mode
Voucher type
Narration
```

---

## 12.4 Tally Export Flow

```text
User selects export type
   ↓
User selects date range / plant
   ↓
System validates records
   ↓
Export batch is created
   ↓
Export file is generated
   ↓
User downloads file
   ↓
Records are marked exported
   ↓
Export history is stored
```

---

## 12.5 Tally Export Types

```text
invoice_export
receipt_export
customer_ledger_export
gst_sales_export
```

Phase rule:

```text
Phase 1: basic export readiness
Phase 3: full Tally integration with ledger depth and CN/DN
```

---

## 12.6 Tally Safety Rule

Official Tally export should be generated from cloud after sync completion.

Do not generate final official export from unsynced offline data.

---

# 13. Payment Gateway Integration

## 13.1 Purpose

Payment gateway is needed for:

- SaaS subscription billing
- Tenant subscription payments
- Future customer invoice payments

---

## 13.2 Phase Handling

Phase 1:

```text
Payment gateway foundation for SaaS billing
Manual payment recording allowed
Gateway settings foundation
Webhook log design
```

Phase 3:

```text
Full payment gateway integration
Auto receipt creation
Payment reconciliation
Customer payment links
```

---

## 13.3 Payment Gateway Providers

Architecture should support:

```text
Razorpay
Cashfree
PayU
CCAvenue
Other
```

---

## 13.4 Payment Gateway Flow

```text
Invoice/payment request created
   ↓
Payment link generated
   ↓
User pays
   ↓
Gateway webhook received
   ↓
Signature verified
   ↓
Payment status updated
   ↓
Receipt generated if applicable
   ↓
Audit/payment log stored
```

---

## 13.5 Webhook Security

Payment gateway webhooks must verify:

- Signature
- Timestamp if available
- Duplicate event ID
- Amount
- Reference ID
- Tenant ID or mapped payment request

---

# 14. Email Integration

## 14.1 Purpose

Email integration is required for:

- User invites
- Password reset
- Quotation sharing
- Invoice sharing
- SaaS billing
- Support notifications
- Reports

---

## 14.2 Email Providers

Support:

```text
SMTP
SendGrid
Amazon SES
Other provider
```

---

## 14.3 Email Logging

Every sent email must log:

```text
recipient
subject
template
reference_type
reference_id
status
sent_at
error_message
```

---

# 15. SMS Integration

## 15.1 Purpose

SMS may be used for:

- OTP
- Order confirmation
- Payment reminder
- Driver alert
- Critical system alert

---

## 15.2 SMS Provider Model

Use same provider-based model:

```text
SMS provider config per tenant/platform
Template-based sending
Message log
Retry support
```

---

# 16. E-Invoice Integration

## 16.1 Phase 1 Decision

Phase 1 includes:

```text
E-invoice-ready fields only
```

Direct API is not included in Phase 1.

---

## 16.2 Phase 1 Fields

System must store:

```text
IRN
Ack number
Ack date
Signed QR code
E-invoice status
Cancellation status
```

---

## 16.3 Phase 3 Direct API

Phase 3 should include:

```text
E-invoice generation
IRN generation
Signed QR code storage
E-invoice cancellation
Status check
API error log
Retry mechanism
```

---

## 16.4 E-Invoice Safety

Direct API must not be developed before:

- GST invoice flow is stable
- Tax calculation is tested
- Customer GSTIN validation is stable
- Line-level HSN/SAC is stable
- Cancellation/reversal rules are stable

---

# 17. E-Way Bill Integration

## 17.1 Phase 1 Decision

Phase 1 includes:

```text
E-way bill-ready fields only
```

Direct API is not included in Phase 1.

---

## 17.2 Phase 1 Fields

System must store:

```text
E-way bill number
E-way bill date
Validity
Distance
Transport mode
Vehicle number
Transporter name
Transporter ID
E-way bill status
Cancellation status
```

---

## 17.3 Phase 3 Direct API

Phase 3 should include:

```text
E-way bill generation
E-way bill cancellation
Update vehicle number if applicable
Status check
API error log
Retry mechanism
```

---

# 18. Printer and PDF Integration

## 18.1 Purpose

RMC plant requires printed and PDF documents.

Required documents:

- Quotation
- Order confirmation
- Batch ticket
- Delivery challan
- Weighbridge slip
- Invoice
- Receipt
- Stock report
- Daily production report

---

## 18.2 PDF Generation

PDF generation should be handled by backend/background worker.

Use:

```text
HTML template → PDF
```

Each PDF must be:

- Tenant-branded
- Language-ready
- Versioned
- Reproducible
- Stored in object storage if needed

---

## 18.3 Local Printing

Standalone plant app must support:

- Delivery challan print
- Batch ticket print
- Weighbridge slip print
- Daily report print

Offline printing must be available for locally generated documents.

---

# 19. File Import and Export Integration

## 19.1 File Imports

Supported imports:

- Customers
- Materials
- Vehicles
- Drivers
- Opening stock
- Batch tickets
- Weighbridge records
- Price/rate data

Supported formats:

```text
CSV
Excel
```

---

## 19.2 File Import Safety

Every import must support:

- Template download
- Field validation
- Preview before import
- Error file download
- Duplicate detection
- Import history
- Rollback if possible

---

## 19.3 File Exports

Supported exports:

- Reports
- Tally export
- Customer list
- Stock report
- Invoice list
- Dispatch report
- Audit log if permitted

Formats:

```text
Excel
CSV
PDF
```

---

# 20. Background Worker Integration

## 20.1 Worker Jobs

Use background workers for:

- WhatsApp sending
- Email sending
- SMS sending
- PDF generation
- Report export
- Tally export
- Batch import processing
- Weighbridge import processing
- GPS polling
- Payment webhook processing
- Sync processing
- Backup jobs

---

## 20.2 Worker Requirements

Workers must be:

- Tenant-aware
- Idempotent
- Retryable
- Logged
- Failure-visible
- Safe for duplicate events

---

# 21. Webhook Architecture

## 21.1 Webhook Sources

Webhooks may come from:

- WhatsApp provider
- Payment gateway
- GPS provider
- Future e-invoice/e-way system
- Future customer app events

---

## 21.2 Webhook Security

Webhook endpoints must verify:

- Signature
- Secret
- Timestamp
- Duplicate event ID
- Valid reference mapping

---

## 21.3 Webhook Logging

Every webhook must be logged with:

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

# 22. Integration Monitoring Dashboard

The system must provide integration monitoring.

## 22.1 Super Admin View

Shows:

- Platform-level provider health
- Failed jobs
- Payment gateway failures
- WhatsApp failures
- Queue backlog
- Tenant integration health summary

---

## 22.2 Tenant Admin View

Shows:

- WhatsApp status
- Tally export status
- Batching import status
- Weighbridge status
- GPS status
- Failed messages
- Failed exports
- Last successful sync

---

## 22.3 Plant View

Shows:

- Batching import status
- Weighbridge status
- Local app sync status
- Printer status if available
- Last imported batch ticket
- Last weighbridge entry

---

# 23. Integration Security

## 23.1 Secrets

Do not expose secrets to frontend.

Secrets include:

- API tokens
- Webhook secrets
- Gateway keys
- GPS passwords
- WhatsApp tokens
- Tally connector credentials

---

## 23.2 Access Control

Only authorized roles can manage integration settings:

- Super Admin
- Tenant Admin
- Company Owner
- Authorized IT/Admin role

Plant-level integration settings can be managed by:

- Plant Manager if permitted
- Tenant Admin
- Company Admin

---

## 23.3 Audit Logging

Audit log required for:

- Integration created
- Integration updated
- Integration disabled
- Credential changed
- Test connection run
- Failed sync retry
- Manual export
- Webhook failure override

---

# 24. Phase 1 Integration Scope

Phase 1 must include:

- Integration provider registry
- Tenant integration settings foundation
- Integration logs
- Manual batch ticket entry
- Putzmeister/IDS import-ready structure
- Generic CSV/Excel batch import-ready design
- Manual weighbridge entry
- BharatBenz GPS-ready vehicle configuration
- WhatsApp direct API foundation
- WhatsApp templates
- WhatsApp message logs
- Tally-ready export files
- Payment gateway foundation for SaaS billing
- Email foundation
- PDF generation
- Local printing support
- E-invoice-ready fields only
- E-way bill-ready fields only

---

# 25. Phase 2 Integration Scope

Phase 2 should include:

- Putzmeister/IDS direct batching integration
- Multi-brand batching connector framework
- Direct weighbridge integration
- BharatBenz GPS integration
- Multi-provider GPS framework
- Driver app GPS fallback
- Advanced WhatsApp automation
- QC attachment/document integration
- Purchase/vendor import support
- Vehicle maintenance document alerts

---

# 26. Phase 3 Integration Scope

Phase 3 should include:

- Full Tally direct integration
- Payment gateway live collection
- E-invoice direct API
- E-way bill direct API
- Credit note/debit note exports
- Full GST reports
- Full ledger export
- Bank/payment reconciliation if needed

---

# 27. Phase 4 Integration Scope

Phase 4 should include:

- Customer portal integrations
- Customer payment links
- Customer document download
- Customer app notification
- Complaint communication
- QC certificate sharing

---

# 28. Phase 5 Integration Scope

Phase 5 should include:

- AI model integration
- Predictive analytics pipeline
- Dispatch optimization engine
- Material forecast engine
- QC risk engine
- Collection priority engine

---

# 29. Integration Acceptance Criteria

This integration architecture is accepted when:

1. Provider-based integration model is defined.
2. Tenant-level integration configuration is defined.
3. Plant-level integration configuration is defined.
4. Integration logs are defined.
5. Retry rules are defined.
6. Batching controller integration is defined.
7. Putzmeister/IDS support is included.
8. Multi-brand batching connector design is included.
9. Weighbridge integration is defined.
10. GPS integration is defined.
11. BharatBenz GPS readiness is included.
12. WhatsApp API integration is defined.
13. Tally export/direct path is defined.
14. Payment gateway path is defined.
15. Email/SMS path is defined.
16. E-invoice Phase 1 and Phase 3 scope is defined.
17. E-way bill Phase 1 and Phase 3 scope is defined.
18. Printer/PDF integration is defined.
19. File import/export is defined.
20. Webhook security is defined.
21. Integration monitoring is defined.
22. Integration security and audit are defined.
23. Phase-wise integration scope is separated.

---

# 30. Next Design Document

Next document to prepare:

**Design Document 11: Security and Audit Design**

This will define:

- Authentication security
- Authorization model
- Tenant isolation security
- Role and permission security
- Plant access security
- Audit log strategy
- Support access security
- Sensitive credential protection
- API security
- Offline app security
- File access security
- Webhook security
- Compliance and backup controls
