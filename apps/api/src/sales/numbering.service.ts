import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { financialYearOf, formatSeriesNumber, rolloverSuffix } from './numbering.util';
import { businessToday } from '../common/business-date.util';

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

/**
 * The financial year a number is drawn in is decided on the PLANT's date. On a
 * UTC clock, 1 April before 05:30 IST is still 31 March, so the first documents
 * of a new financial year would have been numbered into the old year's series —
 * on the one day of the year when that is least forgivable.
 */
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
  /**
   * Select (or provision) the series row FOR UPDATE for the financial year the
   * document is dated in.
   *
   * One row per (tenant, document type, plant, financial year). A yearly-reset
   * series used to reset the SAME row to 0 when the FY changed, so the first
   * allocation after 1 April produced INV-0001 again: the document table's
   * unique index rejected it, the whole transaction (including the reset) rolled
   * back, and every retry failed identically for every numbered document type.
   * The offline reservation path committed the reset and handed devices last
   * year's strings. Now the new FY gets its own row, numbered from 1 and carrying
   * the FY token in its suffix (INV-0001/27-28), so no string can repeat.
   *
   *  - reset 'never', or a legacy row not yet stamped with an FY → that row is
   *    used as-is (a legacy row adopts the current FY without resetting);
   *  - a row already stamped with THIS FY → used;
   *  - otherwise a new row for this FY is created from the latest previous row
   *    (prefix, padding, reset frequency; suffix per rolloverSuffix). The
   *    previous row is locked first so two callers at the FY boundary cannot
   *    both create it; where no previous row exists to lock, the insert is
   *    ON CONFLICT DO NOTHING and the loser re-picks the winner's row, so a
   *    cold start never costs anyone their document.
   */
  private async resolveSeries(
    m: EntityManager,
    tenantId: string,
    documentType: string,
    defaultPrefix: string,
    opts: NumberingOpts = {},
  ): Promise<ResolvedSeries> {
    const plantId = opts.plantId ?? null;
    const currentFy = opts.financialYear ?? financialYearOf(opts.date ?? businessToday());

    const plantClause = plantId ? 'AND plant_id = $3' : 'AND plant_id IS NULL';
    const keyParams = plantId ? [tenantId, documentType, plantId] : [tenantId, documentType];
    const fyParam = `$${keyParams.length + 1}`;
    const cols = 'id, prefix, suffix, current_number, padding_length, financial_year, reset_frequency';

    const pick = async (): Promise<SeriesRow | undefined> => {
      const rows: SeriesRow[] = await m.query(
        `SELECT ${cols} FROM number_series
          WHERE tenant_id = $1 AND document_type = $2 AND is_active = true ${plantClause}
            AND (financial_year = ${fyParam} OR financial_year IS NULL OR COALESCE(reset_frequency, 'yearly') <> 'yearly')
          ORDER BY CASE WHEN financial_year = ${fyParam} THEN 0 ELSE 1 END, created_at ASC
          LIMIT 1
          FOR UPDATE`,
        [...keyParams, currentFy],
      );
      return rows[0];
    };

    let series = await pick();
    if (!series) {
      // No row for this FY: lock the latest previous row (the template), then
      // look again — a concurrent caller may have created the FY row meanwhile.
      const previous: SeriesRow[] = await m.query(
        `SELECT ${cols} FROM number_series
          WHERE tenant_id = $1 AND document_type = $2 AND is_active = true ${plantClause}
          ORDER BY financial_year DESC NULLS LAST, created_at DESC
          LIMIT 1
          FOR UPDATE`,
        keyParams,
      );
      series = await pick();
      if (!series) {
        const template = previous[0];
        // ON CONFLICT DO NOTHING, not a bare INSERT. Two callers can reach here
        // together when NO row exists yet for this key — the first document of a
        // type, and every 1 April, when every series needs its new financial-year
        // row at once and a plant is already batching. A plain INSERT made the
        // loser fail with the unique violation, which surfaced to the operator as
        // "A record with the same code already exists." — about a code they never
        // typed. Worse, a raised error poisons the whole transaction, so it could
        // not be caught and retried in place; DO NOTHING keeps the transaction
        // healthy. Under READ COMMITTED the loser blocks until the winner
        // commits, then re-picks and sees the winner's row.
        //
        // Measured before this: 40 simultaneous first-of-type creates produced 34
        // leads and 6 refusals. After: 40 of 40, gapless, no duplicates.
        const inserted: SeriesRow[] = await m.query(
          `INSERT INTO number_series (tenant_id, document_type, plant_id, prefix, suffix, current_number, padding_length, financial_year, reset_frequency)
           VALUES ($1, $2, $3, $4, $5, 0, $6, $7, $8)
           ON CONFLICT DO NOTHING
           RETURNING ${cols}`,
          [
            tenantId, documentType, plantId,
            template?.prefix ?? defaultPrefix,
            template ? rolloverSuffix(template.suffix, template.financial_year, currentFy) : null,
            Number(template?.padding_length) || 4,
            currentFy,
            template?.reset_frequency ?? 'yearly',
          ],
        );
        // Nothing returned means someone else won the race and has now committed.
        // Re-pick to take the lock on THEIR row rather than failing the document.
        series = inserted[0] ?? (await pick());
      }
    }
    if (!series) throw new Error(`Failed to allocate number series for ${documentType}`);

    // A legacy yearly row with no FY stamped adopts the current FY, keeping its
    // counter (an existing continuous series is not reset the first time this runs).
    const yearly = (series.reset_frequency ?? 'yearly') === 'yearly';
    if (yearly && !series.financial_year) {
      await m.query(`UPDATE number_series SET financial_year = $1, updated_at = now() WHERE id = $2`, [currentFy, series.id]);
      series = { ...series, financial_year: currentFy };
    }

    return {
      id: series.id,
      prefix: series.prefix,
      suffix: series.suffix,
      paddingLength: Number(series.padding_length) || 4,
      currentNumber: Number(series.current_number),
      financialYear: series.financial_year,
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
