# RMC Plant SaaS Software
## Design Stage Document 5: Screen-by-Screen Layout Design

## 1. Purpose of This Document

This document defines the layout structure for the main screens of the RMC Plant SaaS software.

This is not final visual UI design.  
This is the functional screen layout design that developers and UI designers must follow before development.

This document covers:

- Global application layout
- Super Admin screens
- Tenant Admin screens
- Owner dashboard screens
- Sales screens
- Order screens
- Production screens
- Dispatch screens
- Batching screens
- Inventory screens
- Weighbridge screens
- Billing screens
- Payment screens
- Tally export screens
- WhatsApp API screens
- Reports screens
- Approval screens
- Audit screens
- Standalone plant app screens
- Offline sync screens

---

# 2. Global Layout Design

## 2.1 Web App Shell

Every web screen must follow this structure:

```text
+-------------------------------------------------------------+
| Top Bar: Logo | Global Search | Plant Filter | Alerts | User |
+----------------------+--------------------------------------+
| Sidebar Navigation   | Main Content Area                    |
|                      |                                      |
|                      | Page Title + Breadcrumb              |
|                      | Filters / Actions                    |
|                      | Main Table / Form / Dashboard        |
|                      | Pagination / Footer Actions          |
+----------------------+--------------------------------------+
```

## 2.2 Top Bar Components

Top bar must include:

- Product logo
- Tenant/company name
- Global search
- Plant selector
- Language selector
- Notification bell
- Online/offline indicator where applicable
- User profile menu

## 2.3 Sidebar Components

Sidebar must be:

- Role-based
- Collapsible
- Module grouped
- Icon-supported
- Language-ready
- Scrollable
- Highlight active menu

## 2.4 Page Header

Each page must show:

- Page title
- Breadcrumb
- Primary action button
- Secondary actions if needed

Example:

```text
Orders > All Orders

[New Order] [Export] [Filter]
```

## 2.5 Standard List Screen Layout

All list screens should follow:

```text
Page Title
Short description

Filters Row:
[Date Range] [Plant] [Customer] [Status] [Search]

Actions:
[Add New] [Export] [Print]

Table:
| Checkbox | Reference No | Main Info | Status | Created By | Date | Actions |

Footer:
Pagination | Rows per page
```

## 2.6 Standard Form Screen Layout

All forms should follow:

```text
Page Title
Breadcrumb

Section 1: Basic Details
Section 2: Business Details
Section 3: Tax / Finance Details
Section 4: Attachments / Notes
Section 5: Audit Info if view mode

Footer Actions:
[Cancel] [Save Draft] [Submit] [Approve if permitted]
```

## 2.7 Detail Page Layout

Detail pages should use tabs.

Example:

```text
Customer Name / Order Number / Invoice Number

Summary Card Row

Tabs:
[Overview] [Transactions] [Documents] [Audit Log]

Main Tab Content
```

## 2.8 Status Badges

All key records must show clear status badges.

Examples:

- Draft
- Active
- Pending Approval
- Credit Hold
- Scheduled
- In Production
- Dispatched
- Completed
- Cancelled
- Synced
- Pending Sync
- Failed Sync

---

# 3. Login Screen Layout

## 3.1 Login Page

```text
+--------------------------------------------------+
| Product Logo                                     |
| RMC Plant SaaS                                   |
|                                                  |
| Email / Mobile / User ID                         |
| Password                                         |
| Language Selector                                |
|                                                  |
| [Login]                                          |
| Forgot Password                                  |
|                                                  |
| Version Number / Support Link                    |
+--------------------------------------------------+
```

## 3.2 Login Screen Fields

- User ID / email / mobile
- Password
- Language selector
- Remember device checkbox if required

## 3.3 Login Actions

- Login
- Forgot password
- Change language
- Contact support

## 3.4 Login Rules

- Inactive user cannot log in.
- Suspended tenant user cannot log in.
- Wrong password attempts must be limited.
- Admin/owner users should support 2FA later.

---

# 4. Super Admin Dashboard Layout

## 4.1 Screen Purpose

Used by SaaS platform owner to monitor tenants, subscriptions, revenue, and platform health.

## 4.2 Layout

