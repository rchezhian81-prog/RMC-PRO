# Plant master-data seeder

`seed-plant-master.mjs` bootstraps a freshly-onboarded tenant with realistic
starter master data by driving the **live API** the same way the browser does.
It is **idempotent** — re-running skips anything already present and re-sets
opening stock to the same absolute value, so it is safe to run more than once.

Everything it creates is a **placeholder for the plant owner to correct in the
app** (grades, materials, the sample customer/site/driver/vehicle, and a starter
M25 mix design).

## What it seeds

For the tenant of the logged-in user:

| # | Master | Records |
|---|--------|---------|
| 1 | Plant | `SRE-P1` |
| 2 | Concrete grades | M10, M15, M20, M25, M30, M35, M40 |
| 3 | Materials | 3 cements, 20/10mm aggregate, river/M-sand, fly ash, water, 2 admixtures |
| 4 | Customer + site | 1 sample each (edit in app) |
| 5 | Driver + vehicle | 1 driver + 1 transit mixer |
| 6 | Number series | quotation, order, delivery_challan, invoice, receipt, dispatch |
| 7 | Mix design | approved **M25-STD** with 6 materials |
| 8 | Opening stock | every material, at `SRE-P1` |

## Run it (on the VPS, where the API is reachable)

```bash
# From the repo root on the server:
API_URL=https://api.mixnovas.com \
LOGIN='<tenant user email or mobile>' \
node scripts/setup/seed-plant-master.mjs
```

You'll be missing `RMC_PASSWORD` — provide it **in the environment only**, e.g.:

```bash
read -rs RMC_PASSWORD   # type the password; it won't echo
export RMC_PASSWORD
API_URL=https://api.mixnovas.com LOGIN='owner@example.com' \
  node scripts/setup/seed-plant-master.mjs
unset RMC_PASSWORD
```

## Rules the script follows

- **`RMC_PASSWORD` is read from the environment only** — never printed, logged,
  or written to disk.
- The `LOGIN` must be a **tenant user** (e.g. the company owner created at
  onboarding), **not** the platform super-admin. The script refuses a login
  that has no tenant.
- No secrets appear in its output. It prints only record codes and counts.

## Requirements

Node 18+ (the VPS runs Node 22 — uses the built-in `fetch`, no dependencies).

---

# End-to-end test cycle

`test-order-cycle.mjs` drives the live API through a full business flow
(quotation → order → batch → dispatch → challan → invoice → receipt) using the
seeded masters, so you can watch the whole thing work before real customers.
Each run creates a **new** set of test documents and consumes opening stock.

```bash
read -rs RMC_PASSWORD; export RMC_PASSWORD
API_URL=https://api.mixnovas.com LOGIN='<tenant owner>' \
  node scripts/setup/test-order-cycle.mjs
unset RMC_PASSWORD
```

---

# Reset transactions (clean slate)

`reset-transactions.sh` wipes the **transactional** data for one tenant
(quotations, orders, batches, dispatches, challans, invoices, receipts, stock,
leads, notifications) and resets document numbering back to `0001`, while
**keeping** all masters, mix designs, users, roles, and settings. Use it to
clear out test documents (like those from `test-order-cycle.mjs`) before going
live.

It runs on the VPS from the repo root, talks to the Postgres **container** as
the DB owner over the local socket (no password on the CLI, nothing secret
printed), and always takes a verified full backup first.

```bash
# Preview only — shows the target tenant and row counts, changes nothing:
bash scripts/setup/reset-transactions.sh

# Perform the reset (destructive):
bash scripts/setup/reset-transactions.sh --confirm
```

If more than one tenant exists it refuses to guess — name one with
`--tenant-code <CODE>` (or `--tenant-id <uuid>`).

Opening stock lives in the stock tables it clears, so **re-run the seeder
afterwards** to restore it (the seeder sets opening stock absolutely):

```bash
API_URL=https://api.mixnovas.com LOGIN='<tenant owner>' \
  RMC_PASSWORD='<password>' node scripts/setup/seed-plant-master.mjs
```

Flags: `--confirm` (required to write), `--tenant-code` / `--tenant-id`
(target selection), `--skip-backup` (not recommended), `--backup-dir DIR`
(default `./backups`).

---

# Real master data — fill-in-the-blanks config

`plant-config.example.json` + `apply-plant-config.mjs` replace the seeder's
placeholder values with the plant's own details, without anyone having to paste
business data into a chat or a ticket. You fill the file in on the server; it is
git-ignored, so real GSTINs, contacts and credit limits are never committed.

```bash
cd /opt/rmc
cp scripts/setup/plant-config.example.json scripts/setup/plant-config.json
nano scripts/setup/plant-config.json      # fill in what you know

read -rs RMC_PASSWORD; export RMC_PASSWORD          # run this line ALONE
LOGIN='<tenant owner>' node scripts/setup/apply-plant-config.mjs --dry-run
LOGIN='<tenant owner>' node scripts/setup/apply-plant-config.mjs
unset RMC_PASSWORD
```

