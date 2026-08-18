# UI V2 pilot — override file & inert `IMAGE_TAG_WEB` line cleanup (ops procedure)

Documentation only. **Nothing here has been executed.** Run on the VPS, on the
owner's explicit go.

## What exists on the box during the pilot

Two artifacts were created to run the V2 pilot on the current (older) production
compose file, which does **not** support the `IMAGE_TAG_WEB` web-only override:

1. **`/opt/rmc/docker/web-uiv2.override.yml`** — a tiny compose override that pins
   **only** the `web` service to the V2 image
   (`ghcr.io/rchezhian81-prog/rmc-pro/rmc-web:<sha>-uiv2`, e.g. `846e2ee-uiv2`).
   **This file is what keeps V2 live.** It is used by passing
   `-f docker/web-uiv2.override.yml` on `docker compose ... up -d web`.
2. **An inert `IMAGE_TAG_WEB=<sha>-uiv2` line in `/opt/rmc/.env.production`** — it
   does **nothing** on this box, because `main`'s compose file doesn't read
   `IMAGE_TAG_WEB` (see `OPT-RMC-UPDATE.md`). It is harmless but misleading.

> ⚠️ **Do not delete `web-uiv2.override.yml` while you want V2 live.** Removing it
> and running a plain `up -d web` (base compose only) reverts web to the baseline
> image and turns V2 **off**. That is the correct rollback — just be intentional.

## Case 1 — Keep V2 live, only tidy the misleading inert line

Removes the do-nothing `IMAGE_TAG_WEB` line; **keeps** the override file (V2 stays up).

```bash
cd /opt/rmc
cp -n .env.production .env.production.bak
sed -i '/^IMAGE_TAG_WEB=/d' .env.production      # remove the inert line
grep '^IMAGE_TAG_WEB=' .env.production || echo "inert line removed (override file still holds V2)"
ls docker/web-uiv2.override.yml && echo "override file kept — V2 stays live"
# no container action needed; nothing about the running web service changes
```

## Case 2 — Retire the pilot (roll back to the classic baseline)

Turns V2 off and returns web to the baseline image (`3467bc9`).

```bash
cd /opt/rmc
# bring web up from the BASE compose only (no override) -> baseline image
docker compose -f docker/docker-compose.prod.yml --env-file .env.production up -d web
# then remove the pilot artifacts
rm -f docker/web-uiv2.override.yml
sed -i '/^IMAGE_TAG_WEB=/d' .env.production
# verify
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}'   # web -> :3467bc9 (healthy)
bash scripts/ops/verify-app.sh
```

## Case 3 — Re-apply V2 after an accidental revert

If web fell back to baseline (e.g. a plain `up -d web` ran without the override):

```bash
cd /opt/rmc
cat > docker/web-uiv2.override.yml <<'YAML'
services:
  web:
    image: ghcr.io/rchezhian81-prog/rmc-pro/rmc-web:846e2ee-uiv2
YAML
docker compose -f docker/docker-compose.prod.yml -f docker/web-uiv2.override.yml --env-file .env.production up -d web
sleep 25
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}'   # web -> :846e2ee-uiv2 (healthy)
curl -sL https://app.mixnovas.com/ | grep -c 'data-ui="v2"'      # expect 1
```

## Permanent fix (removes the need for all of the above)

Merge `IMAGE_TAG_WEB` into `main` (small infra PR), update `/opt/rmc`
(`OPT-RMC-UPDATE.md` Procedure A), switch to the native mechanism
(Procedure B), and this override file is retired for good.

## Guardrails

- These steps touch only the **`web`** service; API/DB/redis/minio/nginx untouched.
- The `-uiv2` web image is a presentation-only skin over the same app content — no
  data/schema/API change — so flip and rollback are seconds and reversible.
