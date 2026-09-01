'use client';

import { useEffect, useState } from 'react';
import { dispatchApi, type Row } from '../../../../lib/api';
import { Card } from '../../../../components/ui/Card';
import { Table, Th, Td } from '../../../../components/ui/Table';
import { StatCard } from '../../../../components/ui/StatCard';
import { Button } from '../../../../components/ui/Button';
import { Field, Input } from '../../../../components/ui/Field';
import { ExportButton } from '../../../../components/ExportButton';
import { ErrorState, EmptyState, TableSkeleton } from '../../../../components/ui/States';

const m3 = (v: unknown) => Number(v ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 3 });
const num1 = (v: unknown) => (v == null ? '—' : Number(v).toLocaleString('en-IN', { maximumFractionDigits: 1 }));

export default function FleetUtilizationPage() {
  const [data, setData] = useState<{ rows: Row[]; totals: Row } | null>(null);
  const [driver, setDriver] = useState<{ rows: Row[]; totals: Row } | null>(null);
  const [range, setRange] = useState({ from: '', to: '' });
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  async function load(from = range.from, to = range.to) {
    setError(null);
    const [fu, dp] = await Promise.all([
      dispatchApi.fleetUtilization(from || undefined, to || undefined),
      dispatchApi.driverProductivity(from || undefined, to || undefined),
    ]);
    setData(fu);
    setDriver(dp);
  }

  useEffect(() => {
    load().catch((e) => setError(String(e))).finally(() => setLoaded(true));
  }, []);

  const rows = data?.rows ?? [];
  const t = data?.totals;

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div>
        <h1 style={{ fontSize: 24, margin: '0 0 4px' }}>Fleet Utilization</h1>
        <p style={{ color: 'var(--mn-muted)', fontSize: 13, margin: 0 }}>
          Completed trips, concrete delivered, average turnaround and load factor per vehicle — including idle trucks.
        </p>
      </div>
      {error && <ErrorState message={error} />}

      <Card title="Period">
        <div style={{ display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 150 }}><Field label="From"><Input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></Field></div>
          <div style={{ minWidth: 150 }}><Field label="To"><Input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></Field></div>
          <Button variant="secondary" onClick={() => load().catch((e) => setError(String(e)))}>Apply</Button>
          {(range.from || range.to) && <Button variant="ghost" onClick={() => { setRange({ from: '', to: '' }); load('', '').catch((e) => setError(String(e))); }}>Clear</Button>}
          <span style={{ color: 'var(--mn-muted)', fontSize: 12 }}>Bounds by dispatch date. Leave blank for all-time.</span>
        </div>
      </Card>

      {t && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
          <StatCard label="Trips" value={String(t.trips ?? 0)} tone="info" />
          <StatCard label="Delivered m³" value={m3(t.totalM3)} />
          <StatCard label="Active vehicles" value={String(t.activeVehicles ?? 0)} />
          <StatCard label="Fleet size" value={String(t.vehicles ?? 0)} />
        </div>
      )}

      <Card
        title="Per-vehicle utilization"
        padded={false}
        actions={<ExportButton rows={rows} columns={['vehicleNo', 'vehicleType', 'capacityM3', 'trips', 'totalM3', 'avgTurnaroundMin', 'avgLoadPct']} filename="fleet-utilization" />}
      >
        {!loaded ? (
          <TableSkeleton cols={7} />
        ) : rows.length ? (
          <div style={{ overflowX: 'auto' }}>
            <Table>
              <thead>
                <tr>
                  <Th>Vehicle</Th>
                  <Th>Type</Th>
                  <Th numeric>Capacity m³</Th>
                  <Th numeric>Trips</Th>
                  <Th numeric>Delivered m³</Th>
                  <Th numeric>Avg turnaround</Th>
                  <Th numeric>Avg load %</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} style={{ opacity: Number(r.trips) > 0 ? 1 : 0.55 }}>
                    <Td style={{ fontWeight: 600 }}>{String(r.vehicleNo)}</Td>
                    <Td>{String(r.vehicleType ?? '—')}</Td>
                    <Td numeric>{num1(r.capacityM3)}</Td>
                    <Td numeric>{String(r.trips)}</Td>
                    <Td numeric>{m3(r.totalM3)}</Td>
                    <Td numeric>{r.trips && Number(r.avgTurnaroundMin) ? `${num1(r.avgTurnaroundMin)}m` : '—'}</Td>
                    <Td numeric>{r.avgLoadPct == null ? '—' : `${num1(r.avgLoadPct)}%`}</Td>
                  </tr>
                ))}
              </tbody>
              {t && (
                <tfoot>
                  <tr>
                    <Td style={{ fontWeight: 700 }}>Fleet</Td>
                    <Td /><Td />
                    <Td numeric style={{ fontWeight: 700 }}>{String(t.trips)}</Td>
                    <Td numeric style={{ fontWeight: 700 }}>{m3(t.totalM3)}</Td>
                    <Td /><Td />
                  </tr>
                </tfoot>
              )}
            </Table>
          </div>
        ) : (
          <EmptyState title="No vehicles" description="Register vehicles and complete dispatches to see utilization." />
        )}
      </Card>

      <Card
        title={`Driver productivity${driver?.totals ? ` — ${String(driver.totals.trips ?? 0)} trips · ${m3(driver.totals.totalM3)} m³` : ''}`}
        padded={false}
        actions={<ExportButton rows={driver?.rows ?? []} columns={['driverName', 'driverCode', 'trips', 'totalM3', 'avgTurnaroundMin', 'm3PerTrip']} filename="driver-productivity" />}
      >
        {!loaded ? (
          <TableSkeleton cols={6} />
        ) : driver?.rows?.length ? (
          <div style={{ overflowX: 'auto' }}>
            <Table>
              <thead>
                <tr>
                  <Th>Driver</Th>
                  <Th>Code</Th>
                  <Th numeric>Trips</Th>
                  <Th numeric>Delivered m³</Th>
                  <Th numeric>Avg turnaround</Th>
                  <Th numeric>m³ / trip</Th>
                </tr>
              </thead>
              <tbody>
                {driver.rows.map((r, i) => (
                  <tr key={i} style={{ opacity: Number(r.trips) > 0 ? 1 : 0.55 }}>
                    <Td style={{ fontWeight: 600 }}>{String(r.driverName ?? '—')}</Td>
                    <Td>{String(r.driverCode ?? '—')}</Td>
                    <Td numeric>{String(r.trips)}</Td>
                    <Td numeric>{m3(r.totalM3)}</Td>
                    <Td numeric>{r.trips && Number(r.avgTurnaroundMin) ? `${num1(r.avgTurnaroundMin)}m` : '—'}</Td>
                    <Td numeric>{r.trips ? m3(r.m3PerTrip) : '—'}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        ) : (
          <EmptyState title="No drivers" description="Register drivers and complete dispatches to see productivity." />
        )}
      </Card>
    </div>
  );
}
