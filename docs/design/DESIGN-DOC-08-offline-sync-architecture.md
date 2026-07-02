# RMC Plant SaaS Software
## Design Stage Document 8: Offline Sync Architecture

## 1. Purpose of This Document

This document defines the offline sync architecture for the RMC Plant SaaS software.

The software must support:

- Cloud SaaS web application
- Standalone plant app
- Local plant database
- Offline operation during internet failure
- Safe document numbering
- Local transaction queue
- Cloud sync
- Conflict detection
- Conflict resolution
- Retry mechanism
- Local backup
- Audit trail

This document is critical because RMC plant operations cannot stop when internet is unavailable.

---

# 2. Offline Sync Goal

The goal is simple:

**The plant must continue operating even if internet is down.**

During offline mode, plant staff must still be able to:

- View downloaded orders
- View production plan
- Enter manual batch tickets
- Generate delivery challans
- Print challans
- Enter material inward
- Enter weighbridge records
- Enter stock transactions
- Record dispatch status
- Save local records
- Sync later when internet returns

---

# 3. Offline-First Design Principle

The standalone plant app must be designed as a **local-first plant operations app**.

This means:

1. Cloud remains the source of truth.
2. Plant app stores required operational data locally.
3. Plant app can create allowed offline transactions.
4. Offline transactions are queued locally.
5. Sync pushes local changes to cloud when online.
6. Cloud sends updated records back to plant app.
7. Conflicts are detected and resolved safely.

---

# 4. System Components

## 4.1 Cloud SaaS Server

Responsibilities:

- Tenant management
- User authentication
- Master data
- Orders
- Production plans
- Dispatch records
- Invoices
- Reports
- Audit logs
- Subscription control
- Integration processing
- Central sync API

---

## 4.2 Standalone Plant App

Responsibilities:

- Run at plant office
- Work online and offline
- Store local data
- Allow essential plant transactions
- Print challans and batch tickets
- Maintain sync queue
- Show sync status
- Perform manual sync
- Resolve conflicts if authorized

---

## 4.3 Local Database

Recommended local database:

```text
SQLite for small/simple plant app
PostgreSQL local instance for heavy plant operations
```

Phase 1 recommendation:

```text
SQLite
```

Reason:

- Simple installation
- Easy backup
- Good for standalone desktop app
- Lower maintenance
- Suitable for Phase 1 offline operations

Future enterprise option:

```text
Local PostgreSQL
```

---

## 4.4 Sync Service

The standalone plant app must include a sync service.

Responsibilities:

- Detect online/offline status
- Pull cloud changes
- Push local changes
- Retry failed sync
- Detect conflicts
- Record sync logs
- Update local sync status

---

# 5. Online / Offline Modes

## 5.1 Online Mode

When internet is available:

- User works normally.
- Data can be saved directly to cloud.
- Local copy is updated.
- Sync queue remains empty or minimal.
- WhatsApp API can send messages.
- Cloud approvals can happen.
- Dashboard shows live data.

---

## 5.2 Offline Mode

When internet is unavailable:

- App shows clear offline badge.
- User can continue only allowed offline actions.
- Records are saved locally.
- Records are marked as pending sync.
- Cloud-only actions are disabled.
- WhatsApp API sending is queued or disabled.
- Subscription changes are disabled.
- Cross-plant reports are disabled.

---

## 5.3 Syncing Mode

When internet returns:

- App changes status to syncing.
- Pending local records are pushed.
- Cloud changes are pulled.
- Conflicts are detected.
- Success/failure count is shown.
- Last sync time is updated.

---

# 6. Offline Status Display

Standalone app header must always show:

```text
Plant Name | User | Online/Offline | Last Sync | Pending Sync | Manual Sync
```

Status values:

```text
Online
Offline
Syncing
Sync Failed
Conflict Found
```

Required visible fields:

- Last sync time
- Pending upload count
- Pending download count
- Failed sync count
- Conflict count
- Manual sync button

---

