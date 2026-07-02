# RMC Plant SaaS Software

## Design Stage Document 4: UI/UX Screen List

## 1. Purpose of This Document

This document lists all screens required for the RMC Plant SaaS software.

It covers:

* Super Admin screens
* Tenant / Company Admin screens
* Owner dashboard screens
* Plant operation screens
* Sales screens
* Order screens
* Production screens
* Dispatch screens
* Inventory screens
* Weighbridge screens
* Billing screens
* Payment screens
* Tally export screens
* WhatsApp API screens
* Offline sync screens
* Future Phase 2, Phase 3, Phase 4, and Phase 5 screens

This document is part of the **Design Stage**.

---

# 2. UI/UX Screen Design Principle

The software should be designed with three separate UX levels:

## 2.1 Owner / Management UX

For owners and directors.

Design style:

* Dashboard-first
* KPI cards
* Graphs
* Alerts
* Approval shortcuts
* Plant comparison
* Revenue and outstanding visibility

## 2.2 Office / Admin UX

For sales, accounts, store, admin, and managers.

Design style:

* Tables
* Forms
* Filters
* Export buttons
* Approval status
* Printable documents
* Fast search

## 2.3 Plant Operator UX

For batching, dispatch, and plant staff.

Design style:

* Very simple
* Large buttons
* Clear status
* Fewer fields
* Fast operation
* Offline status visible
* Print-friendly

---

# 3. Global Screens

These screens are common across the platform.

## 3.1 Login Screen

Used by:

* Super Admin
* Tenant users
* Plant users
* Future mobile users

Fields:

* Email / mobile / username
* Password
* Language selector
* Remember device
* Forgot password

Actions:

* Login
* Reset password
* Change language

---

## 3.2 Forgot Password Screen

Fields:

* Email / mobile

Actions:

* Send reset link / OTP
* Return to login

---

## 3.3 Reset Password Screen

Fields:

* New password
* Confirm password
* OTP / reset token

Actions:

* Reset password

---

## 3.4 User Profile Screen

Fields:

* Name
* Email
* Mobile
* Role
* Assigned plant
* Language preference
* Password change
* Two-factor setting if enabled

Actions:

* Update profile
* Change password
* Logout

---

## 3.5 Notification Center Screen

Shows:

* Credit hold approvals
* Negative stock approvals
* Low stock alerts
* Failed sync
* Failed WhatsApp messages
* Subscription alerts
* Delayed dispatch
* Invoice overdue
* Document expiry

Actions:

* Mark as read
* Open related record
* Filter by type

---

# 4. Super Admin Portal Screens

Super Admin screens are for SaaS platform management.

## 4.1 Super Admin Dashboard

Widgets:

* Total tenants
* Active tenants
* Trial tenants
* Suspended tenants
* Monthly recurring revenue
* Pending subscription payments
* Expiring subscriptions
* Failed payments
* System health
* Sync error count
* New tenant signups
* Support access requests

Actions:

* Add tenant
* View tenant
* View billing
* View system alerts

---

## 4.2 Tenant List Screen

Columns:

* Tenant name
* Company name
* Plan
* Status
* Trial/subscription end date
* Number of plants
* Number of users
* Payment status
* Created date

Filters:

* Status
* Plan
* Payment status
* Trial ending soon

Actions:

* View
* Edit
* Suspend
* Reactivate
* Open support mode

---

## 4.3 Add / Edit Tenant Screen

Fields:

* Tenant name
* Company legal name
* Admin name
* Admin email
* Admin mobile
* Plan
* Trial period
* Subscription start date
* Subscription end date
* Plant limit
* User limit
* Storage limit
* Active modules
* Status

Actions:

* Save
* Activate
* Send welcome email
* Cancel

---

## 4.4 Tenant Detail Screen

Tabs:

* Overview
* Subscription
* Usage
* Modules
* Payments
* Support Access
* Audit Log

Shows:

* Tenant profile
* Plan
* Active users
* Active plants
* Storage usage
* Last login
* Last payment
* Health status

---

## 4.5 Subscription Plan List Screen