```text
Page: Super Admin Dashboard

Top KPI Cards:
[Total Tenants] [Active Tenants] [Trial Tenants] [MRR]
[Pending Payments] [Expiring Soon] [Suspended] [Support Tickets]

Middle Section:
Left: Tenant growth chart
Right: Revenue summary

Lower Section:
Table 1: Expiring subscriptions
Table 2: Failed payments
Table 3: Recent tenants
Table 4: System alerts
```

## 4.3 Main Actions

- Add tenant
- View tenant
- Suspend tenant
- View payment
- Open support ticket
- View system health

---

# 5. Tenant Management Screen Layout

## 5.1 Tenant List

```text
Page: Tenants

Filters:
[Status] [Plan] [Expiry Date] [Search Tenant]

Actions:
[Add Tenant] [Export]

Table:
| Tenant Code | Company Name | Plan | Plants | Users | Status | Expiry | Actions |
```

## 5.2 Add Tenant Form

Sections:

1. Tenant Basic Details
2. Company Admin Details
3. Subscription Plan
4. Trial / Billing Settings
5. Module Access
6. Activation Settings

Fields:

- Tenant name
- Legal company name
- Admin name
- Admin mobile
- Admin email
- Plan
- Trial start date
- Trial end date
- Billing cycle
- Allowed plants
- Allowed users
- Enabled modules
- Status

Actions:

- Save draft
- Create tenant
- Send invite
- Activate tenant

---

# 6. Tenant Admin Setup Dashboard Layout

## 6.1 Purpose

Used by company admin to complete initial setup.

## 6.2 Layout

```text
Page: Setup Dashboard

Setup Progress:
[Company Profile] [GST Settings] [Plant Setup] [Users]
[Materials] [Grades] [Vehicles] [Customers]

Checklist Panel:
✓ Company profile completed
✓ Plant added
! Material master pending
! User role setup pending

Primary Actions:
[Continue Setup] [Import Masters] [Go to Dashboard]
```

## 6.3 Setup Checklist

Must show:

- Company profile
- GST details
- Plant setup
- Number series
- Users
- Roles
- Materials
- Concrete grades
- Vehicles
- Drivers
- Customers
- Sites/projects

---

# 7. Owner Dashboard Layout

## 7.1 Purpose

Used by company owner to see business performance.

## 7.2 Layout

```text
Page: Owner Dashboard

Filter:
[Date] [Plant: All / Plant wise]

KPI Cards:
[Today Orders] [Today Production m³] [Today Dispatch m³]
[Today Billing] [Today Collection] [Total Outstanding]
[Credit Hold Orders] [Low Stock Alerts] [Pending Approvals]

Charts:
Left: Production trend
Right: Sales trend

Tables:
1. Plant-wise performance
2. Credit blocked orders
3. Top customers
4. Delayed deliveries
5. Low stock materials
```

## 7.3 Main Actions

- Approve credit hold
- Approve negative stock
- View reports
- Export MIS
- View plant performance

---

# 8. Company Profile Screen Layout

## 8.1 Layout

Sections:

1. Company Identity
2. GST and Tax Details
3. Address
4. Contact Details
5. Bank Details
6. Invoice Terms
7. Logo and Signature

## 8.2 Fields

- Company name
- Legal name
- GSTIN
- PAN
- Address
- State
- Phone
- Email
- Bank name
- Account number
- IFSC
- Invoice footer
- Logo
- Authorized signatory

## 8.3 Actions

- Save
- Upload logo
- Upload signature
- Preview invoice header

---

# 9. Plant Setup Screen Layout

## 9.1 Plant List

```text
Page: Plants

Actions:
[Add Plant]

Table:
| Plant Code | Plant Name | Location | Capacity | Manager | Status | Actions |
```

## 9.2 Add/Edit Plant Form

Sections:

1. Basic Details
2. Plant Capacity
3. Batching Controller
4. Weighbridge
5. Number Series
6. Users Assigned

Fields:

- Plant code
- Plant name
- Address
- GPS location
- Capacity per hour
- Batching controller brand
- Controller type
- Weighbridge available yes/no
- Plant manager
- Challan series
- Invoice series
- Status

---

# 10. User and Role Screen Layout

## 10.1 User List

```text
Filters:
[Role] [Plant] [Status] [Search]

Table:
| Name | Mobile | Email | Role | Plant Access | Status | Last Login | Actions |
```

## 10.2 User Form Sections

1. Basic Info
2. Login Info
3. Role Assignment
4. Plant Access
5. Security Settings

