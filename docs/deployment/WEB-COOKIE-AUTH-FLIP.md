# Web cookie-auth flip — deploy notes

> The web app no longer keeps the **refresh token** in `localStorage`. It now
> relies on the httpOnly `rmc_rt` cookie the API already issues, so a refresh
> token can't be read by JavaScript (or stolen by XSS). Only the short-lived
> access token stays in the browser. Companion: `WAVE1-HARDENING-RUNBOOK.md`
> (server-side cookie auth), `SECURITY_PRIVACY_THREAT_MODEL.md`.

## What changed

| Before | After |
|---|---|
| Login stored `{ token, refreshToken }` in `localStorage`. | Login stores only `{ token }` (access). The refresh token arrives as an httpOnly cookie and is never touched by JS. |
| Refresh POSTed `{ refresh_token }` read from `localStorage`. | Refresh POSTs with `credentials: 'include'` and **no body** — the cookie is the credential. Server rotates the cookie, returns a new access token. |
| Logout just cleared `localStorage`. | Logout calls `POST /auth/logout` (`credentials: 'include'`) so the server clears the cookie, then clears the local session. |

The **server was already dual-mode** (Wave 1): it sets the cookie on login/refresh,
accepts a refresh from the cookie *or* the body, and clears it on logout. This
change only moves the **web client** onto the cookie. Nothing on the API changed,
so a rollback is just reverting the web commit.

## Security effect

XSS can now steal at most a **≤15-minute access token** (self-expiring, and not
renewable without the httpOnly cookie), instead of a **14-day refresh token**.
The refresh token is out of JavaScript's reach entirely.

> Further hardening (a later step): keep the access token in memory only and
> re-mint it from the cookie on page load. That removes the access token from
> `localStorage` too, at the cost of a refresh round-trip on every full reload.

## Deploy behaviour — one-time re-login

The **old** web client never sent `credentials: 'include'`, so browsers never
stored the cookie even though the server set it. After this deploys, an existing
signed-in user has an access token but **no cookie**. Their session keeps working
until the access token expires (≤15 min); the next silent refresh finds no cookie
and sends them to the login screen once. Re-logging in sets the cookie and they're
on the new flow. This is a **one-time, password-only re-auth** on rollout — no data
impact.

## Configuration (must be right or login breaks)

The cookie defaults to `Secure` + `SameSite=None` (for cross-site `app.<domain>`
→ `api.<domain>`), and CORS must allow credentials from the web origin.

**Production**
- API served over **HTTPS** (Secure cookies are dropped over http).
- `CORS_ORIGINS` **must list the web origin** (e.g. `https://app.example.com`).
  CORS already runs with `credentials: true` and never `*`.
- If the app and API share a parent domain, set `AUTH_COOKIE_DOMAIN=.example.com`.
- Keep defaults `AUTH_COOKIE_SECURE=true`, `AUTH_COOKIE_SAMESITE=none`.

**Local dev (http on localhost)**
- A `Secure`/`SameSite=None` cookie is not stored over http, so set:
  - `AUTH_COOKIE_SECURE=false`
  - `AUTH_COOKIE_SAMESITE=lax`
- `CORS_ORIGINS` unset defaults to `http://localhost:3000` (the web dev origin).

## Staging smoke-test (before production)

This change can't be exercised by CI (no browser there), so verify in staging:

1. **Login** as a tenant user → DevTools ▸ Application ▸ Cookies shows `rmc_rt`
   with **HttpOnly** ✓ and Secure ✓; `localStorage.rmc_session` has a `token`
   but **no `refreshToken`**.
2. **Silent refresh** — wait for the access token to expire (or delete
   `rmc_session.token` and make any call): the app keeps working (a `/auth/refresh`
   fires and succeeds) without bouncing to login.
3. **Logout** → `rmc_rt` is gone and you land on `/login`.
4. Repeat 1–3 for a **super-admin** (admin portal) as well as a tenant user.
5. Cross-check that business API calls still carry the `Authorization: Bearer`
   access token (the cookie is scoped to `/api/v1/auth` only).

## Rollback

Revert the web commit. The API is unchanged and still accepts body-token refresh,
so older clients keep working with no server action.
