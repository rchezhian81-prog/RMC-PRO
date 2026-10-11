'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Download, FileSpreadsheet, FileText, Printer } from 'lucide-react';
import { toCsv, downloadCsv } from '../lib/csv';
import { downloadXlsx } from '../lib/xlsx';
import { printTable } from '../lib/print-table';
import { columnsWithLabels } from '../lib/column-labels';
import { company } from '../lib/api';
import { Button } from './ui/Button';
import { todayLocal } from '../lib/report-range';

let companyNameCache: string | null | undefined;
/** The company name for the print header — fetched once per page load, never fatal. */
async function companyName(): Promise<string | null> {
  if (companyNameCache !== undefined) return companyNameCache;
  try {
    const c = await company.get();
    companyNameCache = c?.companyName ? String(c.companyName) : null;
  } catch {
    companyNameCache = null;
  }
  return companyNameCache;
}

/**
 * Reusable "Export" action for any list/register: a small menu offering the
 * same rows and columns as CSV, as an Excel workbook (.xlsx) or as a PDF
 * through the browser's print dialog. Headings come from `labels` where the
 * screen gives them and are read from the column keys otherwise.
 */
export function ExportButton({
  rows,
  columns,
  filename,
  label = 'Export',
  labels,
  title,
  subtitle,
}: {
  rows: Array<Record<string, unknown>>;
  columns: string[];
  filename: string;
  label?: string;
  /** Headings for the keys whose plain reading is wrong, e.g. { m3: 'Quantity (m³)' }. */
  labels?: Record<string, string>;
  /** The list's name on the PDF and the sheet tab; defaults to the filename. */
  title?: string;
  /** Under the title on the PDF — the period or the filter. */
  subtitle?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const name = `${filename}-${todayLocal()}`;
  const heading = title ?? filename.replace(/[-_]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
  const cols = columnsWithLabels(columns, labels);

  async function pick(kind: 'csv' | 'xlsx' | 'pdf') {
    setOpen(false);
    setError(null);
    try {
      if (kind === 'csv') downloadCsv(name, toCsv(rows, columns));
      else if (kind === 'xlsx') downloadXlsx(name, { name: heading, columns: cols, rows });
      else printTable({ title: heading, subtitle, columns: cols, rows, companyName: await companyName() });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The export could not be produced.');
    }
  }

  return (
    <div className="mn-export" ref={wrap}>
      <Button
        variant="ghost"
        size="sm"
        icon={<Download size={15} />}
        disabled={!rows.length}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {label}
        <ChevronDown size={13} aria-hidden />
      </Button>
      {open && (
        <div className="mn-export-menu" role="menu" aria-label="Export format">
          <button type="button" role="menuitem" className="mn-export-item" onClick={() => pick('csv')}>
            <FileText size={14} aria-hidden /> CSV
          </button>
          <button type="button" role="menuitem" className="mn-export-item" onClick={() => pick('xlsx')}>
            <FileSpreadsheet size={14} aria-hidden /> Excel (.xlsx)
          </button>
          <button type="button" role="menuitem" className="mn-export-item" onClick={() => pick('pdf')}>
            <Printer size={14} aria-hidden /> PDF
          </button>
        </div>
      )}
      {error && <span className="mn-export-error" role="alert">{error}</span>}
    </div>
  );
}