Fields:

- Name
- Mobile
- Email
- Role
- Assigned plants
- Password / invite link
- Active status
- 2FA required yes/no

---

# 11. Customer Screen Layout

## 11.1 Customer List

```text
Page: Customers

Filters:
[Status] [Credit Status] [State] [Search]

Actions:
[Add Customer] [Import] [Export]

Table:
| Customer Code | Customer Name | GSTIN | Mobile | Credit Limit | Outstanding | Status | Actions |
```

## 11.2 Customer Detail Page

Header:

```text
Customer Name
Status Badge | GSTIN | Outstanding | Credit Limit
```

Tabs:

- Overview
- Sites / Projects
- Quotations
- Orders
- Invoices
- Payments
- Ledger
- Documents
- Audit Log

## 11.3 Add/Edit Customer Form

Sections:

1. Basic Details
2. GST Details
3. Billing Address
4. Contact Persons
5. Credit Settings
6. Opening Balance

Fields:

- Customer name
- Company name
- GSTIN
- Customer type
- Billing address
- State
- Contact person
- Mobile
- Email
- Credit limit
- Credit days
- Opening balance
- Blocked status

---

# 12. Site / Project Screen Layout

## 12.1 Site List

```text
Filters:
[Customer] [Status] [Search]

Table:
| Site Name | Customer | Location | Contact | Pump Required | Status | Actions |
```

## 12.2 Site Form

Sections:

1. Project Details
2. Delivery Location
3. Site Contact
4. Pouring Requirements
5. Instructions

Fields:

- Customer
- Site/project name
- Site address
- GPS location
- Site contact person
- Mobile
- Structure type
- Pump required yes/no
- Road access condition
- Delivery time restriction
- Special instructions

---

# 13. Material Master Screen Layout

## 13.1 Material List

```text
Filters:
[Category] [Status] [Search]

Table:
| Code | Material Name | Category | UOM | Current Stock | Reorder Level | Status | Actions |
```

## 13.2 Material Form

Sections:

1. Basic Details
2. Stock Settings
3. Rate Settings
4. Supplier Mapping

Fields:

- Material name
- Material code
- Category
- UOM
- HSN if applicable
- Opening stock
- Minimum stock
- Reorder level
- Standard rate
- Supplier
- Storage location
- Active status

---

# 14. Concrete Grade and Mix Design Screen Layout

## 14.1 Grade List

```text
Table:
| Grade | Mix Code | Slump Range | Pumpable | Active Version | Approval Status | Actions |
```

## 14.2 Mix Design Form

Sections:

1. Grade Details
2. Mix Properties
3. Material Proportion
4. Approval
5. Version History

Fields:

- Grade name
- Mix code
- Slump range
- Cement type
- Cement quantity
- Fly ash / GGBS quantity
- Aggregate quantities
- Sand / M-sand quantity
- Water quantity
- Admixture quantity
- Water-cement ratio
- Pumpable yes/no
- Version
- Approval status

Actions:

- Save draft
- Submit for approval
- Approve
- Reject
- Create new version

---

# 15. Vehicle and Driver Screen Layout

## 15.1 Vehicle List

```text
Filters:
[Vehicle Type] [Status] [Document Expiry] [Search]

Table:
| Vehicle No | Type | Capacity | Driver | GPS Provider | Status | Document Alert | Actions |
```

## 15.2 Vehicle Form

Sections:

1. Vehicle Details
2. Capacity
3. Driver Assignment
4. GPS Details
5. Documents
6. Maintenance Status

Fields:

- Vehicle number
- Vehicle type
- Capacity in m³
- Own/hired
- Driver
- GPS provider
- GPS device/API ID
- Insurance expiry
- Fitness expiry
- Permit expiry
- Pollution expiry
- Status

## 15.3 Driver Form

Fields:

- Driver name
- Mobile
- License number
- License expiry
- Assigned vehicle
- Address
- Emergency contact
- Active status

---

# 16. Quotation Screen Layout

## 16.1 Quotation List

```text
Filters:
[Date Range] [Customer] [Status] [Salesperson]

Table:
| Quotation No | Customer | Site | Date | Valid Till | Value | Status | Actions |
```

## 16.2 Create Quotation Form

Sections:

