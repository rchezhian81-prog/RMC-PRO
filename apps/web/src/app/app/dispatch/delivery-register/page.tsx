'use client';

import { useEffect, useState } from 'react';
import { challansApi, dispatchApi, type Row } from '../../../../lib/api';
import { Card } from '../../../../components/ui/Card';
import { Table, Th, Td } from '../../../../components/ui/Table';
import { StatCard } from '../../../../components/ui/StatCard';
import { Button } from '../../../../components/ui/Button';
import { Field, Input } from '../../../../components/ui/Field';
import { ExportButton } from '../../../../components/ExportButton';
import { ErrorState, EmptyState, TableSkeleton } from '../../../../components/ui/States';

const m3 = (v: unknown) => Number(v ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 3 });

export default function DeliveryRegisterPage() {
  const [data, setData] = useState<{ rows: Row[]; totalM3: number; count: number } | null>(null);
  const [cycle, setCycle] = useState<{ rows: Row[]; averages: Row; count: number } | null>(null);
  const [range, setRange] = useState({ from: '', to: '' });
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  async function load(from = range.from, to = range.to) {
    setError(null);
    const [reg, cyc] = await Promise.all([
      challansApi.deliveryRegister({ from: from || undefined, to: to || undefined }),
      dispatchApi.cycleTimes(from || undefined, to || undefined),
    ]);
    setData(reg);
    setCycle(cyc);
  }

  useEffect(() => {
    load().catch((e) => setError(String(e))).finally(() => setLoaded(true));
  }, []);

  const rows = data?.rows ?? [];

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div>
        <h1 style={{ fontSize: 24, margin: '0 0 4px' }}>Delivery Register</h1>
        <p style={{ color: 'var(--mn-muted)', fontSize: 13, margin: 0 }}>Concrete delivered (net of returns), by challan — the daily supply record.</p>
      </div>
      {error && <ErrorState message={error} />}

      <Card title="Period">
        <div style={{ display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 150 }}><Field label="From"><Input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></Field></div>
          <div style={{ minWidth: 150 }}><Field label="To"><Input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></Field></div>
          <Button variant="secondary" onClick={() => load().catch((e) => setError(String(e)))}>Apply</Button>
          {(range.from || range.to) && <Button variant="ghost" onClick={() => { setRange({ from: '', to: '' }); load('', '').catch((e) => setError(String(e))); }}>Clear</Button>}
          <span style={{ color: 'var(--mn-muted)', fontSize: 12 }}>Bounds by delivery date. Leave blank for all-time.</span>
        </div>
      </Card>

      {data && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
          <StatCard label="Delivered m³" value={m3(data.totalM3)} tone="info" />
          <StatCard label="Challans" value={String(data.count)} />
        </div>
      )}

      <Card
        title="Delivery register"
        padded={false}
        actions={<ExportButton rows={rows} columns={['date', 'challanNo', 'customerName', 'gradeLabel', 'delivered']} filename="delivery-register" />}
      >
        {!loaded ? (
          <TableSkeleton cols={5} />
        ) : rows.length ? (
          <Table>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Challan</Th>
                <Th>Customer</Th>
                <Th>Grade</Th>
                <Th numeric>Delivered m³</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <Td>{String(r.date ?? '')}</Td>
                  <Td style={{ fontWeight: 600 }}>{String(r.challanNo)}</Td>
                  <Td>{String(r.customerName ?? '')}</Td>
                  <Td>{String(r.gradeLabel ?? '')}</Td>
                  <Td numeric>{m3(r.delivered)}</Td>
                </tr>
              ))}
            </tbody>
            {data && (
              <tfoot>
                <tr>
                  <Td style={{ fontWeight: 700 }}>Total</Td>
                  <Td /><Td /><Td />
                  <Td numeric style={{ fontWeight: 700 }}>{m3(data.totalM3)}</Td>
                </tr>
              </tfoot>
            )}
          </Table>
        ) : (
          <EmptyState title="No deliveries" description="Delivered challans in the period will appear here." />
        )}
      </Card>

      {cycle && cycle.averages && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12 }}>
          <StatCard label="Avg travel (min)" value={cycle.averages.travelMin == null ? '—' : String(cycle.averages.travelMin)} />
          <StatCard label="Avg on-site wait (min)" value={cycle.averages.waitMin == null ? '—' : String(cycle.averages.waitMin)} />
          <StatCard label="Avg pour (min)" value={cycle.averages.pourMin == null ? '—' : String(cycle.averages.pourMin)} />
          <StatCard label="Avg turnaround (min)" value={cycle.averages.turnaroundMin == null ? '—' : String(cycle.averages.turnaroundMin)} tone="info" />
        </div>
      )}

      <Card
        title={`Cycle times${cycle ? ` — ${cycle.count} completed trips` : ''}`}
        padded={false}
        actions={<ExportButton rows={cycle?.rows ?? []} columns={['dispatchNo', 'gradeLabel', 'travelMin', 'waitMin', 'pourMin', 'turnaroundMin']} filename="dispatch-cycle-times" />}
      >
        {!loaded ? (
          <TableSkeleton cols={6} />
        ) : cycle?.rows?.length ? (
          <Table>
            <thead>
              <tr>
                <Th>Dispatch</Th>
                <Th>Grade</Th>
                <Th numeric>Travel</Th>
                <Th numeric>Wait</Th>
                <Th numeric>Pour</Th>
                <Th numeric>Turnaround</Th>
              </tr>
            </thead>
            <tbody>
              {cycle.rows.map((r, i) => {
                const mn = (v: unknown) => (v == null ? '—' : `${String(v)}m`);
                return (
                  <tr key={i}>
                    <Td style={{ fontWeight: 600 }}>{String(r.dispatchNo)}</Td>
                    <Td>{String(r.gradeLabel ?? '')}</Td>
                    <Td numeric>{mn(r.travelMin)}</Td>
                    <Td numeric>{mn(r.waitMin)}</Td>
                    <Td numeric>{mn(r.pourMin)}</Td>
                    <Td numeric style={{ fontWeight: 600 }}>{mn(r.turnaroundMin)}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="No completed trips" description="Completed dispatches with pour times appear here (travel, on-site wait, pour, turnaround)." />
        )}
      </Card>
    </div>
  );
}
