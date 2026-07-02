# RMC Plant SaaS Software
## Design Stage Document 6: Database Entity Design

## 1. Purpose of This Document

This document defines the database entity design for the RMC Plant SaaS software.

This is part of the technical design layer.

The database must support:

- Multi-tenant SaaS architecture
- Multiple RMC companies
- Multiple plants per tenant
- Role-based access
- Standalone plant app
- Offline sync
- RMC order-to-dispatch workflow
- Batch ticket records
- Inventory and weighbridge
- GST invoice and payment records
- Tally export readiness
- WhatsApp API logs
- Audit logs
- Future mobile apps
- Future integrations

This document is a design-level database plan, not final SQL migration code.

---

# 2. Database Design Principles

## 2.1 SaaS First

The system must be designed as SaaS from day one.

Every tenant-level business table must include:

```text
tenant_id
```

This ensures one tenant cannot access another tenant’s data.

Examples:

- customers
- plants
- orders
- dispatches
- delivery_challans
- invoices
- payments
- materials
- vehicles
- batch_tickets
- stock_transactions

---

## 2.2 Tenant Isolation Rule

The system must enforce tenant isolation at:

1. Application level
2. API level
3. Database query level
4. Report level
5. Export level
6. Offline sync level

No query should return tenant data without tenant filtering.

---

## 2.3 Common Columns

Most tables should include these common fields:

```text
id
tenant_id
created_at
updated_at
created_by
updated_by
deleted_at
is_active
```

Important transaction tables should also include:

```text
status
remarks
approved_by
approved_at
cancelled_by
cancelled_at
cancel_reason
```

---

## 2.4 ID Strategy

Recommended:

- Use UUID for primary keys.
- Use human-readable document numbers separately.

Example:

```text
id = UUID
order_no = ORD-2026-0001
invoice_no = INV-2026-0001
challan_no = DC-2026-0001
```

Reason:

- UUID works better for offline sync.
- Number series can be tenant-wise and plant-wise.
- Offline records can be created safely.

---

## 2.5 Offline Sync Design Impact

Tables that can be created or edited offline must include:

```text
local_id
sync_status
last_synced_at
source_device_id
version
conflict_status
```

Offline-created records must be traceable after syncing to cloud.

---

## 2.6 Phase Rule

Phase 1 database must be ready for future phases, but not all modules need full transaction depth in Phase 1.

Example:

- Phase 1: basic outstanding view
- Phase 3: full customer ledger with credit note/debit note

---

# 3. Database Module Groups

The database can be grouped into these areas:

1. SaaS platform tables
2. Tenant/company setup tables
3. User, role, and permission tables
4. Master data tables
5. Sales and quotation tables
6. Order and credit control tables
7. Production and batching tables
8. Dispatch and delivery challan tables
9. Inventory and weighbridge tables
10. Billing and payment tables
11. Tally export tables
12. WhatsApp and notification tables
13. Offline sync tables
14. Audit and approval tables
15. Report/helper views
16. Future phase tables

---

# 4. SaaS Platform Tables

## 4.1 tenants

Purpose: Stores each RMC company using the SaaS platform.

Important fields:

```text
id
tenant_code
tenant_name
legal_name
primary_contact_name
primary_contact_email
primary_contact_mobile
status
current_plan_id
trial_start_date
trial_end_date
subscription_start_date
subscription_end_date
billing_cycle
timezone
default_language
created_at
updated_at
```

Status values:

```text
trial
active
grace
suspended
cancelled
```

---

## 4.2 subscription_plans

Purpose: Stores SaaS subscription plans.

Important fields:

```text
id
plan_code
plan_name
description
billing_cycle
monthly_price
yearly_price
max_plants
max_users
max_storage_gb
is_active
created_at
updated_at
```

---

## 4.3 plan_modules

Purpose: Maps modules/features allowed in each plan.

Important fields:

```text
id
plan_id
module_key
is_enabled
limit_value
created_at
updated_at
```