1. Customer and Site
2. Concrete Grade Rates
3. Additional Charges
4. Terms and Validity
5. Approval

Fields:

- Customer
- Site/project
- Quotation date
- Validity date
- Grade
- Estimated quantity
- Rate per m³
- Transportation charge
- Pump charge
- Waiting charge
- GST applicable
- Payment terms
- Remarks

Actions:

- Save draft
- Submit approval
- Approve
- Revise
- Print PDF
- Send WhatsApp
- Convert to order

---

# 17. Order Booking Screen Layout

## 17.1 Order List

```text
Filters:
[Date] [Plant] [Customer] [Grade] [Status]

Table:
| Order No | Customer | Site | Grade | Qty | Required Time | Credit Status | Order Status | Actions |
```

## 17.2 New Order Form

Sections:

1. Customer Selection
2. Site and Delivery Details
3. Concrete Requirement
4. Credit Check
5. Confirmation

Fields:

- Customer
- Site/project
- Plant
- Grade
- Quantity in m³
- Required date/time
- Slump
- Pump required
- Delivery interval
- Number of loads
- Site contact
- Special instructions

Credit Check Panel:

```text
Credit Limit:
Current Outstanding:
Overdue:
Order Estimated Value:
Credit Status:
```

Actions:

- Save draft
- Run credit check
- Confirm order
- Send to credit approval
- Cancel

## 17.3 Credit Hold Behavior

If credit fails:

- Confirm button must be disabled.
- Screen must show reason.
- User must request approval.
- Order status becomes Credit Hold.

---

# 18. Credit Hold Approval Screen Layout

## 18.1 Credit Hold List

```text
Table:
| Order No | Customer | Credit Limit | Outstanding | Order Value | Requested By | Status | Actions |
```

## 18.2 Approval Detail

Sections:

1. Customer credit summary
2. Order details
3. Ledger summary
4. Request reason
5. Approval action

Actions:

- Approve
- Reject
- Add remarks

---

# 19. Production Planning Screen Layout

## 19.1 Daily Production Plan

```text
Page: Production Plan

Top Filters:
[Date] [Plant]

Left Panel:
Confirmed Orders

Right Panel:
Today's Production Sequence

Cards:
Order No | Customer | Site | Grade | Qty | Required Time | Priority
```

## 19.2 Actions

- Add order to plan
- Remove from plan
- Change sequence
- Assign time slot
- Send to batch queue
- Hold order
- Release order

## 19.3 Plan Summary

Must show:

- Total planned quantity
- Grade-wise quantity
- Plant capacity utilization
- Pending quantity
- Vehicle requirement

---

# 20. Batch Queue Screen Layout

## 20.1 Batch Queue

```text
Filters:
[Plant] [Date] [Grade] [Status]

Table:
| Queue No | Order | Customer | Vehicle | Grade | Qty | Mix Code | Status | Actions |
```

Actions:

- Start batch
- Enter batch ticket
- Import batch ticket
- Hold
- Complete

## 20.2 Batch Queue Card View

For plant operators, card view should be available:

```text
Order No
Customer / Site
Grade / Quantity
Vehicle / Driver
[Start Batch] [Enter Ticket]
```

---

# 21. Manual Batch Ticket Screen Layout

## 21.1 Layout

Sections:

1. Reference Details
2. Batch Timing
3. Material Target vs Actual
4. Variance
5. Remarks

Fields:

- Batch ticket number
- Order
- Vehicle
- Driver
- Grade
- Mix code
- Quantity
- Batch start time
- Batch end time
- Operator

Material grid:

```text
| Material | Target Qty | Actual Qty | Difference | Difference % |
```

Actions:

- Save batch ticket
- Link to challan
- Print batch ticket
- Submit correction approval if required

---

# 22. Dispatch Board Screen Layout

## 22.1 Kanban Dispatch Board

```text
Columns:
Waiting | Batching | Loaded | Left Plant | Reached Site | Pouring | Completed | Delayed | Rejected
```

Each card must show:

- Order number
- Customer
- Site
- Grade
- Quantity
- Vehicle
- Driver
- Required time
- Current status
- Delay indicator

## 22.2 Dispatch Actions

- Assign vehicle
- Generate challan
- Mark left plant
- Mark reached site
- Mark pouring
- Mark completed
- Record delay
- Record return quantity
- Reject load

---

# 23. Vehicle Allocation Screen Layout