Columns:

* Plan name
* Monthly price
* Yearly price
* Plant limit
* User limit
* Module access
* Status

Actions:

* Add plan
* Edit plan
* Disable plan

---

## 4.6 Add / Edit Subscription Plan Screen

Fields:

* Plan name
* Description
* Monthly price
* Yearly price
* Trial days
* User limit
* Plant limit
* Storage limit
* Included modules
* Add-on allowed
* Status

Actions:

* Save
* Publish
* Disable

---

## 4.7 Module Control Screen

Purpose:
Control which modules are available in each plan or tenant.

Fields:

* Module name
* Module code
* Phase
* Enabled/disabled
* Plan availability
* Tenant override allowed

Actions:

* Enable module
* Disable module
* Assign to plan
* Assign to tenant

---

## 4.8 SaaS Billing Screen

Shows:

* SaaS invoices
* Subscription payments
* Failed payments
* Pending renewals
* Trial expiry
* Grace period

Actions:

* Generate invoice
* Mark paid
* Send reminder
* Suspend tenant
* Reactivate tenant

---

## 4.9 Coupon Management Screen

Fields:

* Coupon code
* Discount type
* Discount value
* Start date
* End date
* Usage limit
* Applicable plans
* Status

Actions:

* Create coupon
* Edit coupon
* Disable coupon
* View usage

---

## 4.10 Payment Gateway Settings Screen

Fields:

* Gateway provider
* API key
* Secret key
* Webhook URL
* Environment
* Active/inactive

Actions:

* Save settings
* Test connection
* View webhook logs

---

## 4.11 Support Access Screen

Shows:

* Tenant
* Requested by
* Support user
* Access reason
* Start time
* End time
* Status

Actions:

* Grant access
* Revoke access
* View audit

---

## 4.12 System Monitoring Screen

Widgets:

* Server status
* API errors
* Background jobs
* Failed sync count
* Storage usage
* Database health
* Queue status

---

## 4.13 Super Admin Audit Log Screen

Filters:

* User
* Tenant
* Module
* Action
* Date range

Columns:

* Date/time
* User
* Tenant
* Module
* Action
* IP/device
* Old value
* New value

---

# 5. Tenant Setup Screens

These screens are used by Company Admin / Tenant Admin.

## 5.1 Tenant Dashboard

Shows setup progress:

* Company profile completed
* GST settings completed
* Plant added
* Users created
* Materials added
* Grades added
* Vehicles added
* Customers added
* Ready for operation

---

## 5.2 Company Profile Screen

Fields:

* Company name
* Legal name
* GSTIN
* PAN
* Address
* State
* Phone
* Email
* Website
* Logo
* Bank details
* Invoice terms
* Authorized signatory

Actions:

* Save
* Upload logo
* Upload signature

---

## 5.3 Legal Entity Screen

For tenants with multiple GSTIN/legal entities.

Fields:

* Legal entity name
* GSTIN
* PAN
* State
* Address
* Bank details
* Active status

---

## 5.4 Plant List Screen

Columns:

* Plant code
* Plant name
* Location
* Capacity
* Manager
* Status

Actions:

* Add plant
* Edit plant
* Deactivate plant

---

## 5.5 Add / Edit Plant Screen

Fields:

* Plant name
* Plant code
* Address
* GPS location
* Capacity per hour
* Batching plant brand
* Batching software/controller
* Number of silos
* Number of bins
* Plant manager
* Challan series
* Invoice series
* Active/inactive

---

## 5.6 User List Screen

Columns:

* Name
* Email
* Mobile
* Role
* Assigned plant
* Status
* Last login

Actions:

* Add user
* Edit user
* Reset password
* Deactivate user

---

## 5.7 Add / Edit User Screen

Fields:

* Name
* Email
* Mobile
* Role
* Assigned plant
* Language
* Password
* Two-factor required
* Status

---

## 5.8 Role and Permission Screen

Layout:

* Role list on left
* Module permissions on right

Permission checkboxes:

* View
* Create
* Edit
* Delete
* Approve
* Cancel
* Print
* Export
* Import