# 7. Offline Allowed Actions

## 7.1 Phase 1 Offline Allowed

The following actions must be allowed offline in Phase 1:

### Orders

- View downloaded orders
- View today’s production plan
- View credit hold status
- View order details

### Production

- View batch queue
- Start local batch entry
- Enter manual batch ticket
- Print batch ticket

### Dispatch

- Assign vehicle if local data is available
- Generate delivery challan using reserved number
- Print delivery challan
- Update dispatch status locally
- Mark delivered locally
- Record return quantity locally

### Inventory

- View local stock balance
- Enter material inward
- Enter weighbridge record
- Enter stock adjustment request
- Request negative stock approval locally if approval is cached or queue for cloud approval

### Sync

- View pending sync
- Retry sync
- View failed records
- View conflict records
- Create local backup

---

# 8. Offline Restricted Actions

The following actions must not be allowed offline in Phase 1:

- Create new tenant
- Change subscription plan
- Add/edit SaaS billing
- Change global module settings
- Change payment gateway settings
- Direct WhatsApp API sending
- Direct Tally export upload
- Direct e-invoice API
- Direct e-way bill API
- Cross-plant reports
- Live GPS tracking
- Non-cached approvals
- User permission changes unless specifically allowed

---

# 9. Local Data Cache

The standalone app must cache required operational data locally.

## 9.1 Required Cached Data

- Tenant details
- Company details
- Plant details
- Logged-in user profile
- User permissions
- Plant settings
- Number reservations
- Customers
- Sites/projects
- Materials
- Stock balances
- Vehicles
- Drivers
- Concrete grades
- Mix designs
- Today’s orders
- Upcoming scheduled orders
- Production plans
- Batch queue
- Dispatch records
- Recent challans
- Recent batch tickets
- Recent inventory transactions

---

## 9.2 Cache Scope

The app should not download unnecessary full tenant data.

Recommended cache scope:

```text
Assigned plant only
Today + configurable upcoming days
Recent completed transactions
Required masters
```

Default Phase 1 cache window:

```text
Past 7 days + next 7 days
```

This can be configurable per tenant.

---

# 10. Sync Direction

The sync process must support two directions.

## 10.1 Pull Sync

Cloud to local.

Used for:

- Updated orders
- Updated customers
- Updated sites
- Updated vehicles
- Updated drivers
- Updated materials
- Updated stock balances
- Updated production plans
- Updated approvals
- Updated settings
- Cancelled records

API:

```text
GET /api/v1/sync/pull?since_token=token
```

---

## 10.2 Push Sync

Local to cloud.

Used for:

- Local batch tickets
- Local delivery challans
- Local dispatch updates
- Local material inward
- Local weighbridge entries
- Local stock transactions
- Local delivery proof
- Local sync logs

API:

```text
POST /api/v1/sync/push
```

---

# 11. Sync Lifecycle

## 11.1 Initial Setup Sync

When the standalone app is first installed:

1. User logs in online.
2. Device is registered.
3. Plant is selected.
4. App downloads bootstrap data.
5. Local database is created.
6. Number reservations are downloaded.
7. App becomes ready for offline use.

API:

```text
POST /api/v1/sync/devices/register
GET /api/v1/sync/bootstrap
```

---

## 11.2 Normal Sync Cycle

1. Check internet.
2. Authenticate user/device.
3. Push local pending records.
4. Pull cloud changes.
5. Apply cloud changes locally.
6. Mark synced records.
7. Update sync token.
8. Update last sync time.
9. Show success/failure summary.

---

## 11.3 Failed Sync Cycle

If sync fails:

1. Record failure reason.
2. Increment retry count.
3. Keep record pending.
4. Show failed sync count.
5. Allow manual retry.
6. Do not delete local data.

---

# 12. Sync Queue Design

The local app must maintain a sync queue.

## 12.1 Sync Queue Fields

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

## 12.2 Entities That Use Sync Queue

