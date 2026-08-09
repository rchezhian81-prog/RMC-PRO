# RMC Plant SaaS Software

## Design Stage Document 3: Module Navigation Design

## 1. Purpose of This Document

This document defines the navigation structure (menus, sidebars, landing pages) for every portal and app in the RMC Plant SaaS software.

It defines navigation for:

* Super Admin Portal
* Tenant Web Portal
* Company Owner view
* Plant Operations Portal
* Standalone Plant App
* Sales, Dispatch, Batching, Accounts, Store, QC, and Fleet menus
* Future Driver App, Sales App, and Customer Portal

It also defines:

* Role-based landing pages
* Phase-wise navigation scope
* Navigation visibility rules

This document is part of the **Design Stage**. It is aligned with the roles defined in Design Doc 2 and the screens listed in Design Doc 4. No development starts until design is completed and signed off.

---

# 2. Navigation Design Principles

1. **Role-based:** each user sees only the menus their role permits.
2. **Tenant-aware:** all tenant navigation is isolated; no cross-tenant menu or data.
3. **Plan/module-aware:** menus appear only if the tenant's subscription plan and module control enable them.
4. **Phase-aware:** Phase 2–5 menus are hidden/disabled in Phase 1 (but reserved in structure).
5. **Offline-aware:** the Standalone Plant App exposes only offline-capable menus plus a Sync Center.
6. **Simple at the plant, powerful at the office:** plant apps use few, large menu items; office/owner portals use richer navigation.
7. **Consistent landing:** every role lands on the screen most relevant to its daily work.

---

# 3. Navigation Architecture Overview

The platform has five active navigation surfaces in Phase 1:

| # | Surface | Primary Users |
|---|---------|---------------|
| 1 | Super Admin Portal | Super Admin, Support Staff |
| 2 | Tenant Web Portal | Tenant Admin, Owner, Sales, Accounts, Managers |
| 3 | Company Owner view (within Tenant Portal) | Company Owner |
| 4 | Plant Operations Portal (within Tenant Portal) | Plant Manager, Dispatch, Store, QC |
| 5 | Standalone Plant App (offline PWA) | Batching Operator, Dispatch, Store |

Future surfaces (Phase 2 / Phase 4): Driver App, Sales App, Customer Portal.

---

# 4. Super Admin Portal Navigation

Sidebar menu:

* Dashboard
* Tenants
  * Tenant List
  * Add Tenant
  * Tenant Detail
* Subscription Plans
* Module Control
* SaaS Billing
  * SaaS Invoices
  * Subscription Payments
  * Failed Payments / Renewals
* Coupons
* Payment Gateway Settings
* Support Access
* System Monitoring
* Global Settings
* Audit Log

Landing page: **Super Admin Dashboard**.

---

# 5. Tenant Web Portal Navigation

Top-level sidebar for the tenant cloud web app. Items are filtered by role and plan.

* Dashboard (role-based)
* Sales
* Orders
* Production
* Dispatch
* Inventory
* Weighbridge
* Billing & Payments
* Tally Export
* WhatsApp
* Approvals
* Reports
* Masters
* Settings & Administration
* Notifications
* Audit Log

Each top-level item expands into the sub-menus defined in Sections 7–11.

---

# 6. Company Owner Navigation

The Owner uses the Tenant Web Portal but lands on a management-first view.

Owner menu (read + approve focus):

* Owner Dashboard
* Approvals (credit hold, negative stock, discount, invoice cancellation)
* Reports & MIS
* Sales Summary
* Production Summary
* Dispatch Summary
* Billing & Outstanding
* Plant Comparison
* Settings (view / limited)

Landing page: **Owner Dashboard**.

---

# 7. Plant Operations Portal Navigation

A plant-scoped view for on-site managers (web). Data is filtered to the assigned plant.

* Plant Dashboard
* Today's Orders
* Production
  * Production Plan
  * Batch Queue
  * Batch Tickets
  * Material Variance
* Dispatch
  * Dispatch Board
  * Vehicle Allocation
  * Delivery Challans
  * Active Trips
  * Return / Rejected Concrete
* Inventory
  * Stock Balance
  * Material Inward
  * Stock Ledger
  * Negative Stock Requests
* Weighbridge
* Approvals (negative stock — if permitted)
* Plant Reports

Landing page: **Plant Dashboard**.

---

# 8. Standalone Plant App Navigation

Simple, offline-first navigation (large buttons; bottom or grid nav). Only offline-capable functions plus sync.

* Home / Today
* Orders
* Batch Queue
* Manual Batch Entry
* Dispatch Board
* Challan Print
* Inventory
* Weighbridge
* Sync Center
  * Sync Dashboard
  * Pending Sync
  * Failed Sync
  * Conflict Resolution
  * Local Backup

Landing page: **Home / Today**.

> Note: The Standalone Plant App intentionally excludes GST invoicing. Invoices remain online-only (per SRS v1.4 §8 numbering rule); the plant app reserves challan numbers offline.

---

# 9. Role-Based Functional Menus

These are the sub-menus shown to each functional team inside the Tenant Web Portal.

## 9.1 Sales Menu

* Sales Dashboard
* Leads
* Follow-Ups
* Quotations
* Rate Contracts
* Orders (create / view)
* Customer Outstanding (view)

## 9.2 Dispatch Menu

* Dispatch Dashboard
* Dispatch Board
* Vehicle Allocation
* Delivery Challans
* Active Trips
* Return Concrete
* Rejected Load

## 9.3 Batching Menu