Example module keys:

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
```

---

## 4.4 tenant_subscriptions

Purpose: Tracks each tenant’s subscription history.

Important fields:

```text
id
tenant_id
plan_id
start_date
end_date
billing_cycle
status
amount
discount_amount
tax_amount
total_amount
renewal_type
created_at
updated_at
```

---

## 4.5 saas_invoices

Purpose: SaaS platform invoices raised to tenants.

Important fields:

```text
id
tenant_id
subscription_id
invoice_no
invoice_date
due_date
taxable_amount
cgst_amount
sgst_amount
igst_amount
total_amount
payment_status
status
created_at
updated_at
```

---

## 4.6 saas_payments

Purpose: Tenant subscription payment records.

Important fields:

```text
id
tenant_id
saas_invoice_id
payment_date
amount
payment_mode
gateway_transaction_id
payment_status
remarks
created_at
updated_at
```

---

## 4.7 coupons

Purpose: SaaS coupon and discount management.

Important fields:

```text
id
coupon_code
description
discount_type
discount_value
valid_from
valid_to
max_usage
usage_count
is_active
created_at
updated_at
```

---

## 4.8 tenant_coupon_usage

Purpose: Tracks coupon usage per tenant.

Important fields:

```text
id
tenant_id
coupon_id
used_on
discount_amount
reference_invoice_id
created_at
```

---

# 5. Tenant / Company Setup Tables

## 5.1 companies

Purpose: Stores company details inside each tenant.

Important fields:

```text
id
tenant_id
company_name
legal_name
gstin
pan
cin
address_line_1
address_line_2
city
state
pincode
country
phone
email
website
logo_url
signature_url
default_language
created_at
updated_at
```

---

## 5.2 legal_entities

Purpose: Supports future multi-legal-entity tenants.

Important fields:

```text
id
tenant_id
company_id
legal_name
gstin
pan
address
state
is_default
status
created_at
updated_at
```

Phase:

```text
Phase 1: basic support
Phase 3: expanded finance use
```

---

## 5.3 plants

Purpose: Stores each RMC plant.

Important fields:

```text
id
tenant_id
company_id
plant_code
plant_name
address
city
state
pincode
latitude
longitude
capacity_per_hour
batching_controller_brand
batching_controller_type
weighbridge_available
plant_manager_user_id
challan_series_id
invoice_series_id
status
created_at
updated_at
```

Notes:

- Your current plant uses Putzmeister/IDS.
- SaaS must support other tenant controller brands also.

---

## 5.4 number_series

Purpose: Tenant-wise and plant-wise document numbering.

Important fields:

```text
id
tenant_id
plant_id
document_type
prefix
suffix
current_number
padding_length
financial_year
reset_frequency
is_active
created_at
updated_at
```

Document types:

```text
quotation
order
dispatch
delivery_challan
batch_ticket
invoice
receipt
weighbridge_slip
stock_adjustment
```

---

## 5.5 tenant_settings

Purpose: Tenant-specific system settings.

Important fields:

```text
id
tenant_id
setting_key
setting_value
data_type
created_at
updated_at
```

Examples:

```text
negative_stock_policy = approval_required
credit_block_stage = order_booking
default_language = en
whatsapp_enabled = true
einvoice_phase1_mode = ready_fields_only
ewaybill_phase1_mode = ready_fields_only
```

---

# 6. User, Role, and Permission Tables

## 6.1 users

Purpose: Stores user accounts.

Important fields:

```text
id
tenant_id
name
email
mobile
password_hash
user_type
default_language
status
last_login_at
is_2fa_enabled
created_at
updated_at
```

User types:

```text
super_admin
tenant_user
support_user
customer_user
driver_user
```

Note:

- Super Admin users may not require tenant_id.
- Tenant users must have tenant_id.

---

## 6.2 roles

Purpose: Stores tenant-specific and system roles.

Important fields:

```text
id
tenant_id
role_name
role_key
description
is_system_role
is_active
created_at
updated_at
```

Examples:

```text
company_owner
company_admin
plant_manager
sales_manager
dispatch_manager
batching_operator
accounts_manager
store_staff
qc_engineer
driver
```

---

## 6.3 permissions

Purpose: Stores permission definitions.

Important fields:

```text
id
module_key
permission_key
description
created_at
updated_at
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
```

---

## 6.4 role_permissions

Purpose: Maps roles to permissions.

Important fields:

```text
id
tenant_id
role_id
permission_id
is_allowed
created_at
updated_at
```

---

## 6.5 user_roles

Purpose: Maps users to roles.

Important fields:

```text
id
tenant_id
user_id
role_id
created_at
updated_at
```

---

## 6.6 user_plant_access

Purpose: Controls plant-wise user access.

Important fields:

```text
id
tenant_id
user_id
plant_id
access_level
created_at
updated_at
```

Access levels:

```text
view
operate
manage
admin
```

---

# 7. Master Data Tables

## 7.1 customers

Purpose: Customer master.

Important fields:

```text
id
tenant_id
customer_code
customer_name
company_name
customer_type
gstin
pan
billing_address
city
state
pincode
contact_person
mobile
email
credit_limit
credit_days
opening_balance
current_outstanding
blocked_status
blocked_reason
status
created_at
updated_at
```

---

## 7.2 customer_contacts

Purpose: Multiple contacts for each customer.

Important fields:

```text
id
tenant_id
customer_id
contact_name
designation
mobile
email
is_primary
created_at
updated_at
```

---

## 7.3 sites

Purpose: Customer project/site delivery locations.

Important fields:

```text
id
tenant_id
customer_id
site_code
site_name
address
city
state
pincode
latitude
longitude
site_contact_name
site_contact_mobile
structure_type
pump_required_default
road_access_condition
delivery_time_restriction
special_instructions
status
created_at
updated_at
```

---

## 7.4 materials

Purpose: Material master.

Important fields:

```text
id
tenant_id
material_code
material_name
category
uom
hsn_code
standard_rate
minimum_stock
reorder_level
storage_location
status
created_at
updated_at
```

Material categories:

```text
cement
fly_ash
ggbs
aggregate
sand
m_sand
water
admixture
diesel
spare
other
```

---

## 7.5 suppliers

Purpose: Supplier master.

Important fields:

```text
id
tenant_id
supplier_code
supplier_name
gstin
pan
address
state
contact_person
mobile
email
payment_terms
status
created_at
updated_at
```

---

## 7.6 concrete_grades

Purpose: Concrete grade master.

Important fields:

```text
id
tenant_id
grade_code
grade_name
strength_class
description
is_active
created_at
updated_at
```

Examples:

```text
M10
M15
M20
M25
M30
M35
M40
M50
```

---

## 7.7 mix_designs

Purpose: Mix design / recipe master.

Important fields:

```text
id
tenant_id
plant_id
grade_id
mix_code
version_no
slump_min
slump_max
cement_type
water_cement_ratio
pumpable
approval_status
approved_by
approved_at
is_active_version
created_at
updated_at
```

Approval status:

```text
draft
pending_approval
approved
rejected
inactive
```

---

## 7.8 mix_design_materials

Purpose: Material proportions for each mix design.

Important fields:

```text
id
tenant_id
mix_design_id
material_id
target_quantity
uom
tolerance_percentage
sequence_no
created_at
updated_at
```

---

## 7.9 vehicles

Purpose: Transit mixer and vehicle master.

Important fields:

```text
id
tenant_id
plant_id
vehicle_no
vehicle_type
capacity_m3
ownership_type
driver_id
gps_provider_id
gps_device_id
insurance_expiry
fitness_expiry
permit_expiry
pollution_expiry
status
created_at
updated_at
```

Status:

```text
available
assigned
in_trip
maintenance
inactive
blocked
```

---

## 7.10 drivers

Purpose: Driver master.

Important fields:

```text
id
tenant_id
driver_code
driver_name
mobile
license_no
license_expiry
assigned_vehicle_id
address
emergency_contact
status
created_at
updated_at
```

---

# 8. Sales and Quotation Tables

## 8.1 leads

Purpose: Sales lead management.

Important fields:

```text
id
tenant_id
lead_no
customer_name
contact_person
mobile
email
site_location
requirement_notes
lead_source
assigned_sales_user_id
lead_stage
next_followup_date
status
created_at
updated_at
```

---

## 8.2 quotations

Purpose: Customer quotation header.

Important fields:

```text
id
tenant_id
quotation_no
customer_id
site_id
quotation_date
valid_until
sales_user_id
approval_status
status
remarks
created_at
updated_at
```

---

## 8.3 quotation_items

Purpose: Grade-wise quotation rates.

Important fields:

```text
id
tenant_id
quotation_id
grade_id
estimated_quantity
rate_per_m3
transport_charge
pump_charge
waiting_charge
gst_applicable
remarks
created_at
updated_at
```

---

## 8.4 quotation_revisions

Purpose: Stores quotation version history.

Important fields:

```text
id
tenant_id
quotation_id
revision_no
changed_by
change_reason
snapshot_json
created_at
```

---

# 9. Order and Credit Control Tables

## 9.1 orders

Purpose: Customer order booking.

Important fields:

```text
id
tenant_id
order_no
customer_id
site_id
plant_id
quotation_id
grade_id
quantity_m3
required_datetime
slump_required
pump_required
delivery_interval_minutes
estimated_order_value
credit_status
order_status
special_instructions
created_at
updated_at
```

Order status:

```text
draft
credit_hold
confirmed
scheduled
in_production
partially_dispatched
completed
cancelled
on_hold
```

Credit status:

```text
not_checked
passed
failed
override_approved
```

---

## 9.2 credit_hold_requests

Purpose: Credit approval requests at order booking.

Important fields:

```text
id
tenant_id
order_id
customer_id
credit_limit
current_outstanding
overdue_amount
estimated_order_value
requested_by
request_reason
approval_status
approved_by
approved_at
approval_remarks
created_at
updated_at
```

Approval status:

```text
pending
approved
rejected
cancelled
```

---

## 9.3 order_status_history

Purpose: Track order status changes.

Important fields:

```text
id
tenant_id
order_id
old_status
new_status
changed_by
change_reason
created_at
```

---

# 10. Production and Batching Tables

## 10.1 production_plans

Purpose: Daily production planning.

Important fields:

```text
id
tenant_id
plant_id
plan_date
plan_no
status
created_by
created_at
updated_at
```

Status:

```text
draft
confirmed
in_progress
completed
cancelled
```

---

## 10.2 production_plan_items

Purpose: Planned order/load sequence.

Important fields:

```text
id
tenant_id
production_plan_id
order_id
sequence_no
planned_quantity_m3
planned_time
assigned_vehicle_id
assigned_driver_id
priority
status
created_at
updated_at
```

---

## 10.3 batch_queue

Purpose: Loads waiting for batching.

Important fields:

```text
id
tenant_id
plant_id
order_id
production_plan_item_id
vehicle_id
driver_id
grade_id
mix_design_id
planned_quantity_m3
queue_status
created_at
updated_at
```

Queue status:

```text
waiting
batching
completed
held
cancelled
```

---

## 10.4 batch_tickets

Purpose: Batch production record.

Important fields:

```text
id
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
created_at
updated_at
```

Source type:

```text
manual
csv_import
excel_import
controller_api
local_db_import
```

---

## 10.5 batch_ticket_materials

Purpose: Material target vs actual consumption.

Important fields:

```text
id
tenant_id
batch_ticket_id
material_id
target_quantity
actual_quantity
variance_quantity
variance_percentage
uom
created_at
updated_at
```

---

## 10.6 batching_connector_configs

Purpose: Per-plant batching controller integration config.

Important fields:

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

Controller examples:

```text
Putzmeister/IDS
Schwing Stetter
Macons
Apollo
Universal
Other
```

---

# 11. Dispatch and Delivery Tables

## 11.1 dispatches

Purpose: Dispatch header for each load/trip.

Important fields:

```text
id
tenant_id
dispatch_no
plant_id
order_id
batch_ticket_id
vehicle_id
driver_id
grade_id
quantity_m3
dispatch_status
dispatch_time
site_arrival_time
pour_start_time
pour_end_time
return_quantity_m3
delay_reason
created_at
updated_at
```

Dispatch status:

```text
waiting
under_batching
loaded
left_plant
reached_site
pouring
completed
returning
delayed
rejected
cancelled
```

---

## 11.2 delivery_challans

Purpose: Delivery challan / e-ticket record.

Important fields:

```text
id
tenant_id
challan_no
plant_id
dispatch_id
order_id
batch_ticket_id
customer_id
site_id
vehicle_id
driver_id
grade_id
quantity_m3
slump
dispatch_time
receiver_name
receiver_signature_url
delivery_photo_url
return_quantity_m3
invoice_status
challan_status
created_at
updated_at
```

Invoice status:

```text
not_invoiced
invoiced
cancelled
```

Challan status:

```text
draft
issued
delivered
cancelled
rejected
```

---

## 11.3 delivery_status_history

Purpose: Delivery/challan movement history.

Important fields:

```text
id
tenant_id
dispatch_id
challan_id
old_status
new_status
location_latitude
location_longitude
changed_by
created_at
```

---

# 12. Inventory and Weighbridge Tables

## 12.1 stock_balances

Purpose: Current material stock per plant.

Important fields:

```text
id
tenant_id
plant_id
material_id
current_quantity
reserved_quantity
available_quantity
average_rate
last_updated_at
```

---

## 12.2 stock_transactions

Purpose: Stock ledger.

Important fields:

```text
id
tenant_id
plant_id
material_id
transaction_type
reference_type
reference_id
in_quantity
out_quantity
balance_after
rate
amount
approval_status
remarks
created_by
created_at
```

Transaction types:

```text
opening
inward
batch_consumption
adjustment
transfer_in
transfer_out
wastage
negative_stock
```

---

## 12.3 material_inwards

Purpose: Material inward record.

Important fields:

```text
id
tenant_id
plant_id
supplier_id
material_id
vehicle_no
supplier_challan_no
weighbridge_entry_id
quantity_received
quantity_accepted
rate
amount
status
created_at
updated_at
```

---

## 12.4 weighbridge_entries

Purpose: Weighbridge transaction record.

Important fields:

```text
id
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
created_at
updated_at
```

Status:

```text
draft
completed
matched
mismatch
cancelled
```

---

## 12.5 negative_stock_requests

Purpose: Approval for allowing negative stock.

Important fields:

```text
id
tenant_id
plant_id
material_id
available_quantity
required_quantity
negative_quantity
reference_type
reference_id
requested_by
request_reason
approval_status
approved_by
approved_at
approval_remarks
created_at
updated_at
```

---

# 13. Billing and Payment Tables

## 13.1 invoices

Purpose: Customer GST invoice header.

Important fields:

```text
id
tenant_id
invoice_no
invoice_date
plant_id
customer_id
billing_address
place_of_supply
gstin
taxable_amount
cgst_amount
sgst_amount
igst_amount
round_off
total_amount
payment_status
invoice_status
created_at
updated_at
```

Payment status:

```text
unpaid
partially_paid
paid
overdue
cancelled
```

Invoice status:

```text
draft
issued
cancelled
```

---

## 13.2 invoice_items

Purpose: Invoice line items.

Important fields:

```text
id
tenant_id
invoice_id
challan_id
grade_id
description
quantity_m3
rate
taxable_amount
cgst_rate
cgst_amount
sgst_rate
sgst_amount
igst_rate
igst_amount
line_total
created_at
updated_at
```

---

## 13.3 invoice_challans

Purpose: Maps delivery challans to invoice.

Important fields:

```text
id
tenant_id
invoice_id
challan_id
created_at
```

---

## 13.4 invoice_einvoice_fields

Purpose: Phase 1 e-invoice-ready fields.

Important fields:

```text
id
tenant_id
invoice_id
irn
ack_number
ack_date
signed_qr_code
einvoice_status
einvoice_cancel_status
created_at
updated_at
```

Phase rule:

```text
Phase 1: store fields only
Phase 3: direct API integration
```

---

## 13.5 invoice_ewaybill_fields

Purpose: Phase 1 e-way bill-ready fields.

Important fields:

```text
id
tenant_id
invoice_id
eway_bill_no
eway_bill_date
valid_until
distance_km
transport_mode
vehicle_no
transporter_name
transporter_id
eway_status
eway_cancel_status
created_at
updated_at
```

Phase rule:

```text
Phase 1: store fields only
Phase 3: direct API integration
```

---

## 13.6 payments

Purpose: Customer receipt/payment record.

Important fields:

```text
id
tenant_id
receipt_no
customer_id
receipt_date
payment_mode
amount
bank_reference
is_advance
remarks
status
created_at
updated_at
```

---

## 13.7 payment_allocations

Purpose: Maps receipts to invoices.

Important fields:

```text
id
tenant_id
payment_id
invoice_id
allocated_amount
created_at
```

---

## 13.8 customer_outstanding_snapshots

Purpose: Phase 1 basic outstanding summary.

Important fields:

```text
id
tenant_id
customer_id
snapshot_date
opening_balance
invoice_amount
payment_amount
closing_outstanding
overdue_amount
created_at
```

Note:

```text
Phase 1: basic outstanding view
Phase 3: full ledger with CN/DN
```

---

# 14. Tally Export Tables

## 14.1 tally_export_batches

Purpose: Tracks each export run.

Important fields:

```text
id
tenant_id
export_type
date_from
date_to
plant_id
status
file_url
created_by
created_at
updated_at
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
Phase 1: Tally-ready export files
Phase 3: direct Tally integration
```

---

## 14.2 tally_export_items

Purpose: Individual records inside export batch.

Important fields:

```text
id
tenant_id
export_batch_id
reference_type
reference_id
export_status
error_message
created_at
updated_at
```

---

# 15. WhatsApp and Notification Tables

## 15.1 notification_templates

Purpose: Stores message templates.

Important fields:

```text
id
tenant_id
template_name
module_key
event_key
language_code
provider_template_id
template_body
variables_json
is_active
created_at
updated_at
```

---

## 15.2 notification_logs

Purpose: Logs all outgoing notifications.

Important fields:

```text
id
tenant_id
channel
recipient_name
recipient_mobile
recipient_email
module_key
event_key
template_id
reference_type
reference_id
message_status
provider_message_id
error_message
sent_at
delivered_at
created_at
```

Channels:

```text
whatsapp
sms
email
push
in_app
```

---

## 15.3 notification_rules

Purpose: Tenant notification trigger settings.

Important fields:

```text
id
tenant_id
event_key
channel
is_enabled
recipient_rule
created_at
updated_at
```

---

# 16. Offline Sync Tables

## 16.1 devices

Purpose: Registered plant/local devices.

Important fields:

```text
id
tenant_id
plant_id
device_name
device_type
device_identifier
last_seen_at
status
created_at
updated_at
```

Device types:

```text
standalone_plant_app
mobile_app
web_browser
```

---

## 16.2 sync_queue

Purpose: Stores pending offline sync records.

Important fields:

```text
id
tenant_id
plant_id
device_id
entity_name
local_id
cloud_id
operation
payload_json
sync_status
retry_count
last_error
created_at
updated_at
```

Operations:

```text
create
update
delete
```

Sync status:

```text
pending
synced
failed
conflict
```

---

## 16.3 sync_conflicts

Purpose: Tracks offline/cloud conflicts.

Important fields:

```text
id
tenant_id
plant_id
device_id
entity_name
local_id
cloud_id
local_payload_json
cloud_payload_json
conflict_reason
resolution_status
resolved_by
resolved_at
created_at
updated_at
```

---

## 16.4 local_number_reservations

Purpose: Prevent duplicate offline document numbers.

Important fields:

```text
id
tenant_id
plant_id
device_id
document_type
prefix
number_from
number_to
used_count
status
created_at
updated_at
```

---

# 17. Approval and Audit Tables

## 17.1 approval_requests

Purpose: Generic approval system.

Important fields:

```text
id
tenant_id
approval_type
reference_type
reference_id
requested_by
request_reason
approval_status
priority
created_at
updated_at
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

