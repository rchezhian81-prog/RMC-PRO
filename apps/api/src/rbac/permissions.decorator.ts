import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'permissions';
export const PERMISSIONS_ANY_KEY = 'permissions_any';

/** Require ALL of these permission keys on a route — AND (Design Addendum RBAC §2). */
export const RequirePermissions = (...perms: string[]) => SetMetadata(PERMISSIONS_KEY, perms);

/**
 * Require ANY ONE of these permission keys on a route — OR. Used where several
 * distinct roles legitimately reach a route (e.g. a financial read allowed to
 * either the module's write-holder or a reports viewer). The tenant owner still
 * bypasses. A method-level permission decorator of either kind fully overrides
 * this when both are present on the same handler.
 */
export const RequireAnyPermission = (...perms: string[]) => SetMetadata(PERMISSIONS_ANY_KEY, perms);