## How it behaves

- **Blank means "leave it alone".** A field left as `""` or `null` is never
  sent, so the script cannot wipe a value. Fill the file in over several
  sittings and re-run as often as you like.
- **`--dry-run` first.** It prints exactly which records and fields would
  change, and sends nothing.
- **Idempotent.** A field already matching is reported as "nothing to change".
- **Goes through the API**, so the same validation and permission rules apply as
  when a user edits the record on screen.
- **Covers**: company, plant, customer CUST-001, site SITE-001, driver DRV-001,
  vehicle (including changing the registration number), and material rates and
  reorder levels.

## Deliberately not covered

- **The M25 mix design.** Approved recipes are version-controlled for QC. Raise
  and approve a new version in the app: *Production → Mix Designs → M25-STD →
  New version*. Silently rewriting an approved recipe would break the approval
  trail.
- **Creating new records.** This edits the starter set. Add further customers,
  sites, vehicles or drivers in the app, or with the CSV import on each Masters
  screen (Import → download the template first).

---

# Create a staff login from the command line

`create-staff-user.mjs` does what *Setup → Users* does, without the clicking:
resolves the role, creates the user, assigns the role, and prints the exact
command to verify what the server then allows them.

Neither password is ever printed, logged, or written to disk — both are read
from the environment only.

```bash
cd /opt/rmc

# See what roles exist (owner password only)
read -rs RMC_PASSWORD; export RMC_PASSWORD          # run this line ALONE
LOGIN='owner@example.com' node scripts/setup/create-staff-user.mjs --list-roles

# Create the person
read -rs NEW_PASSWORD; export NEW_PASSWORD          # run this line ALONE
LOGIN='owner@example.com' \
NEW_NAME='Ravi Kumar' NEW_EMAIL='ravi@plant.com' NEW_MOBILE='9000000000' \
NEW_ROLE='batching_operator' \
  node scripts/setup/create-staff-user.mjs

unset RMC_PASSWORD NEW_PASSWORD
```

`NEW_ROLE` accepts the role key (`batching_operator`) or the display name
(`Batching Operator`), case-insensitively.

## Behaviour

- **Idempotent.** If the email already exists the person is never duplicated:
  the role is corrected if it differs, otherwise nothing changes.
- **`--dry-run`** validates everything and reports what would happen.
- **`--list-roles`** prints the tenant's roles and exits.
- **Password policy**: at least 10 characters with a letter and a digit, and not
  starting with an obvious word (`password`, `admin`, `demo`, …). A weak one is
  refused before anything is created.
- A role change takes effect at that person's **next sign-in**, because the
  sidebar reads the permissions captured when they logged in.

Then confirm what the server actually permits — see `scripts/ops/README.md`
→ *verify one user's role*.

---

# Recover a login that cannot sign in

Every other repair needs you signed in already: Setup → Users resets passwords,
and `create-staff-user.mjs` calls the API as the owner. Neither helps when the
**owner** is the one locked out. `recover-login.sh` goes to the database
directly, so it works when nobody can get in.

```bash
cd /opt/rmc
bash scripts/setup/recover-login.sh                      # read-only: show every account
bash scripts/setup/recover-login.sh --activate a@b.com   # undo a deactivation

read -rs NEW_PASSWORD; export NEW_PASSWORD               # run this line ALONE
bash scripts/setup/recover-login.sh --set-password a@b.com
unset NEW_PASSWORD
```

## Reading the status table

Signing in needs **both** the user status `active` **and** the company status
`active`, `trial` or `grace`.

| What you see | What it means |
|---|---|
| `user_status` not `active` | Deactivated — `--activate <email>` |
| `roles` shows `— none —` | They can sign in but see nothing; give them a role in Setup → Users |
| `roles` shows `— n/a —` | Normal for a platform admin, who holds no tenant role |
| `company_status` suspended/cancelled | The whole company is blocked; change it in the admin portal under the tenant's Subscription status |
| Everything looks right | It is the password — `--set-password <email>` |

All three of the first cases are indistinguishable from the login screen: the
API answers `AUTH_REQUIRED` for a wrong password, an unknown email **and** a
deactivated user alike, on purpose, so nobody can use the sign-in form to
discover which emails exist.

## About the password

Read from the environment only. It is never printed, never logged, never written
to disk, and never passed as a command argument — it is piped to the hasher on
stdin, so it does not appear in `ps`. Only a bcrypt hash reaches the database,
which is what the API stores anyway. Hashing happens inside the API container
using the same shared policy the app enforces, so this cannot set a password the
app would later reject.

Existing sessions keep working until their tokens expire; the new password
applies to the next sign-in.