## 17.2 approval_actions

Purpose: Tracks approval decisions.

Important fields:

```text
id
tenant_id
approval_request_id
action
action_by
remarks
created_at
```

Actions:

```text
approved
rejected
clarification_requested
cancelled
```

---

## 17.3 audit_logs

Purpose: Full audit trail.

Important fields:

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

## 17.4 support_access_logs

Purpose: Tracks support staff access to tenant data.

Important fields:

```text
id
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

# 18. Integration Tables

## 18.1 integration_providers

Purpose: Stores available integration provider types.

Important fields:

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
```

---

## 18.2 tenant_integrations

Purpose: Tenant-level integration settings.

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

Important:

- Credentials must not be stored as plain text.
- Use encrypted storage or secret manager.

---

## 18.3 integration_logs

Purpose: Logs integration calls and errors.

Important fields:

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

---

# 19. Language and Translation Tables

## 19.1 languages

Purpose: Supported languages.

Important fields:

```text
id
language_code
language_name
native_name
is_active
created_at
updated_at
```

Examples:

```text
en
ta
hi
te
kn
ml
mr
gu
bn
pa
or
```

---

## 19.2 translation_keys

Purpose: Stores UI translation keys.

Important fields:

```text
id
key_name
module_key
default_text
created_at
updated_at
```