Actions:

* Create role
* Edit role
* Clone role
* Save permission

---

## 5.9 Number Series Screen

Fields:

* Document type
* Prefix
* Starting number
* Reset frequency
* Plant-wise yes/no
* Financial year-wise yes/no

Document types:

* Quotation
* Order
* Dispatch
* Delivery challan
* Batch ticket
* Invoice
* Receipt
* Credit note
* Debit note
* GRN
* Purchase order

---

## 5.10 GST Settings Screen

Fields:

* GSTIN
* State
* Default HSN/SAC
* CGST/SGST/IGST rules
* Invoice declaration
* E-invoice ready fields enabled
* E-way bill ready fields enabled

---

## 5.11 Language Settings Screen

Fields:

* Default language
* Enabled languages
* PDF language option
* User language preference allowed

Languages:

* English
* Tamil
* Hindi
* Telugu
* Kannada
* Malayalam
* Marathi
* Gujarati
* Bengali
* Punjabi
* Odia

---

## 5.12 Print Template Settings Screen

Templates:

* Quotation
* Order confirmation
* Delivery challan
* Batch ticket
* Invoice
* Receipt
* QC certificate
* Daily report

Actions:

* Preview
* Edit header/footer
* Upload logo
* Set terms

---

## 5.13 Integration Settings Screen

Tabs:

* Batching controller
* Weighbridge
* GPS
* WhatsApp
* Tally export
* Email
* SMS
* Payment gateway

---

# 6. Master Data Screens

## 6.1 Customer List Screen

Columns:

* Customer name
* GSTIN
* Contact
* State
* Credit limit
* Outstanding
* Status

Actions:

* Add customer
* Edit
* View ledger
* Add site
* Block/unblock

---

## 6.2 Add / Edit Customer Screen

Fields:

* Customer name
* Company name
* GSTIN
* Customer type
* Billing address
* State
* Contact person
* Mobile
* Email
* Credit limit
* Credit days
* Opening balance
* Payment terms
* Status

---

## 6.3 Customer Detail Screen

Tabs:

* Overview
* Sites/projects
* Quotations
* Orders
* Challans
* Invoices
* Payments
* Outstanding
* Documents
* Audit log

---

## 6.4 Site / Project List Screen

Columns:

* Site name
* Customer
* Address
* Contact
* Pump required
* Status

---

## 6.5 Add / Edit Site Screen

Fields:

* Customer
* Site/project name
* Site address
* GPS location
* Site contact person
* Mobile
* Structure type
* Pump required
* Road access condition
* Delivery time restriction
* Remarks

---

## 6.6 Material List Screen

Columns:

* Material code
* Material name
* Category
* UOM
* Current stock
* Reorder level
* Status

---

## 6.7 Add / Edit Material Screen

Fields:

* Material name
* Material code
* Category
* UOM
* HSN if applicable
* Opening stock
* Minimum stock
* Reorder level
* Standard rate
* Supplier
* Storage location
* Status

---

## 6.8 Concrete Grade List Screen

Columns:

* Grade
* Mix code
* Slump range
* Pumpable
* Active mix version
* Approval status

---

## 6.9 Add / Edit Concrete Grade Screen

Fields:

* Grade name
* Mix code
* Strength class
* Slump range
* Cement type
* Pumpable yes/no
* Status

---

## 6.10 Mix Design Screen

Fields:

* Grade
* Mix code
* Version
* Cement quantity
* Fly ash quantity
* GGBS quantity
* 20mm aggregate
* 12mm aggregate
* M-sand
* Water
* Admixture
* Water-cement ratio
* Slump range
* Approval status

Actions:

* Save draft
* Submit for approval
* Approve
* Reject
* Create new version

---

## 6.11 Vehicle List Screen

Columns:

* Vehicle number
* Type
* Capacity
* Own/hired
* Driver
* GPS provider
* Status

---

## 6.12 Add / Edit Vehicle Screen

Fields:

* Vehicle number
* Vehicle type
* Capacity in m³
* Own/hired
* Driver
* GPS provider
* GPS ID
* Insurance expiry
* Fitness expiry
* Permit expiry
* Pollution expiry
* Status

---

## 6.13 Driver List Screen

Columns:

* Driver name
* Mobile
* License number
* Assigned vehicle
* License expiry
* Status

---

## 6.14 Add / Edit Driver Screen

Fields:

* Driver name
* Mobile
* License number
* License expiry
* Assigned vehicle
* Emergency contact
* Address
* Status

---

## 6.15 Supplier List Screen

Columns:

* Supplier name
* GSTIN
* Material
* Contact
* Payment terms
* Status

---

## 6.16 Add / Edit Supplier Screen

Fields:

* Supplier name
* GSTIN
* Contact person
* Mobile
* Email
* Address
* Materials supplied
* Payment terms
* Bank details
* Status

---

# 7. Sales Screens

## 7.1 Sales Dashboard Screen

Widgets:

* Leads today
* Follow-ups due
* Quotations pending
* Quotations approved
* Orders booked
* Credit hold orders
* Customer outstanding

---

## 7.2 Lead List Screen

Columns:

* Lead name
* Customer
* Site
* Requirement
* Stage
* Salesperson
* Follow-up date

---

## 7.3 Add / Edit Lead Screen

Fields:

* Lead source
* Customer name
* Contact person
* Mobile
* Site location
* Required grade
* Estimated quantity
* Expected date
* Competitor rate
* Follow-up date
* Remarks

---

## 7.4 Follow-Up Screen

Shows:

* Due follow-ups
* Overdue follow-ups
* Completed follow-ups
* Next follow-up date

---

## 7.5 Quotation List Screen

Columns:

* Quotation number
* Customer
* Site
* Date
* Validity
* Amount
* Status

---

## 7.6 Create Quotation Screen

Fields:

* Customer
* Site
* Grade
* Estimated quantity
* Rate
* Transportation charge
* Pump charge
* Waiting charge
* GST
* Validity date
* Payment terms
* Remarks

Actions:

* Save draft
* Submit for approval
* Approve
* Print PDF
* Share via WhatsApp API
* Convert to order

---

## 7.7 Rate Contract Screen

Fields:

* Customer
* Site/project
* Grade-wise rates
* Validity period
* Transportation terms
* Pump terms
* Payment terms
* Approval status

---

# 8. Order Screens

## 8.1 Order Dashboard Screen

Widgets:

* Orders today
* Confirmed orders
* Credit hold orders
* Scheduled orders
* Partially dispatched
* Completed orders
* Cancelled orders

---

## 8.2 Order List Screen

Columns:

* Order number
* Customer
* Site
* Plant
* Grade
* Quantity
* Required time
* Credit status
* Order status

Filters:

* Date
* Plant
* Customer
* Grade
* Status

---

## 8.3 Create Order Screen

Fields:

* Customer
* Site/project
* Plant
* Grade
* Quantity
* Required date/time
* Slump
* Pump required
* Delivery interval
* Site contact
* Special instruction
* Quotation/rate contract reference

Actions:

* Save draft
* Check credit
* Confirm order
* Put on hold
* Cancel

---

## 8.4 Credit Hold Order Screen

Shows:

* Customer
* Credit limit
* Current outstanding
* Overdue amount
* Order value
* Requested quantity
* Requested by
* Approval status

Actions:

* Approve
* Reject
* View customer ledger

---

## 8.5 Order Detail Screen

Tabs:

* Overview
* Credit check
* Production
* Dispatch
* Challans
* Invoice
* Payments
* Activity log

---

# 9. Production Screens

## 9.1 Production Dashboard Screen

Widgets:

* Today's plan
* Pending production
* In batching
* Completed production
* Material shortage
* Plant capacity utilization

---

## 9.2 Production Plan Screen

Layout:

* Calendar/date filter
* Plant filter
* Order queue
* Planned load list

Fields:

* Order
* Customer
* Grade
* Quantity
* Required time
* Priority
* Planned loads
* Vehicle

Actions:

