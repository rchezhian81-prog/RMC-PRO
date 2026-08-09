'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { batchTicketsApi, type Row } from '../../../../lib/api';
import { Card } from '../../../../components/ui/Card';
import { Table, Th, Td } from '../../../../components/ui/Table';
import { Badge, StatusBadge } from '../../../../components/ui/Badge';
import { Button } from '../../../../components/ui/Button';
import { ErrorState, EmptyState } from '../../../../components/ui/States';

const money = (v: unknown) => Number(v ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });

export default function BatchTicketsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    batchTicketsApi.list().then(setRows).catch((e) => setError(String(e)));
  }, []);

  return (
    <div>
      <h1 style={{ fontSize: 24, marginTop: 0, marginBottom: 4 }}>Batch Tickets</h1>
      <p style={{ color: 'var(--mn-muted)', fontSize: 13, margin: '0 0 16px', maxWidth: 720 }}>
        Manual batch production records. Confirming reduces inventory from actual consumption.
      </p>
      {error && <div style={{ marginBottom: 14 }}><ErrorState message={error} /></div>}
      <Card title="Batch tickets" padded={false}>
        {rows.length ? (
          <Table>
            <thead>
              <tr>
                <Th>Batch No</Th>
                <Th>Grade</Th>
                <Th numeric>Qty m³</Th>
                <Th>Variance</Th>
                <Th>Status</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <Td style={{ fontWeight: 600 }}>{String(r.batchTicketNo ?? '')}</Td>
                  <Td>{String(r.gradeLabel ?? '—')}</Td>
                  <Td numeric>{money(r.batchQuantityM3)}</Td>
                  <Td>
                    {r.varianceExceeded ? <Badge tone="warning">exceeded</Badge> : <Badge tone="success">ok</Badge>}
                  </Td>
                  <Td><StatusBadge status={String(r.status)} /></Td>
                  <Td style={{ textAlign: 'right' }}>
                    <Link href={`/app/production/batch-tickets/${r.id}`}>
                      <Button variant="secondary" size="sm">Open</Button>
                    </Link>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="No batch tickets yet" description="Start a batch from the queue to create one." />
        )}
      </Card>
    </div>
  );
}