---

## 19.3 translations

Purpose: Stores translated values.

Important fields:

```text
id
translation_key_id
language_code
translated_text
created_at
updated_at
```

---

# 20. Future Phase Tables

The following are not required fully in Phase 1 but must be planned.

## 20.1 purchase_requests

Phase: 2

Purpose: Purchase request workflow.

---

## 20.2 purchase_orders

Phase: 2

Purpose: Purchase order workflow.

---

## 20.3 qc_tests

Phase: 2

Purpose: Slump, cube, material test records.

---

## 20.4 vehicle_maintenance

Phase: 2

Purpose: Vehicle service and breakdown records.

---

## 20.5 pump_trips

Phase: 2

Purpose: Pump allocation and billing.

---

## 20.6 customer_portal_users

Phase: 4

Purpose: Customer login users.

---

## 20.7 ai_insights

Phase: 5

Purpose: AI-generated dispatch, stock, QC, and collection recommendations.

---

# 21. Phase 1 Required Database Tables

Phase 1 must include these tables:

## SaaS

- tenants
- subscription_plans
- plan_modules
- tenant_subscriptions
- saas_invoices
- saas_payments
- coupons
- tenant_coupon_usage

## Setup

- companies
- legal_entities
- plants
- number_series
- tenant_settings

## Users

