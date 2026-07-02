# RMC Plant SaaS Software

## Design Stage Document 2: User Journey and Workflow Design

## 1. Purpose of This Document

This document explains how each user will move through the RMC SaaS software.

It defines the journey for:

* Super Admin
* Tenant / Company Admin
* Company Owner
* Plant Manager
* Sales Team
* Dispatch Team
* Batching Operator
* Store / Inventory Team
* Accounts Team
* QC / Lab Team
* Driver
* Support Staff

This document is part of the **Design Stage**.

No development should start until all design documents are completed and signed off.

---

# 2. Main Product Flow

The complete RMC business flow is:

**Tenant Setup → Company Setup → Plant Setup → Master Data → Quotation → Order Booking → Credit Check → Production Planning → Batching → Dispatch → Delivery Challan → Inventory Consumption → Invoice → Payment → Reports**

---

# 3. Super Admin Journey

## 3.1 Purpose

Super Admin manages the SaaS platform, tenants, subscriptions, plans, modules, payments, coupons, and support access.

## 3.2 Super Admin Flow

1. Super Admin logs in.
2. Views SaaS platform dashboard.
3. Creates subscription plans.
4. Creates tenant/company account.
5. Assigns plan and module access.
6. Sets trial period or subscription period.
7. Configures SaaS invoice and payment settings.
8. Activates tenant.
9. Monitors tenant usage.
10. Handles tenant support access if needed.
11. Tracks tenant billing and renewal.

## 3.3 Super Admin Dashboard Must Show

* Total tenants
* Active tenants
* Trial tenants
* Suspended tenants
* Monthly recurring revenue
* Pending subscription payments
* Expiring subscriptions
* New signups
* Support requests
* System health
* Failed jobs/sync errors

## 3.4 Super Admin Main Actions

* Add tenant
* Suspend tenant
* Reactivate tenant
* Assign plan
* Upgrade/downgrade plan
* Enable/disable modules
* Create coupon
* View SaaS invoice
* View tenant usage
* Access support mode with audit log

---

# 4. Tenant / Company Admin Journey

## 4.1 Purpose

Tenant Admin sets up the RMC company after Super Admin creates the tenant.

## 4.2 Tenant Admin Flow

1. Tenant Admin logs in.
2. Completes company profile.
3. Adds legal/GST details.
4. Adds plants.
5. Creates users.
6. Assigns roles and permissions.
7. Sets document number series.
8. Configures GST settings.
9. Configures language settings.
10. Configures print templates.
11. Adds master data.
12. Starts daily operation.

## 4.3 Tenant Admin Setup Sequence

The correct setup order is:

1. Company profile
2. GST and tax settings
3. Plant setup
4. Role setup
5. User setup
6. Number series
7. Material master
8. Concrete grade
9. Mix design
10. Vehicle master
11. Driver master
12. Customer master
13. Site/project master
14. Quotation/order operation

## 4.4 Tenant Admin Main Actions

* Manage company details
* Manage plants
* Manage users
* Manage roles
* Manage settings
* Manage language options
* Manage number series
* Manage print templates
* View audit logs
* View subscription status

---

# 5. Company Owner Journey

## 5.1 Purpose

Company Owner needs high-level business control.

## 5.2 Owner Flow

1. Owner logs in.
2. Opens owner dashboard.
3. Checks today's production.
4. Checks today's dispatch.
5. Checks revenue and outstanding.
6. Reviews credit-blocked orders.
7. Reviews pending approvals.
8. Checks plant-wise performance.
9. Checks material stock risk.
10. Checks delayed deliveries.
11. Takes action on approvals.

## 5.3 Owner Dashboard Must Show

* Today's orders
* Today's production quantity
* Today's dispatch quantity
* Today's billing
* Today's collection
* Total outstanding
* Credit blocked orders
* Low stock alerts
* Pending approvals
* Delayed deliveries
* Plant-wise comparison
* Customer-wise sales
* Grade-wise sales
* Month-to-date revenue
* Month-to-date production

## 5.4 Owner Main Actions