- delivery_challans
- dispatches
- batch_tickets
- batch_ticket_materials
- material_inwards
- weighbridge_entries
- stock_transactions
- negative_stock_requests
- delivery_status_history
- local audit logs

---

# 13. Local IDs and Cloud IDs

Every offline-created record must have:

```text
local_id
cloud_id
```

Before sync:

```text
local_id = generated locally
cloud_id = null
```

After successful sync:

```text
local_id = preserved
cloud_id = server UUID
```

This allows the local app to map offline records to cloud records after sync.

---

# 14. Offline Document Numbering

Offline numbering is one of the most important safety areas.

## 14.1 Problem

If the plant generates challans offline, the cloud must not later create duplicate numbers.

## 14.2 Solution

Use cloud-issued number reservations.

The cloud reserves number blocks for each plant/device.

Example:

```text
Plant A / Device 1 / Delivery Challan
DC-A-2026-0001 to DC-A-2026-0100
```

The local app can use only reserved numbers while offline.

---

## 14.3 Number Reservation Table

Use:

```text
local_number_reservations
```

Fields:

```text
tenant_id
plant_id
device_id
document_type
prefix
number_from
number_to
used_count
status
```

---

## 14.4 Document Types Requiring Offline Number Reservation

- Delivery challan
- Batch ticket
- Weighbridge slip
- Material inward
- Stock adjustment request
- Receipt if offline receipt is allowed

Phase 1 default:

```text
Offline receipt creation should be limited or approval-based.
```

---

## 14.5 Number Reservation API

```text
POST /api/v1/sync/number-reservations
GET  /api/v1/sync/number-reservations
```

---

## 14.6 Number Exhaustion Rule

If offline reserved numbers are exhausted:

- App must show warning.
- App must prevent new offline challan generation.
- User must go online and request new reservation.
- Admin override should not create duplicate numbers.

---

# 15. Conflict Detection

Conflicts happen when the same record changes in cloud and local before sync.

## 15.1 Conflict Examples

- Order cancelled in cloud, but local app dispatches it offline.
- Customer blocked in cloud, but local app creates dispatch offline.
- Vehicle assigned in cloud, but local app assigns same vehicle offline.
- Stock updated in cloud and local at same time.
- Challan number already used.
- Mix design changed in cloud while offline batch uses old version.

---

## 15.2 Conflict Detection Rules

Use:

```text
version
updated_at
sync_token
record_status
```

When local record syncs:

- Compare local base version with cloud current version.
- If cloud changed after local cache, mark conflict.
- Do not overwrite automatically.
- Create sync conflict record.

---

# 16. Conflict Resolution

## 16.1 Resolution Options

Allowed resolution actions:

```text
use_cloud
use_local
manual_merge
cancel_local_transaction
```

---

## 16.2 Who Can Resolve Conflicts

Conflict resolution should be allowed only for authorized roles:

- Company Owner
- Company Admin
- Plant Manager
- Authorized Support Staff with audited access

---

## 16.3 Conflict Resolution Screen Must Show

- Entity name
- Local record
- Cloud record
- Difference summary
- Conflict reason
- Business impact
- Suggested action
- Approval buttons

---

## 16.4 Conflict Audit

Every conflict resolution must be audit logged.

Audit fields:

```text
conflict_id
resolved_by
resolution_action
old_local_value
old_cloud_value
final_value
resolved_at
remarks
```

---

# 17. Sync Conflict Table

Use:

```text
sync_conflicts
```

Important fields:

```text
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
```

Resolution status:

```text
open
resolved
ignored
cancelled
```

---

# 18. Offline Approval Handling

Approvals are sensitive and must be handled carefully.

## 18.1 Credit Hold Approval

Credit limit blocks at order booking.

Offline rule:

- If order is already credit-approved before offline mode, it can proceed.
- If order is credit hold and approval is not cached, it cannot be confirmed offline.
- Offline app can create approval request, but final approval requires cloud sync unless approver is locally authorized and policy allows.

Recommended Phase 1:

```text
Credit hold release requires online/cloud approval.
```

---

## 18.2 Negative Stock Approval

Negative stock is allowed only with approval.

Offline rule:

- If stock goes negative offline, create negative stock request.
- If local authorized approver is present, approval can be captured locally.
- Otherwise transaction stays pending approval.
- Sync must push approval request to cloud.

Recommended Phase 1:

```text
Allow negative stock request offline, but require cloud approval before final stock posting unless explicitly allowed by tenant setting.
```

---

# 19. Offline Inventory Handling

Inventory is high-risk because stock can change in both cloud and local.

## 19.1 Local Stock Display

Offline stock balance should show:

```text
Last synced stock
+ local inward
- local consumption
= estimated local stock
```

Screen must clearly show:

```text
Estimated offline stock, last synced at [time]
```

---

## 19.2 Batch Consumption Offline

When batch ticket is entered offline:

1. Local material consumption is calculated.
2. Local stock estimate is reduced.
3. Stock transaction is queued.
4. If negative stock occurs, approval rule applies.
5. Sync later updates cloud stock.

---

## 19.3 Stock Conflict

If cloud stock changed while offline, sync must:

- Recalculate stock
- Detect mismatch
- Create conflict or adjustment requirement
- Keep audit trail

---

# 20. Offline Dispatch Handling

## 20.1 Offline Dispatch Allowed

If order and production plan are already cached, dispatch can continue offline.

Allowed:

- Assign vehicle
- Generate challan
- Mark left plant
- Mark reached site
- Mark completed
- Record return quantity

---

## 20.2 Offline Dispatch Restrictions

Do not allow:

- Dispatch of cancelled cloud order after conflict detected
- Dispatch without approved mix design
- Dispatch without reserved challan number
- Dispatch for blocked/credit-hold order unless already approved

---

# 21. Offline Batch Ticket Handling

## 21.1 Phase 1

Phase 1 supports manual batch ticket entry offline.

Required fields:

- Batch ticket number
- Order
- Vehicle
- Driver
- Grade
- Mix code
- Quantity
- Batch start time
- Batch end time
- Material actuals
- Operator
- Remarks

---

## 21.2 Batch Ticket Sync

When synced:

1. Cloud validates order.
2. Cloud validates mix design.
3. Cloud validates duplicate ticket number.
4. Cloud saves batch ticket.
5. Cloud updates inventory consumption.
6. Cloud returns cloud_id.
7. Local app marks synced.

---

# 22. Offline WhatsApp Handling

WhatsApp API requires internet.

Offline behavior:

- WhatsApp messages cannot be sent immediately.
- Message trigger can be queued.
- Once online, queued messages can be sent.
- Failed messages must be logged.

Queued events:

- Challan generated
- Invoice generated
- Dispatch started
- Payment reminder if triggered locally

---

# 23. Offline Tally Export Handling

Phase 1 Tally export is file/export-ready.

Offline behavior:

- Local export preview can be generated only from local data.
- Final official export should happen from cloud after sync.
- Tally export records must show whether data includes offline unsynced transactions.

Recommended rule:

```text
Official Tally export should be generated from cloud after sync completion.
```

---

# 24. Sync API Design

## 24.1 Device Registration

```text
POST /api/v1/sync/devices/register
```

Request:

```json
{
  "device_name": "Plant Office PC",
  "device_type": "standalone_plant_app",
  "plant_id": "uuid",
  "device_identifier": "machine-generated-id"
}
```

---

## 24.2 Bootstrap Sync

```text
GET /api/v1/sync/bootstrap
```

Returns:

- Tenant settings
- Plant settings
- User permissions
- Number reservations
- Customers
- Sites
- Materials
- Stock balances
- Vehicles
- Drivers
- Grades
- Mix designs
- Orders
- Production plans
- Batch queue

---

## 24.3 Push Sync

```text
POST /api/v1/sync/push
```

Request:

```json
{
  "device_id": "uuid",
  "sync_token": "last-token",
  "changes": [
    {
      "entity_name": "delivery_challans",
      "operation": "create",
      "local_id": "local-uuid",
      "base_version": 1,
      "payload": {}
    }
  ]
}
```

Response:

```json
{
  "accepted": [
    {
      "local_id": "local-uuid",
      "cloud_id": "cloud-uuid",
      "entity_name": "delivery_challans"
    }
  ],
  "failed": [],
  "conflicts": []
}
```

---

## 24.4 Pull Sync

```text
GET /api/v1/sync/pull?since_token=token
```

Response:

```json
{
  "sync_token": "new-token",
  "changes": [
    {
      "entity_name": "orders",
      "operation": "update",
      "cloud_id": "uuid",
      "version": 4,
      "payload": {}
    }
  ]
}
```

---

## 24.5 Conflict Resolution

```text
POST /api/v1/sync/conflicts/{conflict_id}/resolve
```

Request:

```json
{
  "resolution_action": "use_cloud",
  "remarks": "Cloud order was cancelled before local dispatch synced"
}
```

---

# 25. Sync Frequency

## 25.1 Online Normal Mode

Recommended sync frequency:

```text
Every 1 to 5 minutes
```

For heavy operations:

```text
Event-based immediate sync for critical records
```

Critical records:

- Dispatch status
- Delivery challans
- Batch tickets
- Stock transactions
- Payments

---

## 25.2 Offline Recovery Mode

When internet returns:

1. Push critical transactions first.
2. Pull latest cloud changes.
3. Resolve conflicts.
4. Pull reports/dashboard data.

Priority order:

```text
1. Delivery challans
2. Dispatch updates
3. Batch tickets
4. Stock transactions
5. Weighbridge entries
6. Material inward
7. Audit logs
8. Notification triggers
```

---

# 26. Sync Retry Rules

Retry strategy:

```text
Retry 1: after 1 minute
Retry 2: after 5 minutes
Retry 3: after 15 minutes
Retry 4: after 30 minutes
Then manual retry required
```

Failed records must show:

- Entity
- Reference number
- Error reason
- Retry count
- Last retry time
- Retry button

---

# 27. Local Backup

Standalone app must support local backup.

## 27.1 Backup Types

- Automatic daily local backup
- Manual backup
- Pre-sync backup
- Pre-update backup

## 27.2 Backup Storage

Backups should be stored:

- Local machine path
- Optional external drive
- Optional cloud backup after sync

## 27.3 Backup Retention

Default:

```text
Keep last 7 daily backups
Keep last 4 weekly backups
```

---

# 28. Data Safety Rules

The standalone app must never:

- Delete unsynced local records automatically
- Overwrite local data without sync status check
- Generate unreserved offline document numbers
- Hide sync failures
- Allow silent conflict overwrite
- Allow unsupported offline tenant-wide settings changes

---

# 29. Offline Security

## 29.1 Local Login

When offline:

- Only users cached on that plant device can log in.
- Password/session validation must use secure cached credentials.
- Deactivated users should be blocked after next sync.
- Offline login expiry policy should exist.

Recommended offline session validity:

```text
Maximum 3 days without online validation
```

Configurable by tenant.

---

## 29.2 Local Data Protection

Local database must be protected.

Required:

- Device registration
- User login
- Role permission checks
- Encrypted local database where possible
- No plain text passwords
- No plain text API secrets
- Local audit logs

---

# 30. Offline Audit Logs

Offline actions must be audit logged locally first, then synced.

Audit records should include:

- User
- Device
- Plant
- Action
- Entity
- Old value
- New value
- Date/time
- Offline flag
- Sync status

---

# 31. Device Management

Tenant Admin / Plant Manager must see registered devices.

Device screen should show:

- Device name
- Plant
- Device type
- Last seen
- Last sync
- Pending sync count
- Status
- App version

Actions:

- Activate device
- Deactivate device
- Force logout
- Revoke sync
- View sync logs

