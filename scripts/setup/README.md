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
