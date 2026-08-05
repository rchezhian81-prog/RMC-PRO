export interface Session {
  token: string;
  /** Long-lived refresh token used to silently mint a new access token. */
  refreshToken?: string;
  userType: string;
  email: string;
  /** Effective permission keys for this user (for UI gating). */
  permissions?: string[];
  /** Role keys held by this user (company_owner => full access). */
  roles?: string[];
}

const KEY = 'rmc_session';

/**
 * UI access helper. The company owner (and super admin) bypass permission
 * checks — matching the server — so they always see every action; everyone else
 * is gated by their explicit permission keys.
 */
export function getAccess(): { isOwner: boolean; permissions: string[]; has: (key: string) => boolean } {
  const s = getSession();
  const roles = s?.roles ?? [];
  const isOwner = s?.userType === 'super_admin' || roles.includes('company_owner');
  const permissions = s?.permissions ?? [];
  return { isOwner, permissions, has: (key: string) => isOwner || permissions.includes(key) };
}

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