---

# 32. Sync Dashboard Design

Sync dashboard must show:

## KPI Cards

- Last sync time
- Pending uploads
- Pending downloads
- Failed records
- Conflicts
- Local backup status

## Tabs

- Pending Uploads
- Failed Sync
- Conflicts
- Sync History
- Number Reservations
- Local Backup
- Device Info

---

# 33. Sync Logs

Every sync run must create log.

Fields:

```text
sync_run_id
tenant_id
plant_id
device_id
started_at
completed_at
push_count
pull_count
success_count
failed_count
conflict_count
status
error_message
```

Status:

```text
success
partial_success
failed
cancelled
```

---

# 34. Integration With API Design

This offline sync architecture uses APIs defined in Design Doc 7:

- `POST /api/v1/sync/devices/register`
- `GET /api/v1/sync/bootstrap`
- `POST /api/v1/sync/push`
- `GET /api/v1/sync/pull`
- `GET /api/v1/sync/conflicts`
- `POST /api/v1/sync/conflicts/{conflict_id}/resolve`
- `POST /api/v1/sync/number-reservations`

---

# 35. Consistency Note From Doc 7

During final API/database implementation, invoice line examples should use generic:

```text
quantity
```

instead of:

```text
quantity_m3
```

Reason:

Invoice lines can include:

- Concrete supplied by m³
- Pumping charged by hour/trip
- Transport charged by trip/km
- Waiting charges
- Other service items

Concrete-specific entities can still use `quantity_m3`.

---

# 36. Phase 1 Offline Scope

Phase 1 must include:

- Local plant app
- Local database
- Device registration
- Bootstrap sync
- Pull sync
- Push sync
- Manual sync
- Number reservation
- Offline delivery challan
- Offline manual batch ticket
- Offline dispatch status update
- Offline material inward
- Offline weighbridge entry
- Offline stock transaction queue
- Sync conflict detection
- Basic conflict resolution
- Sync dashboard
- Local backup
- Offline audit logs

---

# 37. Phase 2 Offline Enhancements

Phase 2 should add:

- Driver app offline sync
- Sales app offline sync
- Direct batching import sync
- Direct weighbridge integration sync
- GPS event sync
- QC/lab offline entry
- Advanced approval sync
- Better conflict merge tools

---

# 38. Phase 3 Offline Enhancements

Phase 3 should add:

- Finance approval sync
- Credit/debit note sync
- Payment gateway callback reconciliation
- Direct Tally sync safety
- E-invoice/e-way bill API retry logs
- Advanced compliance sync logs

---

# 39. Offline Sync Acceptance Criteria

This offline sync design is accepted when:

1. Offline purpose is defined.
2. Standalone app responsibility is defined.
3. Local database approach is defined.
4. Online/offline/syncing modes are defined.
5. Offline allowed actions are listed.
6. Offline restricted actions are listed.
7. Local cached data is defined.
8. Push and pull sync are defined.
9. Sync queue design is defined.
10. Local ID and cloud ID mapping is defined.
11. Offline document numbering is defined.
12. Number reservation rule is defined.
13. Conflict detection is defined.
14. Conflict resolution is defined.
15. Offline approval handling is defined.
16. Offline inventory handling is defined.
17. Offline dispatch handling is defined.
18. Offline batch ticket handling is defined.
19. WhatsApp offline behavior is defined.
20. Tally export offline behavior is defined.
21. Sync API usage is defined.
22. Retry rules are defined.
23. Local backup is defined.
24. Offline security is defined.
25. Device management is defined.
26. Sync dashboard is defined.
27. Phase-wise offline scope is separated.

---

# 40. Next Design Document

Next document to prepare:

**Design Document 9: SaaS Multi-Tenant Architecture**

This will define:

- Tenant isolation model
- Shared application architecture
- Tenant-aware database access
- Subscription enforcement
- Module plan enforcement
- Tenant settings
- Super Admin control
- Support access model
- Tenant backup/export strategy
