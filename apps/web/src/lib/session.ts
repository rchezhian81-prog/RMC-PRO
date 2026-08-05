export interface Session {
  token: string;
  /** Long-lived refresh token used to silently mint a new access token. */
  refreshToken?: string;
  userType: string;
  email: string;
}

const KEY = 'rmc_session';

export function saveSession(s: Session): void {
  localStorage.setItem(KEY, JSON.stringify(s));
}

export function getSession(): Session | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(KEY);
  return raw ? (JSON.parse(raw) as Session) : null;
}

/** Replace the access (and refresh) token on the existing session after a refresh. */
export function updateTokens(token: string, refreshToken?: string): void {
  const cur = getSession();
  if (!cur) return;
  saveSession({ ...cur, token, ...(refreshToken ? { refreshToken } : {}) });
}

export function clearSession(): void {
  localStorage.removeItem(KEY);
}
