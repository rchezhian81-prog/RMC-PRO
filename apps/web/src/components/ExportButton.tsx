'use client';

import { Download } from 'lucide-react';
import { toCsv, downloadCsv } from '../lib/csv';
import { Button } from './ui/Button';
import { todayLocal } from '../lib/report-range';

/** Reusable "Export CSV" action for any list/register. */
export function ExportButton({
  rows,
  columns,
  filename,
  label = 'Export CSV',
}: {
  rows: Array<Record<string, unknown>>;
  columns: string[];
  filename: string;
  label?: string;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      icon={<Download size={15} />}
      disabled={!rows.length}
      onClick={() => downloadCsv(`${filename}-${todayLocal()}`, toCsv(rows, columns))}
    >
      {label}
    </Button>
  );
}
