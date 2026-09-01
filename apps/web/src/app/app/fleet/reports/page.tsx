'use client';

import { useEffect, useState } from 'react';
import { fleetReportsApi, type Row } from '../../../../lib/api';
import { Card } from '../../../../components/ui/Card';
import { Table, Th, Td } from '../../../../components/ui/Table';
import { StatCard } from '../../../../components/ui/StatCard';
import { Button } from '../../../../components/ui/Button';
import { Field, Input } from '../../../../components/ui/Field';
import { ExportButton } from '../../../../components/ExportButton';
import { ErrorState, EmptyState, TableSkeleton } from '../../../../components/ui/States';

const money = (v: unknown) => '₹' + Number(v ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });
const num1 = (v: unknown) => (v == null ? '—' : Number(v).toLocaleString('en-IN', { maximumFractionDigits: 1 }));
const num2 = (v: unknown) => (v == null ? '—' : Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 }));

export default function FleetRunningCostPage() {
  const [data, setData] = useState<{ rows: Row[]; totals: Row } | null>(null);
  const [range, setRange] = useState({ from: '', to: '' });
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  async function load(from = range.from, to = range.to) {
    setError(null);
    setData(await fleetReportsApi.runningCost(from || undefined, to || undefined));
  }

  useEffect(() => {
    load().catch((e) => setError(String(e))).finally(() => setLoaded(true));
  }, []);

  const rows = data?.rows ?? [];
  const t = data?.totals;

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div>
        <h1 style={{ fontSize: 24, margin: '0 0 4px' }}>Fleet Running Cost</h1>
        <p style={{ color: 'var(--mn-muted)', fontSize: 13, margin: 0 }}>
          Maintenance (completed jobs) + diesel per vehicle, with running cost per km and km/litre.
        </p>
      </div>
      {error && <ErrorState message={error} />}

      <Card title="Period">
        <div style={{ display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 150 }}><Field label="From"><Input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></Field></div>
          <div style={{ minWidth: 150 }}><Field label="To"><Input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></Field></div>
          <Button variant="secondary" onClick={() => load().catch((e) => setError(String(e)))}>Apply</Button>
          {(range.from || range.to) && <Button variant="ghost" onClick={() => { setRange({ from: '', to: '' }); load('', '').catch((e) => setError(String(e))); }}>Clear</Button>}
          <span style={{ color: 'var(--mn-muted)', fontSize: 12 }}>Maintenance by completed date, fuel by fuel date. Leave blank for all-time.</span>
        </div>
      </Card>

      {t && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
          <StatCard label="Total cost" value={money(t.totalCost)} tone="info" />
          <StatCard label="Maintenance" value={money(t.maintenanceCost)} />
          <StatCard label="Fuel" value={money(t.fuelCost)} />
          <StatCard label="Cost / km" value={t.costPerKm == null ? '—' : money(t.costPerKm)} />
        </div>
      )}

      <Card
        title="Per-vehicle running cost"
        padded={false}
        actions={<ExportButton rows={rows} columns={['vehicleNo', 'vehicleType', 'maintenanceCost', 'fuelCost', 'totalCost', 'distanceKm', 'costPerKm', 'kmPerLitre']} filename="fleet-running-cost" />}
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
                  <Th numeric>Maintenance</Th>
                  <Th numeric>Fuel</Th>
                  <Th numeric>Total</Th>
                  <Th numeric>Distance km</Th>
                  <Th numeric>Cost / km</Th>
                  <Th numeric>km / L</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <Td style={{ fontWeight: 600 }}>{String(r.vehicleNo)}</Td>
                    <Td>{String(r.vehicleType ?? '—')}</Td>
                    <Td numeric>{money(r.maintenanceCost)}</Td>
                    <Td numeric>{money(r.fuelCost)}</Td>
                    <Td numeric style={{ fontWeight: 600 }}>{money(r.totalCost)}</Td>
                    <Td numeric>{num1(r.distanceKm)}</Td>
                    <Td numeric>{r.costPerKm == null ? '—' : money(r.costPerKm)}</Td>
                    <Td numeric>{num2(r.kmPerLitre)}</Td>
                  </tr>
                ))}
              </tbody>
              {t && (
                <tfoot>
                  <tr>
                    <Td style={{ fontWeight: 700 }}>Fleet</Td>
                    <Td />
                    <Td numeric style={{ fontWeight: 700 }}>{money(t.maintenanceCost)}</Td>
                    <Td numeric style={{ fontWeight: 700 }}>{money(t.fuelCost)}</Td>
                    <Td numeric style={{ fontWeight: 700 }}>{money(t.totalCost)}</Td>
                    <Td numeric style={{ fontWeight: 700 }}>{num1(t.distanceKm)}</Td>
                    <Td numeric style={{ fontWeight: 700 }}>{t.costPerKm == null ? '—' : money(t.costPerKm)}</Td>
                    <Td numeric style={{ fontWeight: 700 }}>{num2(t.kmPerLitre)}</Td>
                  </tr>
                </tfoot>
              )}
            </Table>
          </div>
        ) : (
          <EmptyState title="No fleet costs in range" description="Log maintenance jobs and fuel entries to see running cost." />
        )}
      </Card>
    </div>
  );
}
