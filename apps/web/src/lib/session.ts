export interface Session {
  token: string;
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

export function clearSession(): void {
  localStorage.removeItem(KEY);
}
