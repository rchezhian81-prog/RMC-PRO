/**
 * Which tenant statuses may keep trading, and what to say when one may not.
 *
 * Both the API (login, refresh, every guarded request) and the web app read
 * this, so a plant is never told one thing by the sign-in screen and another by
 * the server.
 */
import type { TenantStatus } from './enums';

/**
 * Statuses that can use the system.
 *
 * `trial` and `grace` are deliberately included: a trial has not started paying
 * yet and a grace period is a late payment, not a terminated one. Cutting a
 * running plant off mid-pour over an unpaid invoice would strand concrete in a
 * mixer, so grace stays open and only a deliberate suspension closes the door.
 */
export const TENANT_USABLE_STATUSES: readonly TenantStatus[] = ['active', 'trial', 'grace'];

export function isTenantUsable(status: string | null | undefined): boolean {
  return TENANT_USABLE_STATUSES.includes(String(status ?? '') as TenantStatus);
}

/**
 * What to show someone whose company has been blocked. Written for the plant
 * clerk who sees it, not the operator who set it — they cannot fix billing, so
 * the message points at who can.
 */
export function tenantBlockedMessage(status: string | null | undefined): string {
  switch (String(status ?? '')) {
    case 'suspended':
      return 'Your company account is suspended. Contact Mix Nova support to restore access.';
    case 'cancelled':
      return 'Your company subscription has been cancelled. Contact Mix Nova support to reopen the account.';
    default:
      return 'Your company account is not active. Contact Mix Nova support for help.';
  }
}
