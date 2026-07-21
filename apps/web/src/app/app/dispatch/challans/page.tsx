'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { challansApi, type Row } from '../../../../lib/api';
import { Card } from '../../../../components/ui/Card';
import { Table, Th, Td } from '../../../../components/ui/Table';
import { StatusBadge } from '../../../../components/ui/Badge';
import { Button } from '../../../../components/ui/Button';
import { ErrorState, EmptyState } from '../../../../components/ui/States';

const money = (v: unknown) => Number(v ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 3 });

export default function ChallansPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    challansApi.list().then(setRows).catch((e) => setError(String(e)));
  }, []);

  return (
    <div>
      <h1 style={{ fontSize: 24, marginTop: 0, marginBottom: 16 }}>Delivery Challans</h1>
      {error && <div style={{ marginBottom: 14 }}><ErrorState message={error} /></div>}
      <Card title="Challans" padded={false}>
        {rows.length ? (
          <Table>
            <thead>
              <tr>
                <Th>Challan No</Th>
                <Th>Grade</Th>
                <Th numeric>Qty m³</Th>
                <Th>Invoice</Th>
                <Th>Status</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <Td style={{ fontWeight: 600 }}>{String(r.challanNo ?? '')}</Td>
                  <Td>{String(r.gradeLabel ?? '—')}</Td>
                  <Td numeric>{money(r.quantityM3)}</Td>
                  <Td>{String(r.invoiceStatus ?? '')}</Td>
                  <Td><StatusBadge status={String(r.challanStatus)} /></Td>
                  <Td style={{ textAlign: 'right' }}>
                    <Link href={`/app/dispatch/challans/${r.id}`}>
                      <Button variant="secondary" size="sm">Open</Button>
                    </Link>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="No challans yet" description="Challans generated from dispatches will appear here." />
        )}
      </Card>
    </div>
  );
}
