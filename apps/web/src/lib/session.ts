export interface Session {
  /**
   * Short-lived access token (Bearer). The long-lived refresh token is NOT kept
   * here any more — it lives only in the httpOnly `rmc_rt` cookie the API sets,
   * out of reach of JavaScript (and any XSS). This token is renewed silently via
   * that cookie; on its own it is worth at most one access-token lifetime.
   */
  token: string;
  userType: string;
  email: string;
  /** Effective permission keys for this user (for UI gating). */
  permissions?: string[];
  /** Role keys held by this user (company_owner => full access). */
  roles?: string[];
  /**
   * Module keys this company's subscription includes. Used to leave out menu
   * entries the API would refuse — see `getAccess().hasModule`.
   */
  modules?: string[];
}

const KEY = 'rmc_session';

/**
 * UI access helper. The company owner (and super admin) bypass permission
 * checks — matching the server — so they always see every action; everyone else
 * is gated by their explicit permission keys.
 *
 * `hasModule` is a different question and the owner does NOT bypass it: a module
 * outside the company's subscription is refused for everyone, owner included.
 * A session saved before modules were sent carries none, and is read as "no
 * restriction known" rather than "nothing allowed" — being wrong in the other
 * direction would empty the menu of a plant that is entitled to it.
 */
export function getAccess(): {
  isOwner: boolean;
  permissions: string[];
  has: (key: string) => boolean;
  hasModule: (key: string) => boolean;
} {
  const s = getSession();
  const roles = s?.roles ?? [];
  const isOwner = s?.userType === 'super_admin' || roles.includes('company_owner');
  const permissions = s?.permissions ?? [];
  const modules = s?.modules;
  return {
    isOwner,
    permissions,
    has: (key: string) => isOwner || permissions.includes(key),
    hasModule: (key: string) => !modules || modules.includes(key),
  };
}

export function saveSession(s: Session): void {
  localStorage.setItem(KEY, JSON.stringify(s));
}

export function getSession(): Session | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(KEY);
  return raw ? (JSON.parse(raw) as Session) : null;
}

/**
 * Refresh what this user may see without making them sign in again.
 *
 * Roles and plans change while people are working — a plan upgrade that only
 * appeared at the next sign-in would leave an operator staring at a menu that is
 * missing screens they have just been given.
 */
export function updateAccess(a: { permissions?: string[]; roles?: string[]; modules?: string[] }): void {
  const cur = getSession();
  if (!cur) return;
  saveSession({
    ...cur,
    ...(a.permissions ? { permissions: a.permissions } : {}),
    ...(a.roles ? { roles: a.roles } : {}),
    ...(a.modules ? { modules: a.modules } : {}),
  });
}

/**
 * Replace the short-lived access token after a silent refresh. There is no
 * refresh token to store: it stays in the httpOnly `rmc_rt` cookie the API
 * rotates on every refresh, which the browser sends automatically.
 */
export function updateAccessToken(token: string): void {
  const cur = getSession();
  if (!cur) return;
  saveSession({ ...cur, token });
}

export function clearSession(): void {
  localStorage.removeItem(KEY);
}
