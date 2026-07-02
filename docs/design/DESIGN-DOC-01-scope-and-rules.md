# RMC Plant SaaS Software

## Design Stage Document 1: Scope and Rules

## 1. Current Project Stage

Project: RMC Plant SaaS Standalone + Web-Based Software

Current stage: **Design**

Completed stages:

* Idea
* Requirement

Pending stages:

* Development
* Testing
* Deployment
* Training
* Launch
* Support

---

# 2. Design Stage Goal

The goal of the Design Stage is to convert the approved requirements into a clear software design before development starts.

The design must clearly explain:

* User flow
* Module flow
* Screen structure
* Dashboard layout
* SaaS architecture
* Standalone plant app architecture
* Offline sync flow
* Database structure
* API structure
* Integration structure
* Security and audit design
* Report and print layout structure

---

# 3. Design Stage Rule

No development should start until design is completed and signed off.

The correct order is:

Requirement → Design → Development

So development must wait until:

* UI/UX design is complete
* Workflow diagrams are complete
* Database design is complete
* API design is complete
* Offline sync design is complete
* Multi-tenant SaaS design is complete
* Integration design is complete
* Report/PDF design is complete

---

# 4. Product Design Direction

The software must be designed as a:

**Multi-Tenant SaaS RMC Plant Operating System**

It must support:

* Many RMC companies
* Multiple plants per company
* Standalone plant app
* Cloud web app
* Future mobile apps
* Indian language support
* Direct WhatsApp API
* Tally integration
* Batching integration-ready architecture
* Weighbridge integration-ready architecture
* GPS integration-ready architecture
* E-invoice/e-way bill-ready fields in Phase 1
* Direct e-invoice/e-way API in Phase 3

---

# 5. Design Principles

## 5.1 Simple for Plant Staff

Plant operators and dispatch users must be able to use the software quickly.

Design must avoid unnecessary complexity.

Important screens must use:

* Large buttons
* Clear status colors
* Simple tables
* Fast search
* Keyboard-friendly data entry
* Printable output
* Offline status indicator

---

## 5.2 Powerful for Owners

Owners and managers must get strong dashboards.

Dashboard must show:

* Today's orders
* Today's production
* Today's dispatch
* Material stock
* Customer outstanding
* Delayed deliveries
* Revenue
* Plant performance
* Credit blocked orders
* Pending approvals

---

## 5.3 SaaS-Ready From Day One

Every design must support tenant separation.

Each tenant must have:

* Own company settings
* Own plants
* Own users
* Own customers
* Own invoices
* Own reports
* Own integrations
* Own language settings
* Own subscription plan

---

## 5.4 Offline-First Plant Operation

Standalone plant app must clearly show:

* Online/offline status
* Last sync time
* Pending sync records
* Failed sync records
* Conflict records
* Manual sync button

Plant staff must be able to continue essential work during internet failure.

---

## 5.5 Advanced but Practical

The design must be advanced enough for SaaS scale, but practical enough to develop phase by phase.

Phase 1 design should not block future features.

---

# 6. Design Outputs Required

The Design Stage must produce the following documents:

1. User journey and workflow design
2. Module navigation map
3. Screen list
4. Screen layout specification
5. Database entity design
6. API route design
7. Offline sync design
8. SaaS tenant architecture
9. Integration architecture
10. Security and audit design
11. Report and PDF design
12. Final design sign-off checklist

---

# 7. Design Stage Acceptance Criteria

Design Stage is complete only when:

1. All user journeys are mapped.
2. All Phase 1 screens are listed.
3. Screen layouts are defined.
4. Navigation structure is finalized.
5. Database tables are listed.
6. API modules are listed.
7. Offline sync architecture is defined.
8. SaaS multi-tenant design is defined.
9. Integration design is defined.
10. Security and audit design is defined.
11. Reports and print formats are designed.
12. Owner gives design sign-off.

---

# 8. Next Design Document

Next document to prepare:

**Design Document 2: User Journey and Workflow Design**

This will define how each user moves through the system from login to daily work completion.