* Add to plan
* Change sequence
* Hold
* Release
* Send to batch queue

---

## 9.3 Batch Queue Screen

Columns:

* Sequence
* Order
* Customer
* Grade
* Quantity
* Vehicle
* Status

Actions:

* Start batch
* Hold batch
* View mix design
* Create batch ticket

---

## 9.4 Manual Batch Ticket Screen

Fields:

* Batch ticket number
* Order
* Vehicle
* Driver
* Grade
* Mix design version
* Batch quantity
* Batch start time
* Batch end time
* Operator
* Target material quantities
* Actual material quantities
* Water correction
* Admixture quantity
* Remarks

---

## 9.5 Batch Ticket List Screen

Columns:

* Batch ticket number
* Order
* Vehicle
* Grade
* Quantity
* Batch time
* Operator
* Sync status

---

## 9.6 Material Variance Screen

Shows:

* Target quantity
* Actual quantity
* Difference
* Percentage variance
* Material
* Batch ticket
* Order
* Plant

---

# 10. Dispatch Screens

## 10.1 Dispatch Dashboard Screen

Widgets:

* Waiting loads
* Under batching
* Loaded
* Left plant
* Reached site
* Pouring
* Completed
* Delayed trips
* Available vehicles

---

## 10.2 Dispatch Board Screen

Kanban columns:

* Waiting
* Batching
* Loaded
* Left Plant
* Reached Site
* Pouring
* Completed
* Delayed
* Rejected

Each card shows:

* Order number
* Customer
* Site
* Grade
* Quantity
* Vehicle
* Driver
* Required time
* Status

Actions:

* Assign vehicle
* Generate challan
* Mark left plant
* Mark reached site
* Mark pouring
* Mark completed
* Record delay
* Record return quantity

---

## 10.3 Vehicle Allocation Screen

Fields:

* Order
* Load quantity
* Vehicle
* Driver
* Planned dispatch time
* Site distance
* Remarks

---

## 10.4 Delivery Challan List Screen

Columns:

* Challan number
* Date
* Customer
* Site
* Vehicle
* Grade
* Quantity
* Status
* Invoice status

---

## 10.5 Generate Delivery Challan Screen

Fields:

* Challan number
* Order
* Customer
* Site
* Plant
* Vehicle
* Driver
* Grade
* Quantity
* Slump
* Batch ticket
* Dispatch time
* E-way bill reference field
* Remarks

Actions:

* Generate
* Print
* Share WhatsApp
* Mark delivered
* Cancel with approval

---

## 10.6 Active Trip Screen

Shows:

* Vehicle
* Driver
* Customer
* Site
* Grade
* Quantity
* Current status
* Time elapsed
* Delay reason if any

---

## 10.7 Return Concrete Screen

Fields:

* Challan
* Vehicle
* Return quantity
* Reason
* Action taken
* Dumped/reused/diverted
* Approved by

---

## 10.8 Rejected Load Screen

Fields:

* Challan
* Customer
* Site
* Grade
* Quantity
* Rejection reason
* QC remarks
* Billing impact
* Approval status

---

# 11. Inventory and Weighbridge Screens

## 11.1 Inventory Dashboard

Widgets:

* Cement stock
* Aggregate stock
* Sand stock
* Admixture stock
* Low stock materials
* Negative stock requests
* Today's inward
* Today's consumption

---

## 11.2 Stock Balance Screen

Columns:

* Material
* Opening stock
* Inward
* Consumption
* Adjustment
* Closing stock
* Reorder level
* Status

---

## 11.3 Material Inward Screen

Fields:

* Material
* Supplier
* Vehicle number
* Supplier challan number
* Weighbridge slip number
* Quantity
* Rate
* Date/time
* Plant
* Remarks

---

## 11.4 Stock Ledger Screen

Columns:

* Date
* Material
* Transaction type
* Reference
* Inward
* Outward
* Balance
* User

---

## 11.5 Stock Adjustment Screen

Fields:

* Material
* Current stock
* Adjustment quantity
* Reason
* Approval required yes/no
* Remarks

