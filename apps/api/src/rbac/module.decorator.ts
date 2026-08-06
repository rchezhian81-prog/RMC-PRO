import { SetMetadata } from '@nestjs/common';
import { MODULE_CATALOG } from '@rmc/shared';

export const MODULE_KEY = 'required_module';

/**
 * Require a subscription module to be enabled for the tenant (Design Doc 9 §8.3).
 *
 * On a controller that already declares `TenantGuard` — which is every
 * tenant-scoped controller — this decorator is all that is needed; that guard
 * reads the same metadata. `ModuleGuard` covers anything that does not.
 */
export const RequireModule = (moduleKey: string) => SetMetadata(MODULE_KEY, moduleKey);

/** Name the module the way the plan screen does, not by its internal key. */
export function moduleBlockedMessage(moduleKey: string): string {
  const name = MODULE_CATALOG.find((m) => m.key === moduleKey)?.name ?? moduleKey;
  return `The ${name} module is not included in your plan. Contact Mix Nova support to add it.`;
}
