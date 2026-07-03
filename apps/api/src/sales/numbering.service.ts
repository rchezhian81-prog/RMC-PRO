import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

interface SeriesRow {
  id: string;
  prefix: string | null;
  suffix: string | null;
  current_number: number;
  padding_length: number;
}

/**
 * Atomic document numbering (Design Doc 6 §5.4, Doc 11 §7).
 * Runs INSIDE the caller's tenant transaction so the number is only consumed if
 * the surrounding document write commits. `SELECT ... FOR UPDATE` serialises
 * concurrent callers on the same series row, preventing duplicate numbers.
 * If no series exists for the document type it is auto-provisioned with the
 * supplied default prefix.
 */
@Injectable()
export class NumberingService {
  async next(
    m: EntityManager,
    tenantId: string,
    documentType: string,
    defaultPrefix: string,
  ): Promise<string> {
    const existing: SeriesRow[] = await m.query(
      `SELECT id, prefix, suffix, current_number, padding_length
         FROM number_series
        WHERE tenant_id = $1 AND document_type = $2 AND is_active = true
        ORDER BY created_at ASC
        LIMIT 1
        FOR UPDATE`,
      [tenantId, documentType],
    );

    let series: SeriesRow | undefined = existing[0];
    if (!series) {
      const inserted: SeriesRow[] = await m.query(
        `INSERT INTO number_series (tenant_id, document_type, prefix, current_number, padding_length)
         VALUES ($1, $2, $3, 0, 4)
         RETURNING id, prefix, suffix, current_number, padding_length`,
        [tenantId, documentType, defaultPrefix],
      );
      series = inserted[0];
    }
    if (!series) {
      throw new Error(`Failed to allocate number series for ${documentType}`);
    }

    const nextNumber = Number(series.current_number) + 1;
    await m.query(
      `UPDATE number_series SET current_number = $1, updated_at = now() WHERE id = $2`,
      [nextNumber, series.id],
    );

    const prefix = series.prefix ?? defaultPrefix ?? '';
    const suffix = series.suffix ?? '';
    const padded = String(nextNumber).padStart(Number(series.padding_length) || 4, '0');
    return `${prefix}${padded}${suffix}`;
  }
}