* Batch Queue
* Manual Batch Ticket
* Batch Ticket List
* Material Variance
* Mix Design (view approved)

## 9.4 Accounts Menu

* Billing Dashboard
* Challan → Invoice
* Invoices
* Receipts
* Customer Outstanding
* Outstanding Aging
* Tally Export
* Payment Reminders

## 9.5 Store / Inventory Menu

* Inventory Dashboard
* Stock Balance
* Material Inward
* Stock Ledger
* Stock Adjustment
* Negative Stock Requests
* Weighbridge Entry

## 9.6 QC / Lab Menu

* Mix Design
* Grade Master (view)
* (Phase 2) QC Dashboard, Slump, Cube Tests, Certificates, NCR

## 9.7 Fleet Menu

* Vehicle List
* Driver List
* Vehicle Document Expiry (insurance / fitness / permit / pollution)
* (Phase 2) GPS Tracking, Route History, Vehicle Maintenance

---

# 10. Masters Navigation

Grouped under **Masters** in the Tenant Web Portal:

* Customers
* Sites / Projects
* Materials
* Concrete Grades
* Mix Designs
* Vehicles
* Drivers
* Suppliers

---

# 11. Settings & Administration Navigation

Grouped under **Settings** (Tenant Admin access):

* Company Profile
* Legal Entities (multi-GSTIN)
* Plants
* Users
* Roles & Permissions
* Number Series
* GST Settings
* Language Settings
* Print Templates
* Integration Settings (Batching / Weighbridge / GPS / WhatsApp / Tally / Email / SMS / Payment Gateway)
* Subscription Status (view)
* Audit Log

---

# 12. Role-Based Landing Pages

| Role | Landing Page |
|------|--------------|
| Super Admin | Super Admin Dashboard |
| Support Staff | Support Access (scoped, time-limited) |
| Tenant / Company Admin | Tenant Setup Dashboard |
| Company Owner | Owner Dashboard |
| Plant Manager | Plant Dashboard |
| Sales Team | Sales Dashboard |
| Dispatch Team | Dispatch Board |
| Batching Operator | Standalone Batch Queue (Plant App) |
| Store / Inventory Team | Inventory Dashboard |
| Accounts Team | Billing Dashboard |
| QC / Lab Team | Mix Design / QC Screen |
| Driver (Phase 2) | Assigned Trip (Driver App) |

---

# 13. Future App Navigation (Phase 2 / Phase 4)

## 13.1 Driver App (Phase 2)

* Login
* Assigned Trip
* Vehicle Checklist
* Navigation
* Trip Status Update
* Signature Capture
* Photo Upload
* Return Quantity
* Trip Completion

## 13.2 Sales App (Phase 2)

* Sales Dashboard
* Leads
* Customer Visit
* Site Photo
* Follow-Up
* Quotation Request
* Order Booking
* Credit Hold Status

## 13.3 Customer Portal (Phase 4)

* Customer Dashboard
* Order Request
* Delivery Tracking
* Challan Download
* Invoice Download
* QC Certificate Download
* Outstanding Statement
* Complaints
* Online Payment

---

# 14. Phase-Wise Navigation Scope

## 14.1 Phase 1 (visible / active)

Super Admin Portal, Tenant Web Portal, Owner view, Plant Operations Portal, Standalone Plant App — with menus: Dashboard, Sales, Orders, Production, Dispatch, Inventory, Weighbridge, Billing & Payments (basic GST invoice + receipt + outstanding), Tally Export, WhatsApp, Approvals, Reports, Masters, Settings, Audit Log, Sync Center.

## 14.2 Phase 2 (add)

Driver App, Sales App, GPS Tracking menu, QC Full module menu, Purchase menu, Batching Integration menu, Vehicle Maintenance, Pump Management.

## 14.3 Phase 3 (add)

Credit Note, Debit Note, Full GST reports, E-Invoice API, E-Way Bill API, Payment Gateway Collection, Full Subscription Billing, Direct Tally Sync, API Error/Retry.

## 14.4 Phase 4 (add)

Customer Portal navigation (Section 13.3).

## 14.5 Phase 5 (add)

AI menus: AI Dashboard, AI Dispatch Suggestion, AI Material Forecast, AI QC Risk, AI Collection Priority, Profit-per-m³, Plant Ranking, Predictive Maintenance.

---

# 15. Navigation Visibility Rules

A menu item is shown only when ALL of these are true:

1. **Phase:** the feature belongs to a released phase.
2. **Plan:** the tenant's subscription plan includes the module.
3. **Module control:** Super Admin / Tenant has enabled the module.
4. **Role permission:** the user's role has at least "View" on that module.
5. **Plant scope:** for plant-scoped menus, the user is assigned to the plant.

Hidden menus must also be enforced at the API/server level (menu hiding alone is not security).

---

# 16. Acceptance Criteria for This Document

This document is complete when:

1. Super Admin Portal navigation is defined.
2. Tenant Web Portal navigation is defined.
3. Company Owner navigation is defined.
4. Plant Operations Portal navigation is defined.
5. Standalone Plant App navigation is defined.
6. Sales, Dispatch, Batching, Accounts, Store, QC, and Fleet menus are defined.
7. Masters and Settings navigation are defined.
8. Role-based landing pages are defined.
9. Future Driver App, Sales App, and Customer Portal navigation are defined.
10. Phase-wise navigation scope is defined.
11. Navigation visibility rules are defined.

---

# 17. Next Design Document

Next document to prepare:

**Design Document 5: Screen-by-Screen Layout Design**

This will define the actual layout structure for the most important Phase 1 screens.
