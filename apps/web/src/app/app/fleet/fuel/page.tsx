'use client';

import { useEffect, useState } from 'react';
import { crud, fleetApi, type Row } from '../../../../lib/api';
import { getAccess } from '../../../../lib/session';
import { Card } from '../../../../components/ui/Card';
import { Table, Th, Td } from '../../../../components/ui/Table';
import { Button } from '../../../../components/ui/Button';
import { Field, Input } from '../../../../components/ui/Field';
import { ErrorState, EmptyState } from '../../../../components/ui/States';

const money = (v: unknown) => Number(v ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });
const dec = (v: unknown) => (v === null || v === undefined ? '—' : Number(v).toLocaleString('en-IN'));

export default function FleetFuelPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [vehicles, setVehicles] = useState<Row[]>([]);
  const [summary, setSummary] = useState<Row | null>(null);
  const [filterVehicle, setFilterVehicle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Fuel entry form
  const [fVehicle, setFVehicle] = useState('');
  const [fDate, setFDate] = useState('');
  const [fOdo, setFOdo] = useState('');
  const [fLitres, setFLitres] = useState('');
  const [fRate, setFRate] = useState('');
  const [fFull, setFFull] = useState(true);
  const [fStation, setFStation] = useState('');

  const canRecord = getAccess().has('fleet.fuel.record');
  const vehLabel = (id: unknown) => String(vehicles.find((v) => String(v.id) === String(id))?.vehicleNo ?? '—');

  async function reload() {
    const [lg, vh] = await Promise.all([fleetApi.fuelLogs(filterVehicle || undefined), crud('vehicles').list()]);
    setRows(lg); setVehicles(vh);
    if (filterVehicle) setSummary(await fleetApi.fuelSummary(filterVehicle));
    else setSummary(null);
  }
  useEffect(() => {
    reload().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [filterVehicle]);

  async function create() {
    setError(null); setMsg(null);
    if (!fVehicle) { setError('Select a vehicle'); return; }
    if (!(Number(fOdo) > 0)) { setError('Enter the odometer reading'); return; }
    if (!(Number(fLitres) > 0)) { setError('Enter the litres filled'); return; }
    setBusy(true);
    try {
      const f = await fleetApi.createFuelLog({
        vehicleId: fVehicle, fuelDate: fDate || undefined, odometer: Number(fOdo),
        quantityLitres: Number(fLitres), ratePerLitre: fRate ? Number(fRate) : undefined,
        isTankFull: fFull, station: fStation || undefined,
      });
      const km = f.kmPerLitre != null ? ` — ${dec(f.kmPerLitre)} km/l` : '';
      setMsg(`Fuel logged for ${vehLabel(f.vehicleId)} (${dec(f.quantityLitres)} L)${km}.`);
      setFOdo(''); setFLitres(''); setFRate(''); setFStation('');
      await reload();
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(false); }
  }

  const sm = (summary?.summary as Row | undefined) ?? null;

  return (
    <div>
      <h1 style={{ fontSize: 24, marginTop: 0, marginBottom: 4 }}>Fuel Log</h1>
      <p style={{ color: 'var(--mn-muted)', fontSize: 13, margin: '0 0 16px' }}>Record diesel fills; a full tank yields km-per-litre and cost-per-km against the previous full tank.</p>
      {error && <div style={{ marginBottom: 14 }}><ErrorState message={error} /></div>}
      {msg && (
        <p style={{ color: 'var(--mn-success)', background: 'var(--mn-success-tint)', border: '1px solid var(--mn-success)', borderRadius: 'var(--mn-radius-md)', padding: '10px 12px', fontSize: 13 }}>{msg}</p>
      )}

      {canRecord && (
        <div style={{ marginBottom: 18 }}>
          <Card title="Log fuel">
            <div style={{ display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap' }}>
              <div style={{ minWidth: 170 }}>
                <Field label="Vehicle" required>
                  <select className="mn-input" value={fVehicle} onChange={(e) => setFVehicle(e.target.value)}>
                    <option value="">— select —</option>
                    {vehicles.map((v) => <option key={String(v.id)} value={String(v.id)}>{String(v.vehicleNo)}</option>)}
                  </select>
                </Field>
              </div>
              <div style={{ width: 150 }}><Field label="Date"><Input type="date" value={fDate} onChange={(e) => setFDate(e.target.value)} /></Field></div>
              <div style={{ width: 130 }}><Field label="Odometer" required><Input type="number" step="any" value={fOdo} onChange={(e) => setFOdo(e.target.value)} /></Field></div>
              <div style={{ width: 120 }}><Field label="Litres" required><Input type="number" step="any" value={fLitres} onChange={(e) => setFLitres(e.target.value)} /></Field></div>
              <div style={{ width: 120 }}><Field label="Rate ₹/L"><Input type="number" step="any" value={fRate} onChange={(e) => setFRate(e.target.value)} /></Field></div>
              <div style={{ minWidth: 150 }}><Field label="Station"><Input value={fStation} onChange={(e) => setFStation(e.target.value)} /></Field></div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingBottom: 8 }}>
                <input id="tankfull" type="checkbox" checked={fFull} onChange={(e) => setFFull(e.target.checked)} />
                <label htmlFor="tankfull" style={{ fontSize: 13 }}>Full tank</label>
              </div>
              <Button onClick={create} loading={busy}>Log fuel</Button>
            </div>
          </Card>
        </div>
      )}

      <div style={{ marginBottom: 18 }}>
        <Card title="Fuel entries" padded={false}
          actions={
            <select className="mn-input" value={filterVehicle} onChange={(e) => setFilterVehicle(e.target.value)}>
              <option value="">All vehicles</option>
              {vehicles.map((v) => <option key={String(v.id)} value={String(v.id)}>{String(v.vehicleNo)}</option>)}
            </select>
          }
        >
          {sm && (
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', padding: '12px 16px', borderBottom: '1px solid var(--mn-border)', fontSize: 13 }}>
              <span><strong>{dec(sm.totalLitres)}</strong> L total</span>
              <span><strong>{dec(sm.totalDistanceKm)}</strong> km measured</span>
              <span><strong>{sm.avgKmPerLitre != null ? dec(sm.avgKmPerLitre) : '—'}</strong> km/l avg</span>
              <span><strong>₹{sm.avgCostPerKm != null ? money(sm.avgCostPerKm) : '—'}</strong> /km</span>
              <span><strong>₹{money(sm.totalAmount)}</strong> spent</span>
            </div>
          )}
          {rows.length ? (
            <Table>
              <thead>
                <tr><Th>Date</Th><Th>Vehicle</Th><Th numeric>Odometer</Th><Th numeric>Litres</Th><Th numeric>Amount</Th><Th numeric>Distance</Th><Th numeric>km/l</Th></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={String(r.id)}>
                    <Td>{String(r.fuelDate ?? '—')}</Td>
                    <Td>{vehLabel(r.vehicleId)}</Td>
                    <Td numeric>{dec(r.odometer)}</Td>
                    <Td numeric>{dec(r.quantityLitres)}</Td>
                    <Td numeric>₹{money(r.amount)}</Td>
                    <Td numeric>{r.distanceKm != null ? `${dec(r.distanceKm)} km` : '—'}</Td>
                    <Td numeric>{r.kmPerLitre != null ? dec(r.kmPerLitre) : '—'}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <EmptyState title="No fuel entries yet" description={canRecord ? 'Log the first diesel fill above.' : 'Nothing to show.'} />
          )}
        </Card>
      </div>
    </div>
  );
}
