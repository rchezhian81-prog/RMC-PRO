'use client';

import { Download } from 'lucide-react';
import { toCsv, downloadCsv } from '../lib/csv';
import { Button } from './ui/Button';

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
      onClick={() => downloadCsv(`${filename}-${new Date().toISOString().slice(0, 10)}`, toCsv(rows, columns))}
    >
      {label}
    </Button>
  );
}
