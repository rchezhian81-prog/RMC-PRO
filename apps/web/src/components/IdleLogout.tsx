'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { api, settings } from '../lib/api';
import { clearSession, getSession } from '../lib/session';

/** Shared across tabs: the last moment the person did anything in any of them. */
export const LAST_ACTIVITY_KEY = 'mn.lastActivity';
/** What the browser applies when the company's setting cannot be read. */
export const IDLE_DEFAULT_MINUTES = 30;
/** Activity is noted at most this often, so a scroll does not hammer storage. */
const THROTTLE_MS = 5_000;
/** How often a tab checks whether the window has passed. */
const CHECK_MS = 15_000;
const EVENTS: (keyof WindowEventMap)[] = ['pointerdown', 'keydown', 'scroll', 'touchstart'];

/**
 * The company's window, read once per page load and kept in memory so every
 * mount of the shell does not ask again. A refused or failed read falls back
 * to the default rather than to "never".
 */
let cachedMinutes: number | null = null;
let pending: Promise<number> | null = null;
function loadMinutes(): Promise<number> {
  if (cachedMinutes != null) return Promise.resolve(cachedMinutes);
  if (!pending) {
    pending = settings
      .idleTimeout()
      .then((r) => {
        const n = Number(r?.minutes);
        return Number.isFinite(n) && n >= 0 ? Math.floor(n) : IDLE_DEFAULT_MINUTES;
      })
      .catch(() => IDLE_DEFAULT_MINUTES)
      .then((n) => {
        cachedMinutes = n;
        pending = null;
        return n;
      });
  }
  return pending;
}

/** Forget the cached window — the next shell mount reads it afresh. */
export function resetIdleTimeoutCache(): void {
  cachedMinutes = null;
  pending = null;
}

function readLastActivity(): number {
  try {
    const v = Number(localStorage.getItem(LAST_ACTIVITY_KEY));
    return Number.isFinite(v) && v > 0 ? v : 0;
  } catch {
    return 0;
  }
}

function writeLastActivity(t: number): void {
  try {
    localStorage.setItem(LAST_ACTIVITY_KEY, String(t));
  } catch {
    /* storage blocked — the in-memory copy still counts */
  }
}

/**
 * Signs the person out after a period without activity.
 *
 * Mounted once in the shell. Activity (a tap, a key, a scroll, the tab coming
 * back into view) is noted at most every five seconds under one localStorage
 * key, so a dashboard left open in a second tab does not sign someone out who
 * is busy in the first. Every fifteen seconds the tab compares that shared
 * timestamp with the window: when it has passed, the refresh cookie is cleared
 * on the server (best effort), the local session is dropped, and the person
 * lands on the sign-in page with a note saying why.
 *
 * `minutes` fixes the window (the platform portal uses 30); without it the
 * company's own setting is read. 0 means never.
 */
export function IdleLogout({ minutes }: { minutes?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!getSession()?.token) return;
    let limit: number | null = minutes != null ? Math.max(0, Math.floor(minutes)) : null;
    let lastNoted = 0;
    let lastSeen = Date.now();
    let signingOut = false;
    let cancelled = false;

    const note = () => {
      const now = Date.now();
      lastSeen = now;
      if (now - lastNoted < THROTTLE_MS) return;
      lastNoted = now;
      writeLastActivity(now);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') note();
    };

    const signOut = async () => {
      if (signingOut) return;
      signingOut = true;
      try {
        await api.logout();
      } catch {
        /* best effort: the local session goes regardless */
      }
      clearSession();
      try {
        localStorage.removeItem(LAST_ACTIVITY_KEY);
      } catch {
        /* ignore */
      }
      router.replace('/login?reason=idle');
    };

    const check = () => {
      if (cancelled || limit == null || limit <= 0) return;
      if (!getSession()?.token) return; // already signed out elsewhere
      const last = Math.max(readLastActivity(), lastSeen);
      if (Date.now() - last >= limit * 60_000) void signOut();
    };

    note();
    for (const ev of EVENTS) window.addEventListener(ev, note, { passive: true });
    document.addEventListener('visibilitychange', onVisibility);
    const timer = window.setInterval(check, CHECK_MS);
    if (limit == null) {
      void loadMinutes().then((n) => {
        if (!cancelled) limit = n;
      });
    }

    return () => {
      cancelled = true;
      for (const ev of EVENTS) window.removeEventListener(ev, note);
      document.removeEventListener('visibilitychange', onVisibility);
      window.clearInterval(timer);
    };
  }, [minutes, router]);
  return null;
}