- users
- roles
- permissions
- role_permissions
- user_roles
- user_plant_access

## Masters

- customers
- customer_contacts
- sites
- materials
- suppliers
- concrete_grades
- mix_designs
- mix_design_materials
- vehicles
- drivers

## Sales and Orders

- leads
- quotations
- quotation_items
- quotation_revisions
- orders
- credit_hold_requests
- order_status_history

## Production and Dispatch

- production_plans
- production_plan_items
- batch_queue
- batch_tickets
- batch_ticket_materials
- dispatches
- delivery_challans
- delivery_status_history

## Inventory and Weighbridge

- stock_balances
- stock_transactions
- material_inwards
- weighbridge_entries
- negative_stock_requests

## Billing and Payment

- invoices
- invoice_items
- invoice_challans
- invoice_einvoice_fields
- invoice_ewaybill_fields
- payments
- payment_allocations
- customer_outstanding_snapshots

## Tally and WhatsApp

- tally_export_batches
- tally_export_items
- notification_templates
- notification_logs
- notification_rules

## Offline and Control

- devices
- sync_queue
- sync_conflicts
- local_number_reservations
- approval_requests
- approval_actions
- audit_logs
- support_access_logs

## Integration and Language

- integration_providers
- tenant_integrations
- integration_logs
- languages
- translation_keys
- translations

