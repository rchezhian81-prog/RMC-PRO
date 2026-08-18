# UI V2 ("Deep Violet Matte") — controlled pilot runbook (operator copy‑paste)

Plain-language, copy‑paste steps to show the UI V2 skin on the live site as a
**controlled pilot**, changing **only the web container**, with an instant
rollback. Grounded in the live state verified on **2026‑08‑18** (repo→live
alignment audit).

> **Companion docs.** For the deeper staged-rollout/canary reference see
> `docs/deployment/UI-V2-ROLLOUT-RUNBOOK.md`; for the flag design & guarantees
> see `docs/ui/UI-V2-ROLLOUT.md`. **This file is the operator's quick pilot
> version** — same mechanism, fewer stages, exact commands.

## Ground truths (verified live)

- **Live baseline:** `rmc-web` + `rmc-api` on tag **`3467bc9`**, healthy.
- **Deploy directory:** `/opt/rmc` (holds `.env.production` + `docker/docker-compose.prod.yml`).
- **Backups run from** `/root/RMC-PRO` (cron in `/etc/cron.d/`): daily/weekly/monthly
  `pg-backup.sh`, off‑box to Backblaze B2 (`rclone:b2:rmc-offbox-backups`) **plus**
  Acronis whole‑VM image. Monthly restore‑drill active.
- **The flag is build‑time.** V2 lives in a specific web image
  `rmc-web:<main-short-sha>-uiv2`, produced by the `ui_v2` input of
  `build-images.yml`. Running that image = V2 on; a normal `<sha>` image = V2 off.
  A runtime env var cannot flip it.
- **`IMAGE_TAG_WEB`** overrides only the **web** image, so V2 flips and rolls back
  **without touching the api image or any data**. Unset → falls back to `IMAGE_TAG`.
- **Presentation only.** No data/schema/migration/RBAC/route/API change at any step.

Throughout: `<UIV2_TAG>` = the current V2 image tag. At time of writing, `main` is
`bc44aa9`, so the tag is **`bc44aa9-uiv2`**. (To confirm the current value: it is
`<short-sha-of-main>-uiv2`, printed by the Build‑images run in Phase 1.)

---

## Phase 0 — Pre‑flight (confirm all‑green before starting)

On the server:

```bash
cd /opt/rmc
cp -n .env.production .env.production.bak && echo "backup of .env.production saved"
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}'
bash scripts/ops/verify-app.sh
```

**Proceed only if** `verify-app.sh` ends with `VERIFY OK` and web+api show
`3467bc9 … (healthy)`.

Optional peace‑of‑mind DB snapshot (not required — V2 changes no data):

```bash
cd /root/RMC-PRO && ./scripts/backup/pg-backup.sh --label pre-pilot && cd /opt/rmc
```

---

## Phase 1 — Build the V2 image (on GitHub, ~2 min)

In a browser:

1. **github.com/rchezhian81-prog/RMC-PRO → Actions → "Build images" → Run workflow.**
2. **Use workflow from: `main`.**
3. ✅ **Check "PREVIEW: bake UI V2 flag ON".**
4. Leave the API URL default (`https://api.mixnovas.com`). **Run workflow.**
5. Wait for the green ✓.

**Result:** `ghcr.io/rchezhian81-prog/rmc-pro/rmc-web:<UIV2_TAG>` (web only; the
canonical `latest`/`<sha>` tags are untouched, and the api image is skipped).

---

## Phase 2 — Smoke‑test the V2 image in isolation (does NOT touch the live site)

```bash
IMG=ghcr.io/rchezhian81-prog/rmc-pro/rmc-web:bc44aa9-uiv2   # <-- set to <UIV2_TAG>
docker pull "$IMG"
docker run -d --name web-uiv2-test -p 3001:3000 -e HOSTNAME=0.0.0.0 -e PORT=3000 "$IMG"
sleep 6
echo "--- health ---";            curl -s http://localhost:3001/api/health; echo
echo "--- V2 baked in? (expect 1) ---"; curl -s http://localhost:3001/ | grep -c 'data-ui="v2"'
echo "--- logs ---";              docker logs --tail 15 web-uiv2-test
docker rm -f web-uiv2-test
```

**Expected:** health `{"status":"ok","service":"rmc-web",…}`, V2 check prints **`1`**,
logs show a clean start. *(If `docker pull` says "unauthorized", run the same
`docker login ghcr.io` used at setup, then retry.)*

---

## Phase 3 — 🚦 Decision gate

Continue **only if** Phase 2 health was ok **and** the V2 check printed `1`. Pick a
low‑traffic window. If anything looked off — **stop; nothing is live yet.**

---

## Phase 4 — Flip the live website to V2

```bash
cd /opt/rmc
# point ONLY the web image at the V2 tag (adds or updates the line; no editor)
grep -q '^IMAGE_TAG_WEB=' .env.production \
  && sed -i 's|^IMAGE_TAG_WEB=.*|IMAGE_TAG_WEB=bc44aa9-uiv2|' .env.production \
  || echo 'IMAGE_TAG_WEB=bc44aa9-uiv2' >> .env.production
grep '^IMAGE_TAG_WEB=' .env.production   # confirm: IMAGE_TAG_WEB=bc44aa9-uiv2

# restart ONLY the web container (api/db/redis/minio untouched)
docker compose -f docker/docker-compose.prod.yml --env-file .env.production pull web
docker compose -f docker/docker-compose.prod.yml --env-file .env.production up -d web
```

---

## Phase 5 — Verify the pilot is live

```bash
cd /opt/rmc
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}'   # web now shows :<UIV2_TAG> (healthy)
bash scripts/ops/verify-app.sh                                    # expect VERIFY OK
echo "--- V2 live on the public site? (expect 1) ---"
curl -s https://app.mixnovas.com/ | grep -c 'data-ui="v2"'
```

Then open **https://app.mixnovas.com** and confirm the dark‑violet skin. API/data
behave exactly as before — only the look changed.

---

## 🔄 Rollback (instant — any time after Phase 4)

```bash
cd /opt/rmc
sed -i '/^IMAGE_TAG_WEB=/d' .env.production     # remove the V2 override
docker compose -f docker/docker-compose.prod.yml --env-file .env.production pull web
docker compose -f docker/docker-compose.prod.yml --env-file .env.production up -d web
bash scripts/ops/verify-app.sh
```

Returns the site to the current `3467bc9` flag‑OFF image in seconds. No data
touched, nothing to undo.

---

## After the pilot

- **Keep V2:** leave `IMAGE_TAG_WEB=<UIV2_TAG>` in place. For a permanent release,
  bake V2 into the canonical image so the override isn't needed (see the staged
  `UI-V2-ROLLOUT-RUNBOOK.md`).
- **Revert to classic:** run the Rollback block.

## Guardrails baked into this plan

- Only the **web** container ever changes; **api stays on `3467bc9`** → zero
  backend/data risk, no migration.
- Backups (B2 + Acronis) and monitors keep running throughout.
- Rollback is one config line + one `web` restart.
