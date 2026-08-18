# `/opt/rmc` checkout update + native `IMAGE_TAG_WEB` enablement (ops procedure)

Documentation only. **Nothing here has been executed.** Run on the VPS, on the
owner's explicit go. Read-only until the steps that clearly restart a container.

## Background / important caveat

- The live production stack runs from the git checkout at **`/opt/rmc`**
  (`docker/docker-compose.prod.yml` + `.env.production`). It runs **pre-built
  images pinned by tag**, so updating the *checkout* rebuilds/restarts **nothing**
  on its own.
- The automated **PostgreSQL backups** run from a **separate** checkout at
  **`/root/RMC-PRO`** (cron in `/etc/cron.d/`). This procedure updates
  `/opt/rmc`; `/root/RMC-PRO` can be updated the same way later if desired.
- ✅ **`IMAGE_TAG_WEB` is now in `main`** (ported from the closed
  `claude/ui-v2-completion-audit` (PR #64) branch via the infra PR). The web
  service line is now
  `image: ${IMAGE_REPO_WEB}:${IMAGE_TAG_WEB:-${IMAGE_TAG:-latest}}`.
- ⚠️ **But the production box hasn't been updated to it yet.** The running
  `/opt/rmc` checkout predates this change, so on the box today editing
  `IMAGE_TAG_WEB` still has no effect. Run **Procedure A** to update `/opt/rmc`
  to a `main` commit that includes it, then **Procedure B** to switch. Until the
  box is updated, the V2 pilot runs via the local override file
  (`docker/web-uiv2.override.yml`) — see `UI-V2-PILOT-OVERRIDE-CLEANUP.md`.

## Procedure A — update the `/opt/rmc` checkout to a target commit

Safe any time; restarts nothing. Use it to pick up newer compose/scripts/docs.

```bash
cd /opt/rmc

# 0) record where we are (for rollback of THIS update) + confirm healthy
echo "current: $(git rev-parse --short HEAD)  on  $(git rev-parse --abbrev-ref HEAD)"
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}'

# 1) safety: tracked files must be clean (untracked .env.production* / override are fine)
git status --porcelain
#   If any TRACKED file shows as modified, STOP and investigate before pulling.

# 2) fetch + fast-forward (ff-only refuses to overwrite if diverged — safe)
git fetch origin main
git checkout main 2>/dev/null || git checkout -B main origin/main
git pull --ff-only origin main
echo "now at: $(git rev-parse --short HEAD)"
```

Nothing restarts. `.env.production` is gitignored, so it is untouched.

## Procedure B — enable the NATIVE `IMAGE_TAG_WEB` pilot mechanism

> **Prerequisite:** `IMAGE_TAG_WEB` is now in `main` (infra PR). The remaining
> step is to update `/opt/rmc` to a `main` commit that includes it (Procedure A).
> Do **not** run Procedure B until
> `grep IMAGE_TAG_WEB /opt/rmc/docker/docker-compose.prod.yml` returns matches;
> until the box is updated, keep the pilot on the override file.

Once `IMAGE_TAG_WEB` is in `main` and `/opt/rmc` has been updated (Procedure A):

```bash
cd /opt/rmc

# 1) confirm the feature is present in the box's compose
grep -n 'IMAGE_TAG_WEB' docker/docker-compose.prod.yml || { echo "NOT present — do NOT continue"; exit 1; }

# 2) set the web tag in the env file
grep -q '^IMAGE_TAG_WEB=' .env.production \
  && sed -i 's|^IMAGE_TAG_WEB=.*|IMAGE_TAG_WEB=<sha>-uiv2|' .env.production \
  || echo 'IMAGE_TAG_WEB=<sha>-uiv2' >> .env.production   # e.g. 846e2ee-uiv2

# 3) recreate ONLY web via the base compose (no override needed now)
docker compose -f docker/docker-compose.prod.yml --env-file .env.production up -d web

# 4) verify, then retire the temporary override file
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}'   # web -> :<sha>-uiv2 (healthy)
rm -f docker/web-uiv2.override.yml
bash scripts/ops/verify-app.sh
```

## Rollback of the update itself

The compose/scripts are just files — `git checkout <old-short-hash>` (from step 0)
restores them; running containers are unaffected. Container-level V2 rollback is
separate (see `UI-V2-PILOT-OVERRIDE-CLEANUP.md`).

## Guardrails

- Updating the checkout **never** restarts containers by itself.
- Only ever recreate the **`web`** service for the pilot; API/DB/redis/minio/nginx
  are untouched (the `-uiv2` image is web-only; no `-uiv2` API image exists).
- Do not run Procedure B before its prerequisite is met.
