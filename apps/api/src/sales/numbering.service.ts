import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { financialYearOf, formatSeriesNumber, applyYearlyReset } from './numbering.util';

interface SeriesRow {
  id: string;
  prefix: string | null;
  suffix: string | null;
  current_number: number;
  padding_length: number;
  financial_year: string | null;
  reset_frequency: string | null;
}

/** Optional scoping for a numbering call (Plan F2). */
export interface NumberingOpts {
  /** Per-plant series; omit for the tenant-wide series (the default). */
  plantId?: string | null;
  /** Number in a specific financial year; else derived from `date` / today. */
  financialYear?: string;
  /** ISO date the document is dated — drives the FY when `financialYear` is absent. */
  date?: string;
}

interface ResolvedSeries {
  id: string;
  prefix: string | null;
  suffix: string | null;
  paddingLength: number;
  currentNumber: number;
  financialYear: string | null;
}

const todayIso = (): string => new Date().toISOString().slice(0, 10);
const defaultPrefixFor = (documentType: string): string => documentType.slice(0, 3).toUpperCase() + '-';

/**
 * Atomic document numbering (Design Doc 6 §5.4, Doc 11 §7; activated in Plan F2).
 * Runs INSIDE the caller's tenant transaction so the number is only consumed if
 * the surrounding document write commits. `SELECT ... FOR UPDATE` serialises
 * concurrent callers on the same series row, preventing duplicate numbers.
 *
 * The series is keyed by (tenant, document type, plant, financial year):
 *   - a per-plant series is used when `opts.plantId` is given, else the
 *     tenant-wide series (`plant_id IS NULL`);
 *   - a `yearly` reset series (the default) rolls over and restarts at 1 when the
 *     financial year changes, so each FY's documents number from 0001.
 * Existing callers pass no options and get the tenant-wide, current-FY series —
 * unchanged behaviour, now FY-aware.
 */
@Injectable()
export class NumberingService {
  /** Select (or provision) the series row FOR UPDATE and apply any FY roll-over. */
  private async resolveSeries(
    m: EntityManager,
    tenantId: string,
    documentType: string,
    defaultPrefix: string,
    opts: NumberingOpts = {},
  ): Promise<ResolvedSeries> {
    const plantId = opts.plantId ?? null;
    const currentFy = opts.financialYear ?? financialYearOf(opts.date ?? todayIso());

    const plantClause = plantId ? 'AND plant_id = $3' : 'AND plant_id IS NULL';
    const selectParams = plantId ? [tenantId, documentType, plantId] : [tenantId, documentType];
    const existing: SeriesRow[] = await m.query(
      `SELECT id, prefix, suffix, current_number, padding_length, financial_year, reset_frequency
         FROM number_series
        WHERE tenant_id = $1 AND document_type = $2 AND is_active = true ${plantClause}
        ORDER BY created_at ASC
        LIMIT 1
        FOR UPDATE`,
      selectParams,
    );

    let series: SeriesRow | undefined = existing[0];
    if (!series) {
      const inserted: SeriesRow[] = await m.query(
        `INSERT INTO number_series (tenant_id, document_type, plant_id, prefix, current_number, padding_length, financial_year)
         VALUES ($1, $2, $3, $4, 0, 4, $5)
         RETURNING id, prefix, suffix, current_number, padding_length, financial_year, reset_frequency`,
        [tenantId, documentType, plantId, defaultPrefix, currentFy],
      );
      series = inserted[0];
    }
    if (!series) throw new Error(`Failed to allocate number series for ${documentType}`);

    const reset = applyYearlyReset({
      resetFrequency: series.reset_frequency,
      seriesFy: series.financial_year,
      currentFy,
      currentNumber: Number(series.current_number),
    });
    if (reset.didReset || reset.financialYear !== series.financial_year) {
      await m.query(
        `UPDATE number_series SET financial_year = $1, current_number = $2, updated_at = now() WHERE id = $3`,
        [reset.financialYear, reset.currentNumber, series.id],
      );
    }

    return {
      id: series.id,
      prefix: series.prefix,
      suffix: series.suffix,
      paddingLength: Number(series.padding_length) || 4,
      currentNumber: reset.currentNumber,
      financialYear: reset.financialYear,
    };
  }

  /** Allocate and format the next document number. */
  async next(
    m: EntityManager,
    tenantId: string,
    documentType: string,
    defaultPrefix: string,
    opts: NumberingOpts = {},
  ): Promise<string> {
    const series = await this.resolveSeries(m, tenantId, documentType, defaultPrefix, opts);
    const nextNumber = series.currentNumber + 1;
    await m.query(`UPDATE number_series SET current_number = $1, updated_at = now() WHERE id = $2`, [nextNumber, series.id]);
    return formatSeriesNumber({
      prefix: series.prefix ?? defaultPrefix ?? '',
      suffix: series.suffix,
      number: nextNumber,
      paddingLength: series.paddingLength,
    });
  }

  /**
   * Reserve a contiguous block of `count` numbers (Plan F2 — the reserved-number
   * pool, online or for an offline device). Advances the series past the block
   * and returns the range plus the formatted numbers. Runs in the caller's
   * transaction so the reservation is only committed with its surrounding write.
   */
  async reserve(
    m: EntityManager,
    tenantId: string,
    documentType: string,
    count: number,
    opts: NumberingOpts = {},
  ): Promise<{
    seriesId: string;
    prefix: string | null;
    suffix: string | null;
    paddingLength: number;
    financialYear: string | null;
    numberFrom: number;
    numberTo: number;
    numbers: string[];
  }> {
    const n = Math.max(1, Math.min(1000, Math.floor(Number(count) || 0)));
    const defaultPrefix = defaultPrefixFor(documentType);
    const series = await this.resolveSeries(m, tenantId, documentType, defaultPrefix, opts);
    const numberFrom = series.currentNumber + 1;
    const numberTo = series.currentNumber + n;
    await m.query(`UPDATE number_series SET current_number = $1, updated_at = now() WHERE id = $2`, [numberTo, series.id]);

    const prefix = series.prefix ?? defaultPrefix;
    const numbers: string[] = [];
    for (let x = numberFrom; x <= numberTo; x++) {
      numbers.push(formatSeriesNumber({ prefix, suffix: series.suffix, number: x, paddingLength: series.paddingLength }));
    }
    return {
      seriesId: series.id,
      prefix,
      suffix: series.suffix,
      paddingLength: series.paddingLength,
      financialYear: series.financialYear,
      numberFrom,
      numberTo,
      numbers,
    };
  }
}