* Approve credit hold release
* Approve negative stock
* Approve rate discount
* Approve invoice cancellation
* View reports
* Export MIS
* Monitor plant performance

---

# 6. Plant Manager Journey

## 6.1 Purpose

Plant Manager controls daily plant operation.

## 6.2 Plant Manager Daily Flow

1. Plant Manager logs in.
2. Checks today's confirmed orders.
3. Checks material availability.
4. Checks vehicle availability.
5. Checks production capacity.
6. Creates daily production plan.
7. Sequences orders.
8. Sends loads to dispatch/batching queue.
9. Monitors production progress.
10. Handles delays, hold, return, or rejected loads.
11. Reviews end-of-day plant report.

## 6.3 Plant Manager Dashboard Must Show

* Confirmed orders
* Scheduled orders
* Pending production
* Batching in progress
* Dispatched loads
* Completed loads
* Material stock
* Vehicle status
* Delayed orders
* Credit hold orders
* Negative stock approval requests

## 6.4 Plant Manager Main Actions

* Create production plan
* Assign plant capacity
* Prioritize orders
* Hold/release orders
* Approve negative stock if permitted
* Review batch tickets
* Review dispatch status
* View plant reports

---

# 7. Sales Team Journey

## 7.1 Purpose

Sales team handles leads, quotations, customer follow-up, and order booking.

## 7.2 Sales Flow

1. Sales Executive logs in.
2. Creates lead/customer inquiry.
3. Adds customer and project/site details.
4. Prepares quotation.
5. Sends quotation for approval if needed.
6. Shares approved quotation with customer.
7. Follows up with customer.
8. Converts quotation to order.
9. System checks credit limit.
10. If credit is okay, order is confirmed.
11. If credit limit is exceeded, order moves to credit hold.

## 7.3 Sales Journey Stages

* New lead
* Site visited
* Quotation prepared
* Quotation approved
* Sent to customer
* Negotiation
* Order confirmed
* Lost/on hold

## 7.4 Sales Main Actions

* Create lead
* Create customer
* Add site/project
* Create quotation
* Request discount approval
* Convert quotation to order
* View customer outstanding
* View order status
* Follow up customer

## 7.5 Important Sales Rule

Credit limit must block at **order booking stage**.

If customer exceeds credit limit:

* Order cannot be confirmed.
* Order goes to credit hold.
* Authorized approval is required.

---

# 8. Credit Hold Workflow

## 8.1 Trigger

Credit hold is triggered when:

* Customer outstanding exceeds credit limit
* Customer credit days are exceeded
* Customer is manually blocked
* Customer has overdue invoices beyond allowed rules

## 8.2 Credit Hold Flow

1. User creates order.
2. System checks credit.
3. If credit fails, system marks order as **Credit Hold**.
4. User enters reason or request note.
5. Approval request goes to Owner / Accounts Manager / Authorized Admin.
6. Approver reviews customer ledger.
7. Approver approves or rejects.
8. If approved, order becomes confirmed.
9. If rejected, order remains blocked.
10. Full audit log is saved.

## 8.3 Credit Hold Screen Must Show

* Customer name
* Credit limit
* Current outstanding
* Overdue amount
* Pending invoices
* Order value
* Requested quantity
* Requested by
* Approval history
* Approve/reject buttons

---

# 9. Dispatch Team Journey

## 9.1 Purpose

Dispatch team controls vehicle assignment and delivery status.

## 9.2 Dispatch Flow

1. Dispatch Manager logs in.
2. Opens dispatch board.
3. Views scheduled orders.
4. Assigns vehicle and driver.
5. Confirms load quantity.
6. Sends load to batching.
7. Generates delivery challan.
8. Marks vehicle left plant.
9. Tracks vehicle/site status.
10. Marks delivery completion.
11. Records return/rejected quantity if any.

## 9.3 Dispatch Board Statuses

* Waiting
* Under batching
* Loaded
* Left plant
* Reached site
* Pouring
* Completed
* Returning
* Delayed
* Rejected
* Cancelled