## 23.1 Layout

Left side:

- Pending loads

Right side:

- Available vehicles

Vehicle card:

```text
Vehicle No
Capacity
Driver
Status
Last trip
Document alert
```

Actions:

- Assign vehicle
- Change vehicle
- Assign driver
- Release vehicle

Rules:

- Under-maintenance vehicle cannot be selected.
- Already assigned vehicle cannot be double booked.

---

# 24. Delivery Challan Screen Layout

## 24.1 Challan List

```text
Filters:
[Date] [Plant] [Customer] [Vehicle] [Status]

Table:
| Challan No | Order | Customer | Vehicle | Grade | Qty | Status | Invoice Status | Actions |
```

## 24.2 Challan Detail / Form

Sections:

1. Challan Header
2. Customer and Site
3. Vehicle and Driver
4. Concrete Details
5. Dispatch Timing
6. Receiver Proof
7. Invoice Link

Fields:

- Challan number
- Challan date/time
- Order number
- Customer
- Site
- Vehicle
- Driver
- Grade
- Quantity
- Slump
- Batch ticket number
- Dispatch time
- Arrival time
- Pour start/end
- Receiver name
- Signature
- Return quantity
- Remarks

Actions:

- Generate
- Print
- Send WhatsApp
- Mark delivered
- Cancel with approval

---

# 25. Inventory Dashboard Screen Layout

## 25.1 Layout

KPI Cards:

- Cement stock
- Aggregate stock
- Sand stock
- Admixture stock
- Low stock count
- Negative stock requests

Tables:

1. Low stock materials
2. Today inward
3. Today consumption
4. Stock adjustment requests

Charts:

- Material stock trend
- Consumption trend

---

# 26. Material Inward Screen Layout

## 26.1 Form Sections

1. Supplier Details
2. Vehicle and Weighbridge
3. Material Details
4. Stock Update

Fields:

- Supplier
- Vehicle number
- Material
- Supplier challan number
- Weighbridge slip number
- Gross weight
- Tare weight
- Net weight
- Quantity accepted
- Rate
- Plant
- Remarks

Actions:

- Save inward
- Print inward slip
- Update stock
- Send for approval if mismatch

---

# 27. Stock Ledger Screen Layout

## 27.1 Layout

Filters:

- Material
- Plant
- Date range
- Transaction type

Table:

```text
| Date | Material | Transaction Type | In Qty | Out Qty | Balance | Reference | User |
```

Actions:

- Export
- Print

---

# 28. Negative Stock Approval Screen Layout

## 28.1 List

```text
| Request No | Material | Available Qty | Required Qty | Negative Qty | Requested By | Status | Actions |
```

## 28.2 Detail

Must show:

- Material
- Plant
- Current stock
- Required quantity
- Negative quantity
- Reason
- Related order/batch
- Requested by
- Approval history

Actions:

- Approve
- Reject

---

# 29. Weighbridge Screen Layout

## 29.1 Weighbridge Entry List

```text
Filters:
[Date] [Material] [Supplier] [Vehicle]

Table:
| Slip No | Vehicle | Supplier | Material | Gross | Tare | Net | Status | Actions |
```

## 29.2 New Weighbridge Entry

Fields:

- Slip number
- Date/time
- Vehicle number
- Supplier
- Material
- Gross weight
- Tare weight
- Net weight
- Supplier challan
- Operator
- Remarks

Actions:

- Save
- Print slip
- Create material inward
- Mark mismatch

---

# 30. Invoice Screen Layout

## 30.1 Invoice List

```text
Filters:
[Date] [Customer] [Plant] [Status] [Payment Status]

Table:
| Invoice No | Customer | Date | Qty | Taxable | GST | Total | Payment Status | Actions |
```

## 30.2 Create Invoice From Challans

Layout:

```text
Step 1: Select Customer
Step 2: Select Completed Challans
Step 3: Confirm Rates
Step 4: GST Calculation
Step 5: E-Invoice/E-Way Ready Fields
Step 6: Preview and Create Invoice
```

Fields:

- Customer
- Billing address
- GSTIN
- Place of supply
- Challan references
- Grade
- Quantity
- Rate
- Taxable amount
- CGST
- SGST
- IGST
- Round off
- Total
- Payment terms

Actions:

- Preview
- Create invoice
- Print PDF
- Send WhatsApp
- Cancel with approval

---

# 31. E-Invoice / E-Way Ready Fields Screen Layout

## 31.1 Purpose

Phase 1 stores ready fields only. Direct API comes later.

## 31.2 Layout

Inside invoice detail page, use tabs:

- Invoice Details
- E-Invoice Ready Fields
- E-Way Bill Ready Fields
- Audit Log

## 31.3 E-Invoice Ready Fields

- IRN
- Ack number
- Ack date
- Signed QR code field
- E-invoice status
- Cancellation status

## 31.4 E-Way Bill Ready Fields

- E-way bill number
- E-way bill date
- Validity
- Distance
- Transport mode
- Vehicle number
- Transporter name
- Status

---

# 32. Receipt Screen Layout

## 32.1 Receipt List

```text
Filters:
[Date] [Customer] [Payment Mode]

Table:
| Receipt No | Customer | Date | Amount | Mode | Adjusted | Balance Advance | Actions |
```

## 32.2 Receipt Form

Sections:

1. Customer
2. Payment Details
3. Invoice Adjustment
4. Remarks

Fields:

- Customer
- Receipt date
- Payment mode
- Amount
- Bank reference
- Invoice allocation
- Advance yes/no
- Remarks

Actions:

- Save receipt
- Print receipt
- Send WhatsApp
- Cancel/edit with approval

---

# 33. Tally Export Screen Layout

## 33.1 Layout

Tabs:

- Invoice Export
- Receipt Export
- Customer Ledger Export
- GST Sales Export
- Export History
- Failed Export Log

Filters:

- Date range
- Plant
- Customer
- Export status

Actions:

- Generate export
- Download file
- Mark exported
- Retry failed
- View log

---

# 34. WhatsApp API Screen Layout

## 34.1 Message Template Screen

Table:

```text
| Template Name | Module | Language | Status | Provider Template ID | Actions |
```

Fields:

- Template name
- Module
- Event trigger
- Language
- Template body
- Variables
- Provider template ID
- Active status

## 34.2 Message Log Screen

Table:

```text
| Date | Customer/User | Mobile | Module | Template | Status | Error | Actions |
```

Actions:

- Retry
- View payload
- View delivery status

---

# 35. Reports Screen Layout

## 35.1 Report Center

Reports should be grouped:

- Sales
- Production
- Dispatch
- Inventory
- Billing
- Payments
- GST
- QC
- Vehicle
- Management MIS

## 35.2 Standard Report Layout

```text
Page: Report Name

Filters:
[Date Range] [Plant] [Customer] [Status] [Grade]

Actions:
[Run Report] [Export Excel] [Export PDF] [Print]

Summary:
KPI cards if applicable

Table:
Report data

Footer:
Total row
```

---

# 36. Approval Center Layout

## 36.1 Approval Dashboard

KPI Cards:

- Credit hold approvals
- Negative stock approvals
- Discount approvals
- Invoice cancellation approvals
- Stock adjustment approvals

Table:

```text
| Request Type | Reference | Requested By | Date | Priority | Status | Actions |
```

## 36.2 Approval Detail

Sections:

1. Request details
2. Business impact
3. Supporting data
4. Approval history
5. Action

Actions:

- Approve
- Reject
- Ask for clarification

---

# 37. Audit Log Screen Layout

## 37.1 Layout

Filters:

- Module
- User
- Date range
- Action type
- Record ID

Table:

```text
| Date/Time | User | Module | Action | Record | Old Value | New Value | IP/Device |
```

Actions:

- View detail
- Export if permitted

---

# 38. Subscription Screen Layout

## 38.1 Tenant Subscription Screen

Shows:

- Current plan
- Billing cycle
- Subscription status
- Renewal date
- Allowed plants
- Used plants
- Allowed users
- Used users
- Enabled modules

Actions:

- View invoice
- Pay renewal
- Upgrade plan
- Contact support

---

# 39. Standalone Plant App Layout

## 39.1 Standalone App Shell

```text
+-------------------------------------------------------------+
| Plant Name | User | Online/Offline | Last Sync | Manual Sync |
+-------------------------------------------------------------+
| Left Menu  | Main Operation Screen                          |
+-------------------------------------------------------------+
```

## 39.2 Standalone Home / Today Screen

KPI Cards:

