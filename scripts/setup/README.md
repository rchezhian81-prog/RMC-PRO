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