## 9.4 Dispatch Main Actions

* Assign vehicle
* Assign driver
* Generate challan
* Print challan
* Send WhatsApp alert
* Update delivery status
* Record delay reason
* Record return quantity
* Mark trip completed

---

# 10. Batching Operator Journey

## 10.1 Purpose

Batching Operator produces concrete loads based on approved orders and mix designs.

## 10.2 Batching Flow

1. Operator logs in to standalone plant app.
2. Opens batch queue.
3. Selects approved load.
4. Confirms vehicle and grade.
5. Confirms approved mix design.
6. Produces batch in plant controller.
7. Enters or imports batch ticket.
8. Records actual material consumption.
9. Links batch ticket to challan.
10. Marks batch completed.

## 10.3 Phase 1 Batching Mode

Phase 1 supports:

* Manual batch ticket entry
* Import-ready structure for Putzmeister/IDS
* Future multi-brand connector support

## 10.4 Batching Rules

* Only approved mix design can be used.
* Batch ticket number must be unique.
* Actual material variance must be visible.
* Manual correction must be audit logged.
* Batch data must reduce inventory.

---

# 11. Store / Inventory Team Journey

## 11.1 Purpose

Store team manages raw material stock.

## 11.2 Inventory Flow

1. Store user logs in.
2. Opens material dashboard.
3. Enters material inward.
4. Records weighbridge slip if available.
5. Updates stock.
6. Reviews stock balance.
7. Handles batch consumption.
8. Handles stock adjustment.
9. Requests negative stock approval if needed.
10. Generates stock report.

## 11.3 Negative Stock Flow

1. User tries to consume more than available stock.
2. System shows stock shortage warning.
3. User enters reason.
4. Request goes to authorized approver.
5. If approved, negative stock transaction is saved.
6. If rejected, transaction is blocked.
7. Audit log is saved.

## 11.4 Store Main Actions

* Add material inward
* Add weighbridge entry
* View stock ledger
* Adjust stock
* Transfer stock
* Request negative stock approval
* Export stock report

---

# 12. Accounts Team Journey

## 12.1 Purpose

Accounts team handles GST invoice, receipts, ledger, and Tally export.

## 12.2 Accounts Flow

1. Accounts user logs in.
2. Opens completed challans.
3. Selects challans for invoicing.
4. Creates GST invoice.
5. System calculates CGST/SGST/IGST.
6. Invoice updates customer outstanding.
7. Invoice is shared through WhatsApp API/email/PDF.
8. Payment receipt is entered.
9. Receipt adjusts outstanding.
10. Data is exported to Tally.

## 12.3 Phase 1 Accounts Scope

Phase 1 includes:

* GST invoice
* E-invoice-ready fields
* E-way bill-ready fields
* Receipt entry
* Customer outstanding
* Tally-ready export
* Invoice PDF
* Payment report

## 12.4 Accounts Main Actions

* Create invoice
* Cancel invoice with approval
* Enter receipt
* Adjust advance
* View customer ledger
* Export Tally data
* View outstanding
* Send payment reminder

---

# 13. QC / Lab Team Journey

## 13.1 Purpose

QC team manages mix design, testing, and concrete quality records.

## 13.2 QC Flow

1. QC user logs in.
2. Creates or reviews mix design.
3. Sends mix design for approval.
4. Approved mix becomes active.
5. Slump test is recorded.
6. Cube sample is created.
7. Test reminders are generated.
8. 7-day / 28-day results are entered.
9. Certificate is generated.
10. Failed result creates NCR.

## 13.3 Phase 1 QC Scope

Phase 1 includes:

* Basic mix design
* Approved mix status
* Basic quality fields if needed

Full QC/lab module comes in Phase 2.

## 13.4 QC Main Actions

* Create mix design
* Approve/reject mix design if permitted
* Record slump
* Record cube test
* Generate certificate
* Raise NCR

---

# 14. Driver Journey

## 14.1 Purpose

Driver completes assigned trip and delivery confirmation.

## 14.2 Phase 1 Driver Flow