---

# 22. Important Database Relationships

## 22.1 Tenant Relationship

```text
tenants
  → companies
  → plants
  → users
  → customers
  → orders
  → invoices
```

---

## 22.2 Order Relationship

```text
customers
  → sites
  → quotations
  → orders
  → production_plans
  → batch_queue
  → batch_tickets
  → dispatches
  → delivery_challans
  → invoices
  → payments
```

---

## 22.3 Inventory Relationship

```text
materials
  → stock_balances
  → stock_transactions
  → material_inwards
  → batch_ticket_materials
  → negative_stock_requests
```

---

## 22.4 Billing Relationship

```text
delivery_challans
  → invoice_challans
  → invoices
  → invoice_items
  → payments
  → payment_allocations
```

---

## 22.5 Offline Relationship

```text
devices
  → sync_queue
  → sync_conflicts
  → local_number_reservations
```

---

# 23. Indexing Requirements

Important indexes:

```text
tenant_id
tenant_id + plant_id
tenant_id + customer_id
tenant_id + order_no
tenant_id + invoice_no
tenant_id + challan_no
tenant_id + vehicle_no
tenant_id + material_id
tenant_id + created_at
tenant_id + status
```

Unique constraints:

```text
tenant_id + order_no
tenant_id + invoice_no
tenant_id + challan_no
tenant_id + batch_ticket_no
tenant_id + receipt_no
tenant_id + customer_code
tenant_id + plant_code
tenant_id + vehicle_no
```

