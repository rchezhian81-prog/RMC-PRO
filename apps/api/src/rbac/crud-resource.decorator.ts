import { SetMetadata } from '@nestjs/common';

export const CRUD_RESOURCE_KEY = 'crud_resource';

/**
 * Marks a BaseCrudController with the permission resource it belongs to (e.g.
 * 'masters'). CrudPermissionsGuard combines it with the HTTP method to require
 * `<resource>.<action>` — view / create / edit / delete.
 */
export const CrudResource = (resource: string) => SetMetadata(CRUD_RESOURCE_KEY, resource);
