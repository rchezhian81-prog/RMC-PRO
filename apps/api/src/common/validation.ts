import { BadRequestException } from '@nestjs/common';

/**
 * Throw a structured, field-level 400 when any field carries an error message.
 * Shape (Design Doc 7 §2.4 + field detail):
 *   { code: 'VALIDATION_ERROR', message, fields: { <field>: <message> } }
 * A no-op when `fields` is empty, so callers can build the map unconditionally.
 */
export function assertFields(fields: Record<string, string>): void {
  if (Object.keys(fields).length > 0) {
    throw new BadRequestException({
      code: 'VALIDATION_ERROR',
      message: 'Please correct the highlighted fields.',
      fields,
    });
  }
}