For plant-wise numbering:

```text
tenant_id + plant_id + document_type + document_no
```

---

# 24. Soft Delete Rule

Most master tables should use soft delete.

Use:

```text
deleted_at
deleted_by
```

Transaction tables should generally not be deleted.

Instead, use:

```text
cancelled
voided
reversed
inactive
```

Examples:

- Invoice should be cancelled, not deleted.
- Challan should be cancelled, not deleted.
- Payment should require reversal/approval.

---

# 25. Data Security Requirements

## 25.1 Sensitive Data

Sensitive fields must be protected:

- Passwords
- API credentials
- Payment gateway keys
- WhatsApp API tokens
- Tally integration credentials
- GPS credentials

Passwords must store only hash.

Integration secrets must use encrypted storage or secret manager.

---

## 25.2 Tenant Data Protection

Every tenant-level query must include tenant filter.

Reports and exports must also enforce tenant filter.

Support access must be audited.

---

# 26. Backup Requirements

The database must support:

- Full system backup
- Tenant-wise backup
- Plant-wise export
- Audit log preservation
- Offline local backup
- Restore testing

---

# 27. Database Acceptance Criteria

This database design is accepted when:

1. SaaS tenant tables are defined.
2. Tenant isolation rule is defined.
3. Company and plant tables are defined.
4. User, role, and permission tables are defined.
5. Customer and site tables are defined.
6. Material, grade, mix design, vehicle, and driver tables are defined.
7. Quotation and order tables are defined.
8. Credit hold table is defined.
9. Production and batching tables are defined.
10. Dispatch and challan tables are defined.
11. Inventory and weighbridge tables are defined.
12. Negative stock approval table is defined.
13. Invoice and payment tables are defined.
14. E-invoice/e-way ready fields are defined.
15. Tally export tables are defined.
16. WhatsApp notification tables are defined.
17. Offline sync tables are defined.
18. Audit and approval tables are defined.
19. Integration tables are defined.
20. Language/translation tables are defined.
21. Phase 1 required tables are clearly listed.
22. Future phase tables are noted.

---

# 28. Next Design Document

Next document to prepare:

**Design Document 7: API Design**

This will define the API module structure required for:

- Authentication
- Tenant management
- Subscription
- User and role management
- Masters
- Sales
- Orders
- Production
- Dispatch
- Inventory
- Billing
- Payments
- Tally export
- WhatsApp API
- Offline sync
- Audit logs
