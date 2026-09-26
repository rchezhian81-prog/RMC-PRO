# Phase-2 close-out — driver phone screen, pumps, WhatsApp Business, GPS vendor feed

The four pieces that turned the last "partial" rows of the Phase-2 scope into
working features, and what the owner does to switch each one on. Nothing here
needs a developer; every step is a screen in the app or one command on the
server.

| Feature | Where in the app | Needs from outside |
|---|---|---|
| Driver phone screen (My Trips) | Dispatch → My Trips (driver) | Nothing — a phone with a browser |
| Pump management | Dispatch → Pumps | Nothing |
| WhatsApp Business automatic sending | Settings → WhatsApp Business | A Meta WhatsApp Business account (phone-number id + token) |
| GPS vendor feed | Settings → GPS vendor feed, Dispatch → Live Tracking | A tracking vendor that can POST JSON |

---

## 1. Driver phone screen (My Trips)

What it is: a driver signs in on the phone (the normal app address) and sees
only the deliveries assigned to them, with one big button per step — Left the
plant → Reached the site → Started pouring → Pour finished — plus Delayed and
Concrete coming back. With **Share my location** on, the phone streams its
position to Live Tracking while a trip is on the road. The office sees every
tap on the Dispatch Board exactly as if it had been made there.

Switch it on (once per company):

1. **Enable the module.** Admin portal → Tenants → the company → Modules →
   **Driver App (phone: My Trips)** → Enable. (`verify-app.sh` reports
   "driver app module".)
2. **Create the driver's login.** Setup → Users → New user: name, email (any
   unique address works, e.g. `ravi.driver@yourcompany.in`), a password, role
   **Driver**. The Driver role holds only "My Trips" — the phone opens nothing
   else.
3. **Link the login to the driver record.** Masters → Drivers → edit the driver
   → **Login account (for My Trips)** → choose the user → Save. One login per
   driver; the app refuses a second link and a login from another company.
4. **On the phone:** open the app address, sign in, the screen lands on My
   Trips. Tick **Share my location** and allow location when the phone asks.
   Add the page to the home screen for a one-tap open.

When a truck is loaded on the Dispatch Board with that driver selected, the trip
appears on the phone within 30 seconds (or on Refresh).

If the phone says "not linked yet", step 3 was skipped. If it says location
sharing is not in the plan, the company's **GPS Tracking** module is off; trips
still update, positions do not.

## 2. Pump management

Dispatch → Pumps. A pump is any vehicle whose **Type** is *Concrete pump* under
Masters → Vehicles (the demo seed adds one).

- **Pump register** — every pump, its operator, what it is doing now, open jobs,
  hours and m³ this month.
- **Plan a pump job** — pump, order (customer and site come from it), operator,
  date/time, pipeline length, charge basis (per m³ pumped, per pump hour, fixed,
  or included in the concrete rate) and rate. Job numbers use the `PJ-` series
  (Number Series → *Pump Job* to change the format).
- **Walk the job** — *Pump on site* → *Start pumping* → *Finish* (enter pumped
  m³; hours are worked out from the start time unless you enter them). A pump
  cannot pump on two jobs at once; a planned job can be edited or cancelled,
  a pumping or finished one is frozen.
- **Utilisation & pump-charge reconciliation** — per pump: jobs, pump hours,
  waiting hours, m³, charges; per order: the pump ₹/m³ the order bills against
  the m³ actually pumped, with findings such as *pump required but no job*,
  *pump charge billed but no job*, or pumped m³ more than 5 % away from
  delivered m³.

Permissions: `pump.view` and `pump.manage` (Plant Manager, Dispatch Manager and
Fleet Manager get both by default on a fresh company; for an existing company
tick them under Setup → Roles).

## 3. WhatsApp Business automatic sending

Today "Share on WhatsApp" opens a chat window and you press Send. With a
WhatsApp Business account connected, the quotation / challan / invoice /
receipt / credit note is **sent to the customer immediately** and the send log
(Reports → WhatsApp Log) shows *sent* with WhatsApp's message id, or *failed*
with the reason and a **Resend** button. The chat-window link stays as the
fallback.

### 3a. Get the account at Meta (one-time, ~30 minutes)

1. business.facebook.com → create or open your Meta Business account → add the
   **WhatsApp** product (Meta calls it the WhatsApp Business Platform / Cloud
   API). Register the business phone number (a number not already on the
   WhatsApp app; a new SIM is simplest).
2. Under **WhatsApp → API setup** copy the **Phone number ID** (a long number,
   not the phone number).
3. Create a **System User** (Business settings → Users → System users) with the
   `whatsapp_business_messaging` permission and generate a **permanent access
   token** (starts with `EAA…`). Copy it once; it is not shown again.
4. Recommended: under **Message templates** create a template in category
   *Utility*, language *English*, body exactly `{{1}}` (one variable), and wait
   for approval (minutes to a day). Meta only delivers free-text messages inside
   24 hours of the customer's last message; a template goes through any time,
   which is what an invoice notice needs.

### 3b. Connect it in the app

1. On the server, once: `cd /opt/rmc && sudo ./scripts/ops/cred-key-ensure.sh`
   (creates the key that seals the token at rest; the card tells you if it is
   missing).
2. Settings → **WhatsApp Business** → Connect account → paste the Phone number
   ID and the token, optionally the business number, the template name and
   language → Save connection.
3. Enter your own mobile → **Send test message**. The card says *delivered*
   and the message arrives on your phone.
4. Settings → **WhatsApp automatic sending** (the switch in the settings list)
   must be On (it is by default). Off = chat window only.

To disconnect: the **Disconnect** button (the stored token is deleted). To use
one account for the whole server instead of per company, set the `WHATSAPP_*`
lines in `.env.production` (see `.env.production.example`); a company's own
connection always wins over the server fallback.

## 4. GPS vendor feed

Settings → **GPS vendor feed** → *Issue key* → copy the key (shown once) and
give your tracking vendor, or your own device gateway:

- Endpoint: `POST https://api.<your domain>/api/v1/gps/ingest`
- Header: `X-RMC-GPS-KEY: <the key>` (or `?key=…` on the URL)
- Body: one position or a list, JSON — `vehicleNo` (registration, any spacing)
  or `deviceId`/`imei` (set the vehicle's *GPS device ID* under Masters →
  Vehicles), `latitude`/`longitude` (or `lat`/`lng`), optional `speedKmph`,
  `heading`, `timestamp` (ISO or epoch). Up to 500 positions per request.

What happens: every accepted fix updates the vehicle's last known position
(Live Tracking → *Fleet — last known positions*), and when that vehicle is on a
live trip the fix is recorded on the dispatch and shows on *On the road now*
with source *vendor*. A wrong or revoked key is refused with HTTP 401 and
touches nothing. *Issue new key* retires the old one instantly; *Revoke* stops
the feed.

## 5. Smoke test after deploy

1. `LOGIN='owner@…' ./scripts/ops/verify-app.sh` — new lines: *driver app
   module*, *whatsapp business*, *gps vendor feed* (info/skip when unused).
2. Driver: create a driver login, link it, load a truck against the driver on
   the Dispatch Board, tap through the trip on the phone, see the taps on the
   board and the phone's position on Live Tracking.
3. Pumps: add a pump under Vehicles, plan a job, walk it to Finish, see hours
   and charge, check the reconciliation table.
4. WhatsApp: after connecting, *Send test message* → delivered; share an
   invoice → *sent* in the WhatsApp Log.
5. GPS feed: issue a key and POST one position with `curl` from any machine —
   the vehicle appears under *Fleet — last known positions*.
