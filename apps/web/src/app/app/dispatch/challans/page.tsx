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
const inr = (v: unknown) => '₹' + Number(v ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface WastageBucket { key: string; label: string; quantityM3: number; cost: number; share: number }

export default function ChallansPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [wastage, setWastage] = useState<Row | null>(null);

  useEffect(() => {
    challansApi.list().then(setRows).catch((e) => setError(String(e)));
  }, []);

  async function loadWastage() {
    setError(null);
    try { setWastage(await challansApi.wastageReport()); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
  }

  const byReason = (wastage?.byReason as WastageBucket[] | undefined) ?? null;

  return (
    <div>
      <h1 style={{ fontSize: 24, marginTop: 0, marginBottom: 16 }}>Delivery Challans</h1>
      {error && <div style={{ marginBottom: 14 }}><ErrorState message={error} /></div>}

      <div style={{ marginBottom: 18 }}>
        <Card title="Returned concrete / wastage (delivered)" padded={false}
          actions={<Button variant="secondary" size="sm" onClick={loadWastage}>Refresh</Button>}
        >
          {wastage ? (
            byReason && byReason.length ? (
              <div>
                <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', padding: '12px 16px', borderBottom: '1px solid var(--mn-border)', fontSize: 13 }}>
                  <span><strong>{money(wastage.totalReturnedM3)}</strong> m³ returned</span>
                  <span><strong>{inr(wastage.totalReturnCost)}</strong> wasted value</span>
                </div>
                <Table>
                  <thead><tr><Th>Reason</Th><Th numeric>Returned m³</Th><Th numeric>Value</Th><Th numeric>Share</Th></tr></thead>
                  <tbody>
                    {byReason.map((b) => (
                      <tr key={b.key}><Td>{b.label}</Td><Td numeric>{money(b.quantityM3)}</Td><Td numeric>{inr(b.cost)}</Td><Td numeric>{b.share}%</Td></tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            ) : (
              <EmptyState title="No wastage" description="No returned concrete recorded on delivered challans." />
            )
          ) : (
            <EmptyState title="Wastage report" description="Refresh to summarise returned concrete by reason and value." />
          )}
        </Card>
      </div>
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
