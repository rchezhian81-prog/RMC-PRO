# VM3 → GHCR: read-only image pull setup (Phase-1 pilot)

The CI workflow (`.github/workflows/build-images.yml`) builds the API + Web images and
pushes them to **GHCR** (GitHub Container Registry). Because the repository is private,
those images are private too, so **VM3 needs a read-only token to pull them**.

This note explains how to create that token and log in on VM3. **It contains no secrets** —
you generate the token yourself and it never appears in this repo, in chat, or in logs.

> Scope of the token: **`read:packages` only**. It can pull images. It cannot push images,
> read source code, or change anything on GitHub.

---

## 1. Create a read-only token (on GitHub, once)

1. GitHub → your avatar → **Settings**
2. **Developer settings** → **Personal access tokens** → **Tokens (classic)**
3. **Generate new token (classic)**
4. **Note:** `VM3 GHCR pull (Mix Nova pilot)`
5. **Expiration:** 90 days (rotate on a reminder — see §5)
6. **Scopes:** tick **only** `read:packages`. Leave every other box unchecked.
7. **Generate token** and copy it **once** (GitHub won't show it again).

Treat the copied value like a password: do not paste it into chat, commits, screenshots,
or a `.env` that gets shared. If it ever leaks, delete it (§5) and make a new one.

*(Alternative — no token at all: you could make the two packages **public** on GitHub, and
VM3 could pull with no login. Only do that if you're comfortable the container images being
publicly downloadable. For a pilot with proprietary code, keep them private + token.)*

---

## 2. Log in on VM3 (once per host)

Run these on VM3 as the deploy user. Paste the token **only** at the prompt / via stdin —
never as a plain command-line argument (that leaks into shell history and the process list).

```bash
# Put the token into a shell variable WITHOUT it landing in history:
#   (leading space + your shell's HISTCONTROL=ignorespace), or read it interactively:
read -rs GHCR_TOKEN            # paste the token, press Enter (input stays hidden)

echo "$GHCR_TOKEN" | docker login ghcr.io -u <YOUR_GITHUB_USERNAME> --password-stdin
unset GHCR_TOKEN              # clear it from the shell
```

Expected output: `Login Succeeded`.

Docker stores the credential in `~/.docker/config.json` (base64, **not** encrypted). Lock
it down:

```bash
chmod 600 ~/.docker/config.json
```

For better protection, use a Docker credential helper (e.g. `docker-credential-pass`) so the
token isn't sitting in a readable file — optional for the pilot, recommended before scale-up.

---

## 3. Verify a pull works

Use the exact image ref the CI run reported (its job summary prints it). Example:

```bash
docker pull ghcr.io/rchezhian81-prog/rmc-pro/rmc-api:<short-sha>
docker pull ghcr.io/rchezhian81-prog/rmc-pro/rmc-web:<short-sha>
```

If both pull, VM3 is ready. This is exactly what `docker compose ... pull` does under the
hood during deploy (runbook §3), using the same login.

---

## 4. Hook it into the deploy

In `.env.production` on VM3 (see `.env.production.example`):

```bash
IMAGE_TAG=<short-sha>                                   # the CI-built SHA, not 'latest'
IMAGE_REPO_API=ghcr.io/rchezhian81-prog/rmc-pro/rmc-api
IMAGE_REPO_WEB=ghcr.io/rchezhian81-prog/rmc-pro/rmc-web
```

Then:

```bash
docker compose --env-file .env.production -f docker/docker-compose.prod.yml pull
docker compose --env-file .env.production -f docker/docker-compose.prod.yml up -d
```

Because the images are already present after `pull`, `up -d` uses them and does **not**
build anything on VM3.

---

## 5. Security & rotation

- **Least privilege:** the token has `read:packages` only — nothing else.
- **Expiry & rotation:** it expires in 90 days. To rotate: create a new token (§1),
  `docker login` again on VM3 (§2), then delete the old token on GitHub
  (Settings → Developer settings → Tokens → the old token → **Delete**).
- **Revoke on leak:** if the token is ever exposed, delete it immediately (same path) —
  that instantly invalidates it — then issue a fresh one.
- **Never** commit the token, put it in a tracked file, or paste it into chat/tickets.
  Nothing in this repo should ever contain the token value.
- **One host, one token** is fine for the pilot. For multiple servers or an org later,
  prefer a dedicated machine/bot account rather than a personal token.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `denied` / `unauthorized` on pull | token missing `read:packages`, wrong username, or expired | recreate token with `read:packages`; re-login; check expiry |
| `manifest unknown` | wrong tag / SHA | use the exact ref from the CI job summary |
| Login works, pull still denied | your account lacks read access to the package | ensure the package is owned by / linked to your account (it is, for your own repo) |
| Want no token | images are private | either keep the token, or make the packages public (§1 alternative) |