Phase 1 does not include full driver app.

Driver updates can be entered by dispatch team.

## 14.3 Phase 2 Driver App Flow

1. Driver logs in.
2. Sees assigned trip.
3. Confirms vehicle checklist.
4. Starts trip.
5. Navigates to site.
6. Marks reached site.
7. Marks pour started.
8. Marks pour completed.
9. Captures customer signature.
10. Uploads delivery photo.
11. Records return quantity.
12. Completes trip.

## 14.4 Driver App Data

* Trip ID
* Vehicle
* Customer
* Site
* Grade
* Quantity
* Contact person
* Navigation link
* Status
* Signature
* Photo
* Remarks

---

# 15. Support Staff Journey

## 15.1 Purpose

Support staff helps tenants but must not access data without control.

## 15.2 Support Access Flow

1. Tenant raises support request.
2. Support staff requests access.
3. Tenant admin or Super Admin grants support access.
4. Support staff enters support mode.
5. All support actions are audit logged.
6. Access expires automatically.

## 15.3 Support Rules

* Support access must be time-limited.
* Support user must not export sensitive data unless permitted.
* Every action must be logged.
* Tenant should be able to see support access history.

---

# 16. Main End-to-End Workflows

## 16.1 SaaS Tenant Onboarding Workflow

1. Super Admin creates tenant.
2. Assigns subscription plan.
3. Tenant Admin receives login.
4. Tenant Admin completes company setup.
5. Plant is created.
6. Users and roles are created.
7. Master data is added.
8. Tenant starts operation.

---

## 16.2 Daily RMC Operation Workflow

1. Orders are confirmed.
2. Credit check is passed.
3. Plant manager prepares production plan.
4. Dispatch assigns vehicle.
5. Operator batches concrete.
6. Delivery challan is generated.
7. Vehicle leaves plant.
8. Delivery is completed.
9. Challan becomes billable.
10. Invoice is generated.
11. Payment is collected.
12. Reports are updated.

---

## 16.3 Offline Plant Workflow

1. Internet goes down.
2. Standalone app switches to offline mode.
3. Plant continues essential work.
4. Local records are saved.
5. Local challan numbers are reserved.
6. Internet returns.
7. Sync starts.
8. Cloud is updated.
9. Conflicts are shown if any.
10. Authorized user resolves conflicts.

---

## 16.4 WhatsApp Notification Workflow

1. Trigger event happens.
2. System selects approved template.
3. Variables are filled.
4. Message is sent through WhatsApp API.
5. Delivery status is stored.
6. Failed messages are retried.
7. Message log is visible.

Trigger examples:

* Quotation approved
* Order confirmed
* Vehicle dispatched
* Challan generated
* Invoice generated
* Payment reminder
* Subscription alert

---

# 17. Workflow Priority for Phase 1

Phase 1 must design these workflows first:

1. SaaS tenant onboarding
2. Company and plant setup
3. User and role setup
4. Customer and site creation
5. Quotation to order
6. Credit limit hold at order booking
7. Production planning
8. Dispatch and delivery challan
9. Manual batch ticket
10. Inventory consumption
11. GST invoice
12. Receipt and outstanding
13. Offline sync
14. WhatsApp API message log
15. Tally-ready export

---

# 18. Design Acceptance Criteria for This Document

This user journey document is accepted when:

1. Every main user role has a defined journey.
2. SaaS tenant onboarding is defined.
3. RMC daily operation workflow is defined.
4. Credit hold workflow is defined.
5. Dispatch workflow is defined.
6. Batching workflow is defined.
7. Inventory and negative stock workflow is defined.
8. Billing and receipt workflow is defined.
9. Offline sync workflow is defined.
10. WhatsApp workflow is defined.
11. Phase 1 workflow priority is clearly listed.

---

# 19. Next Design Document

Next document to prepare:

**Design Document 3: Module Navigation Design**

This will define the sidebar/menu structure for:

* Super Admin Portal
* Tenant Admin Portal
* Plant Operations Portal
* Standalone Plant App
* Future Mobile Apps