- Today orders
- Pending batches
- Pending dispatch
- Completed loads
- Low stock
- Pending sync

Tables:

1. Today’s production plan
2. Pending dispatch
3. Failed sync records

Actions:

- Start batch
- Generate challan
- Enter material inward
- Manual sync

---

# 40. Standalone Batch Entry Layout

Sections:

1. Order reference
2. Vehicle
3. Grade/mix
4. Batch ticket
5. Material actuals
6. Save locally

Must show:

- Offline badge if offline
- Local record ID
- Sync status

Actions:

- Save local
- Print batch ticket
- Queue for sync

---

# 41. Standalone Delivery Challan Layout

Sections:

1. Order
2. Vehicle
3. Concrete details
4. Dispatch time
5. Print settings

Actions:

- Generate reserved challan number
- Print challan
- Save locally
- Queue for sync

Rules:

- Offline challan number must not duplicate.
- Sync status must be visible.

---

# 42. Sync Center Layout

## 42.1 Sync Dashboard

KPI Cards:

- Last sync time
- Pending upload
- Pending download
- Failed records
- Conflicts

Tabs:

- Pending Uploads
- Failed Sync
- Conflicts
- Sync History
- Local Backup

Actions:

- Manual sync
- Retry failed
- Resolve conflict
- Create local backup

---

# 43. Empty State Layout

Every module must have an empty state.

Example:

```text
No customers added yet.
Add your first customer to start quotations and orders.

[Add Customer]
```

Example:

```text
No orders found for selected date.
Change the filter or create a new order.

[New Order]
```

---

# 44. Error State Layout

Errors must be clear.

Examples:

- “Credit limit exceeded. Order moved to Credit Hold.”
- “Stock is insufficient. Negative stock approval required.”
- “Invoice cannot be created for cancelled challan.”
- “Sync failed. Check connection and retry.”
- “Vehicle is already assigned to another active trip.”

Each error should include:

- What happened
- Why it happened
- What the user can do next

---

# 45. Phase 1 Screen Layout Priority

Phase 1 must design and build these layouts first:

1. Login
2. Super Admin Dashboard
3. Tenant List
4. Add Tenant
5. Tenant Setup Dashboard
6. Owner Dashboard
7. Company Profile
8. Plant Setup
9. User and Role Management
10. Customer
11. Site / Project
12. Material Master
13. Concrete Grade / Mix Design
14. Vehicle
15. Driver
16. Quotation
17. Order Booking
18. Credit Hold Approval
19. Production Planning
20. Batch Queue
21. Manual Batch Ticket
22. Dispatch Board
23. Vehicle Allocation
24. Delivery Challan
25. Inventory Dashboard
26. Material Inward
27. Stock Ledger
28. Negative Stock Approval
29. Weighbridge Entry
30. Invoice
31. E-Invoice/E-Way Ready Fields
32. Receipt
33. Tally Export
34. WhatsApp Template
35. WhatsApp Message Log
36. Reports Center
37. Approval Center
38. Audit Log
39. Subscription View
40. Standalone Plant Home
41. Standalone Batch Entry
42. Standalone Delivery Challan
43. Sync Center

---

# 46. Layout Acceptance Criteria

This document is accepted when:

1. Global layout is defined.
2. Super Admin layouts are defined.
3. Tenant setup layouts are defined.
4. Owner dashboard layout is defined.
5. Core master screens are defined.
6. Quotation and order layouts are defined.
7. Credit hold layout is defined.
8. Production and batching layouts are defined.
9. Dispatch and challan layouts are defined.
10. Inventory and weighbridge layouts are defined.
11. Billing and receipt layouts are defined.
12. Tally export layout is defined.
13. WhatsApp API layout is defined.
14. Reports and approvals layouts are defined.
15. Standalone plant layouts are defined.
16. Sync center layout is defined.
17. Phase 1 screen priority is clearly listed.

---

# 47. Next Design Document

Next document to prepare:

**Design Document 6: Database Entity Design**

This will define the database entities/tables required for:

- SaaS multi-tenancy
- Tenant companies
- Plants
- Users and roles
- Customers
- Sites
- Materials
- Vehicles
- Orders
- Production
- Dispatch
- Batch tickets
- Inventory
- Weighbridge
- Billing
- Payments
- Tally export
- WhatsApp logs
- Offline sync
- Audit logs