---

## 11.6 Negative Stock Approval Screen

Shows:

* Material
* Available stock
* Required quantity
* Negative quantity
* Requested by
* Reason
* Related batch/order
* Approval status

Actions:

* Approve
* Reject

---

## 11.7 Weighbridge Entry Screen

Fields:

* Slip number
* Vehicle number
* Material
* Supplier
* Gross weight
* Tare weight
* Net weight
* Date/time
* Operator
* Supplier challan
* Remarks

Actions:

* Save
* Print slip
* Update stock

---

# 12. Billing and Payment Screens

## 12.1 Billing Dashboard

Widgets:

* Completed challans
* Pending invoices
* Invoices today
* Overdue invoices
* Credit notes
* Debit notes
* GST taxable value
* Outstanding

---

## 12.2 Completed Challan to Invoice Screen

Shows:

* Completed challans
* Customer
* Site
* Grade
* Quantity
* Rate
* Billable quantity

Actions:

* Select challans
* Create invoice

---

## 12.3 Invoice List Screen

Columns:

* Invoice number
* Date
* Customer
* Amount
* GST
* Payment status
* E-invoice status field
* E-way bill status field

---

## 12.4 Create Invoice Screen

Fields:

* Customer
* Billing address
* GSTIN
* Place of supply
* Challan references
* Grade
* Quantity
* Rate
* Taxable value
* CGST
* SGST
* IGST
* Round off
* Total
* Payment terms
* E-invoice ready fields
* E-way bill ready fields

Actions:

* Save draft
* Issue invoice
* Print PDF
* Share WhatsApp
* Export to Tally

---

## 12.5 Invoice Detail Screen

Tabs:

* Overview
* Challans
* Tax details
* Payment
* E-invoice ready data
* E-way bill ready data
* Activity log

---

## 12.6 Receipt Entry Screen

Fields:

* Receipt number
* Customer
* Invoice
* Amount
* Payment mode
* Bank reference
* Date
* Advance yes/no
* Remarks

Actions:

* Save receipt
* Adjust invoice
* Print receipt

---

## 12.7 Customer Ledger Screen

Shows:

* Opening balance
* Invoices
* Receipts
* Credit notes
* Debit notes
* Closing balance

---

## 12.8 Outstanding Aging Screen

Buckets:

* 0–30 days
* 31–60 days
* 61–90 days
* 90+ days

Filters:

* Customer
* Salesperson
* Plant
* Date

---

# 13. Tally Export Screens

## 13.1 Tally Export Dashboard

Widgets:

* Pending invoice export
* Pending receipt export
* Exported records
* Failed export records

---

## 13.2 Invoice Export Screen

Columns:

* Invoice number
* Customer
* Date
* Taxable value
* GST
* Total
* Export status

Actions:

* Export selected
* Download XML/Excel
* Mark exported

---

## 13.3 Receipt Export Screen

Columns:

* Receipt number
* Customer
* Amount
* Payment mode
* Date
* Export status

---

## 13.4 Export History Screen

Shows:

* Export date
* Export type
* User
* File
* Success count
* Failed count

---

# 14. WhatsApp API Screens

## 14.1 WhatsApp Settings Screen

Fields:

* Provider
* API key
* Sender number
* Webhook URL
* Status

Actions:

* Save
* Test connection

---

## 14.2 WhatsApp Template Screen

Fields:

* Template name
* Template type
* Language
* Message body
* Variables
* Status

Template types:

* Quotation
* Order confirmation
* Dispatch alert
* Challan sharing
* Invoice sharing
* Payment reminder

---

## 14.3 Message Log Screen

Columns:

* Date/time
* Customer/mobile
* Template
* Related document
* Status
* Error message

Actions:

* Retry failed
* View message

---

# 15. Approval Screens

## 15.1 Approval Dashboard

Widgets:

* Credit hold approvals
* Negative stock approvals
* Quotation discount approvals
* Invoice cancellation approvals
* Stock adjustment approvals
* Mix design approvals

---

## 15.2 Credit Hold Approval Screen

Fields:

* Customer
* Credit limit
* Outstanding
* Overdue
* Order value
* Reason
* Requested by

Actions:

* Approve
* Reject

---

## 15.3 Negative Stock Approval Screen

Fields:

* Material
* Available stock
* Required quantity
* Negative quantity
* Reason
* Requested by

Actions:

* Approve
* Reject

---

## 15.4 Invoice Cancellation Approval Screen

Fields:

* Invoice
* Customer
* Amount
* Reason
* Requested by

Actions:

* Approve
* Reject

---

# 16. Offline Sync Screens

## 16.1 Sync Dashboard Screen

Shows:

* Online/offline status
* Last sync time
* Pending uploads
* Pending downloads
* Failed records
* Conflict records

Actions:

* Start sync
* Retry failed
* View conflicts

---

## 16.2 Pending Sync Screen

Columns:

* Module
* Record type
* Record number
* Created time
* Sync status

---

## 16.3 Failed Sync Screen

Columns:

* Module
* Record number
* Error reason
* Last retry time
* Retry count

Actions:

* Retry
* Ignore with approval

---

## 16.4 Conflict Resolution Screen

Shows:

* Local value
* Cloud value
* Conflict reason
* Related module
* Related record

Actions:

* Keep local
* Keep cloud
* Merge manually
* Save resolution

---

## 16.5 Local Backup Screen

Shows:

* Last backup
* Backup location
* Backup size

Actions:

* Create backup
* Restore backup
* Download backup

---

# 17. Reports Screens

## 17.1 Reports Dashboard

Categories:

* Sales
* Orders
* Production
* Dispatch
* Inventory
* Weighbridge
* Billing
* Payments
* GST
* Vehicle
* Management

---

## 17.2 Common Report Viewer Screen

Filters:

* Date range
* Plant
* Customer
* Site
* Grade
* Vehicle
* Driver
* Status

Actions:

* View report
* Export Excel
* Export PDF
* Print

---

## 17.3 Phase 1 Reports

Phase 1 must include screens for:

1. Daily order report
2. Daily production report
3. Daily dispatch report
4. Delivery challan report
5. Customer-wise sales report
6. Grade-wise sales report
7. Material stock report
8. Material consumption report
9. Invoice report
10. Payment collection report
11. Outstanding report
12. Vehicle trip report
13. User activity report

---

# 18. Audit Log Screens

## 18.1 Audit Log Screen

Filters:

* User
* Module
* Record
* Action
* Date range
* Plant

Columns:

* Date/time
* User
* Module
* Action
* Record number
* Old value
* New value
* IP/device
* Reason

---

## 18.2 Record Activity Log Tab

Every major detail page must include activity log tab.

Required pages:

* Customer detail
* Order detail
* Dispatch detail
* Challan detail
* Batch ticket detail
* Invoice detail
* Receipt detail
* Stock transaction detail
* Mix design detail

---

# 19. Standalone Plant App Screens

## 19.1 Standalone Home / Today Screen

Shows:

* Today's orders
* Pending loads
* Dispatch status
* Low stock
* Offline status
* Last sync time
* Pending sync count

---

## 19.2 Standalone Orders Screen

Shows:

* Today's orders
* Scheduled orders
* Credit hold orders
* Completed orders

---

## 19.3 Standalone Batch Queue Screen

Shows:

* Pending batches
* Order
* Customer
* Grade
* Quantity
* Vehicle
* Status

---

## 19.4 Standalone Manual Batch Entry Screen

Same as web manual batch ticket but simplified.

---

## 19.5 Standalone Dispatch Board

Shows:

* Waiting
* Batching
* Loaded
* Left plant
* Completed
* Delayed

---

## 19.6 Standalone Challan Print Screen

Actions:

* Generate challan
* Preview challan
* Print challan
* Save local copy

---

## 19.7 Standalone Inventory Screen

Shows:

* Stock balance
* Material inward
* Consumption
* Low stock

---

## 19.8 Standalone Weighbridge Entry Screen

Fields:

* Slip number
* Vehicle
* Material
* Gross
* Tare
* Net
* Supplier
* Date/time

---

## 19.9 Standalone Sync Center

Screens:

* Sync dashboard
* Pending sync
* Failed sync
* Conflict resolution
* Local backup

---

# 20. Phase 2 Screen Additions

Phase 2 will add the following screens.

## 20.1 Driver App Screens

* Driver login
* Assigned trip
* Vehicle checklist
* Navigation
* Trip status update
* Signature capture
* Photo upload
* Return quantity
* Trip completion

## 20.2 Sales App Screens

* Sales mobile dashboard
* Leads
* Customer visit
* Site photo
* Follow-up
* Quotation request
* Order booking
* Credit hold status

## 20.3 GPS Screens

* Live vehicle tracking
* Vehicle route history
* Geofence settings
* ETA dashboard
* Idle time report

## 20.4 QC Full Module Screens

* QC dashboard
* Trial mix
* Slump test
* Cube casting
* 7-day result
* 14-day result
* 28-day result
* QC certificate
* NCR

## 20.5 Purchase Screens

* Purchase request
* Purchase order
* Supplier quotation
* Rate comparison
* GRN
* Supplier bill

## 20.6 Batching Integration Screens

* Connector settings
* Putzmeister/IDS mapping
* Import log
* Failed import
* Material mapping
* Mix code mapping

---

# 21. Phase 3 Screen Additions

Phase 3 will add:

* Full subscription billing screens
* Direct Tally sync screens
* Credit note screens
* Debit note screens
* Full GST report screens
* E-invoice API screen
* E-way bill API screen
* Payment gateway collection screen
* API retry/error screen

---

# 22. Phase 4 Screen Additions

Phase 4 will add:

* Customer portal login
* Customer dashboard
* Customer order request
* Delivery tracking
* Challan download
* Invoice download
* QC certificate download
* Customer outstanding
* Complaint screen
* Online payment link

---

# 23. Phase 5 Screen Additions

Phase 5 will add:

* AI dashboard
* AI dispatch suggestion
* AI material forecast
* AI QC risk prediction
* AI collection priority
* Profit per m³ dashboard
* Plant ranking
* Predictive maintenance
* Loss-making customer alert

---

# 24. Phase 1 Screen Priority

Phase 1 must design these first:

1. Login
2. Super Admin dashboard
3. Tenant list
4. Add tenant
5. Plan/module control
6. Tenant dashboard
7. Company setup
8. Plant setup
9. User and role setup
10. Customer master
11. Site/project master
12. Material master
13. Vehicle master
14. Driver master
15. Concrete grade
16. Mix design
17. Quotation
18. Order booking
19. Credit hold
20. Production plan
21. Batch queue
22. Manual batch ticket
23. Dispatch board
24. Delivery challan
25. Inventory
26. Weighbridge manual entry
27. Negative stock approval
28. GST invoice
29. Receipt
30. Customer outstanding
31. Tally export
32. WhatsApp API settings/template/log
33. Reports
34. Audit log
35. Standalone plant home
36. Standalone batch queue
37. Standalone dispatch
38. Standalone challan print
39. Standalone sync center

---

# 25. UI/UX Screen List Acceptance Criteria

This document is complete when:

1. Super Admin screens are listed.
2. Tenant setup screens are listed.
3. Master data screens are listed.
4. Sales screens are listed.
5. Order screens are listed.
6. Production screens are listed.
7. Dispatch screens are listed.
8. Inventory screens are listed.
9. Weighbridge screens are listed.
10. Billing screens are listed.
11. Payment screens are listed.
12. Tally export screens are listed.
13. WhatsApp API screens are listed.
14. Approval screens are listed.
15. Offline sync screens are listed.
16. Standalone app screens are listed.
17. Phase 2, Phase 3, Phase 4, and Phase 5 screen additions are listed.
18. Phase 1 screen priority is clearly defined.

---

# 26. Next Design Document

Next document to prepare:

**Design Document 5: Screen-by-Screen Layout Design**

This will define the actual layout structure for the most important Phase 1 screens.
