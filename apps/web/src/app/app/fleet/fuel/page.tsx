'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { CheckCircle2, ClipboardList, Fuel, Plus, RefreshCw, Wrench, X } from 'lucide-react';
import { formatDate } from '../../../../lib/format-date';
import { money } from '../../../../lib/money';
import { todayLocal } from '../../../../lib/report-range';
import { useListWindow } from '../../../../lib/list-window';
import { ListCap } from '../../../../components/ListCap';
import { crud, fleetApi, type Row } from '../../../../lib/api';
import { getAccess } from '../../../../lib/session';
import { Card } from '../../../../components/ui/Card';
import { Badge } from '../../../../components/ui/Badge';
import { Button } from '../../../../components/ui/Button';
import { Form } from '../../../../components/ui/Form';
import { Field, Input, Select } from '../../../../components/ui/Field';
import { ErrorState, EmptyState, TableSkeleton } from '../../../../components/ui/States';

/**
 * Fuel log — every diesel fill, and the mileage it proves.
 *
 * A vehicle strip with live counts doubles as the filter, a summary strip
 * totals the fills on screen (litres, spend, measured km, km per litre, cost
 * per km), and each fill is one row: the date and the pump; the vehicle and
 * the reading; litres at the rate; the amount; the mileage the fill closed
 * (distance and km/l on a bar against the best in the list) or why it did
 * not; and whether the tank was filled. The log form opens on demand with the
 * last reading, rate and pump prefilled. Same layout in both skins; every
 * colour reads the semantic tokens.
 */

const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v)) || 0;
const km = (v: unknown) => `${num(v).toLocaleString('en-IN', { maximumFractionDigits: 0 })} km`;
const litres = (v: unknown) => `${num(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })} L`;
const two = (v: unknown) => num(v).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const VEHICLE_TYPES: Record<string, string> = { transit_mixer: 'Transit mixer', concrete_pump: 'Concrete pump', tipper: 'Tipper', boom_pump: 'Boom pump', other: 'Other' };
const typeLabel = (v: unknown) => (v ? VEHICLE_TYPES[String(v)] ?? String(v) : '');

export default function FleetFuelPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [vehicles, setVehicles] = useState<Row[]>([]);
  const [filter, setFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const win = useListWindow();

  const [fVehicle, setFVehicle] = useState('');
  const [fDate, setFDate] = useState(todayLocal());
  const [fOdo, setFOdo] = useState('');
  const [fLitres, setFLitres] = useState('');
  const [fRate, setFRate] = useState('');
  const [fFull, setFFull] = useState(true);
  const [fStation, setFStation] = useState('');

  const canRecord = getAccess().has('fleet.fuel.record');
  const vehLabel = (id: unknown) => String(vehicles.find((v) => String(v.id) === String(id))?.vehicleNo ?? '—');

  const reload = useCallback(async () => {
    const [lg, vh] = await Promise.all([fleetApi.fuelLogs(undefined, win.limit), crud('vehicles').list()]);
    setRows(lg);
    setVehicles(vh.filter((v) => String(v.status ?? 'active') !== 'inactive'));
  }, [win.limit]);

  useEffect(() => {
    setLoaded(false);
    reload()
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoaded(true));
  }, [reload]);

  async function refresh() {
    setRefreshing(true);
    try {
      await reload();
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setRefreshing(false);
    }
  }

  // The last fill on the vehicle: its reading is the floor for the next one,
  // and its rate and pump are the likely defaults.
  const lastFill = (vehicleId: string) => rows.filter((r) => String(r.vehicleId) === vehicleId).sort((a, b) => num(b.odometer) - num(a.odometer))[0] ?? null;
  function pickVehicle(id: string) {
    setFVehicle(id);
    const last = lastFill(id);
    if (last) {
      if (!fRate) setFRate(String(num(last.ratePerLitre) || ''));
      if (!fStation && last.station) setFStation(String(last.station));
    }
  }
  const last = fVehicle ? lastFill(fVehicle) : null;
  const amount = num(fLitres) * num(fRate);

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setMsg(null);
    if (!fVehicle) { setError('Pick the vehicle that was filled.'); return; }
    if (!(num(fOdo) > 0)) { setError('Enter the odometer reading at the pump.'); return; }
    if (last && num(fOdo) < num(last.odometer)) { setError(`The reading (${km(fOdo)}) is below the last fill on this vehicle (${km(last.odometer)}). Check the odometer.`); return; }
    if (!(num(fLitres) > 0)) { setError('Enter the litres filled.'); return; }
    setBusy(true);
    try {
      const f = await fleetApi.createFuelLog({
        vehicleId: fVehicle, fuelDate: fDate || undefined, odometer: num(fOdo),
        quantityLitres: num(fLitres), ratePerLitre: fRate ? num(fRate) : undefined,
        isTankFull: fFull, station: fStation || undefined,
      });
      setMsg(`${litres(f.quantityLitres)} logged on ${vehLabel(f.vehicleId)}${f.kmPerLitre != null ? `: ${two(f.kmPerLitre)} km/l over the last ${km(f.distanceKm)}.` : fFull ? '. Mileage shows from the next full tank.' : '. A part fill; mileage is measured full tank to full tank.'}`);
      setFOdo('');
      setFLitres('');
      setShowForm(false);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  const counts = useMemo(() => {
    const c = new Map<string, number>();
    for (const r of rows) c.set(String(r.vehicleId), (c.get(String(r.vehicleId)) ?? 0) + 1);
    return c;
  }, [rows]);
  const shown = filter ? rows.filter((r) => String(r.vehicleId) === filter) : rows;
  const sum = useMemo(() => {
    let l = 0, amt = 0, dist = 0, lOver = 0, amtOver = 0;
    for (const r of shown) {
      l += num(r.quantityLitres);
      amt += num(r.amount);
      if (num(r.distanceKm) > 0) { dist += num(r.distanceKm); lOver += num(r.quantityLitres); amtOver += num(r.amount); }
    }
    return { litres: l, amount: amt, distance: dist, kmPerL: lOver > 0 ? dist / lOver : null, costPerKm: dist > 0 ? amtOver / dist : null };
  }, [shown]);
  const bestKmPerL = Math.max(0, ...shown.map((r) => num(r.kmPerLitre)));
  const vehiclesWithFills = vehicles.filter((v) => counts.has(String(v.id)));

  return (
    <div className="mn-ord mn-ff">
      <header className="mn-board-head">
        <div className="mn-board-title">
          <h1>Fuel log</h1>
          <p>Every diesel fill, by vehicle. Fill the tank each time and the log works out the mileage from one full tank to the next: km per litre and cost per km, which is where a tired engine or a leaking tank shows first. A part fill is kept for the spend but does not measure mileage.</p>
        </div>
        <div className="mn-board-tools">
          <span className="mn-board-live mn-ord-sum" aria-live="polite">
            <Fuel size={14} aria-hidden />
            {loaded ? `${shown.length} ${shown.length === 1 ? 'fill' : 'fills'} · ${litres(sum.litres)} · ${money(sum.amount)}` : 'Loading…'}
          </span>
          {canRecord && !showForm && <Button icon={<Plus size={14} />} onClick={() => { setShowForm(true); setMsg(null); if (filter) pickVehicle(filter); }}>Log a fill</Button>}
          <Link href="/app/fleet/maintenance" className="mn-ord-link">
            <Button variant="ghost" size="sm" icon={<Wrench size={14} />}>Maintenance</Button>
          </Link>
          <Link href="/app/fleet/reports" className="mn-ord-link">
            <Button variant="ghost" size="sm" icon={<ClipboardList size={14} />}>Running cost</Button>
          </Link>
          <Button variant="ghost" size="sm" icon={<RefreshCw size={14} />} onClick={refresh} loading={refreshing}>
            Refresh
          </Button>
        </div>
      </header>

      {/* Vehicle strip — fills per vehicle; press one to filter, press again for all. */}
      {vehiclesWithFills.length > 0 && (
        <div className="mn-board-strip" role="group" aria-label="Filter by vehicle">
          {vehiclesWithFills.map((v) => {
            const id = String(v.id);
            const c = counts.get(id) ?? 0;
            const on = filter === id;
            return (
              <button key={id} type="button" className={`mn-board-chip${on ? ' is-on' : ''}`} data-tone="info" aria-pressed={on} title={typeLabel(v.vehicleType) || 'Vehicle'} onClick={() => setFilter(on ? '' : id)}>
                <span className="mn-board-chip-n">{c}</span>
                <span className="mn-board-chip-l">{String(v.vehicleNo)}</span>
              </button>
            );
          })}
          {filter && <button type="button" className="mn-board-chip mn-board-chip-clear" onClick={() => setFilter('')}>All vehicles</button>}
        </div>
      )}

      {error && <ErrorState message={error} />}
      {msg && <div className="mn-ord-note mn-ord-note--ok" role="status"><CheckCircle2 size={16} aria-hidden /><span>{msg}</span></div>}

      {showForm && canRecord && (
        <Card
          title={<span className="mn-board-card-title"><Fuel size={16} aria-hidden /> Log a fill</span>}
          actions={<Button variant="ghost" size="sm" icon={<X size={14} />} onClick={() => setShowForm(false)}>Close</Button>}
        >
          <Form onSubmit={create} className="mn-ff-form">
            <Field label="Vehicle" required>
              <Select value={fVehicle} onChange={(e) => pickVehicle(e.target.value)} required>
                <option value="">Choose…</option>
                {vehicles.map((v) => <option key={String(v.id)} value={String(v.id)}>{String(v.vehicleNo)}{v.vehicleType ? ` · ${typeLabel(v.vehicleType)}` : ''}</option>)}
              </Select>
            </Field>
            <Field label="Date">
              <Input type="date" value={fDate} max={todayLocal()} onChange={(e) => setFDate(e.target.value)} />
            </Field>
            <Field label="Odometer (km)" required help={last ? `Last fill was at ${km(last.odometer)}.` : fVehicle ? 'First fill on this vehicle; the next full tank measures the mileage.' : 'The reading on the dash at the pump.'}>
              <Input type="number" step="any" inputMode="decimal" min={0} value={fOdo} onChange={(e) => setFOdo(e.target.value)} required />
            </Field>
            <Field label="Litres" required>
              <Input type="number" step="any" inputMode="decimal" min={0} value={fLitres} onChange={(e) => setFLitres(e.target.value)} required />
            </Field>
            <Field label="Rate (₹ per litre)">
              <Input type="number" step="any" inputMode="decimal" min={0} value={fRate} onChange={(e) => setFRate(e.target.value)} />
            </Field>
            <Field label="Pump or station">
              <Input value={fStation} placeholder="e.g. IOC, plant gate" onChange={(e) => setFStation(e.target.value)} />
            </Field>
            <label className="mn-ma-check mn-ff-check">
              <input type="checkbox" checked={fFull} onChange={(e) => setFFull(e.target.checked)} />
              <span>Tank filled to the brim <span className="mn-ord-meta">(untick for a part fill; mileage is measured full tank to full tank)</span></span>
            </label>
            <div className="mn-ff-form-submit">
              <Button type="submit" loading={busy} icon={<Fuel size={14} />}>Save the fill</Button>
              <Button type="button" variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
              <span className="mn-ord-how">{amount > 0 ? `${litres(fLitres)} at ₹${two(fRate)} is ${money(amount)}.` : 'The amount works out from litres and rate.'}</span>
            </div>
          </Form>
        </Card>
      )}

      <Card
        title={<span className="mn-board-card-title"><Fuel size={16} aria-hidden /> Fills <span className="mn-board-card-count">{shown.length}</span></span>}
        actions={<span className="mn-ord-how">Highest reading first. The bar is the fill's km/l against the best on screen.</span>}
        padded={false}
      >
        {loaded && shown.length > 0 && (
          <div className="mn-qr-sum">
            <span><strong>{litres(sum.litres)}</strong> filled</span>
            <span><strong>{money(sum.amount)}</strong> spent</span>
            <span><strong>{km(sum.distance)}</strong> measured</span>
            <span><strong>{sum.kmPerL != null ? two(sum.kmPerL) : '—'}</strong> km/l</span>
            <span><strong>{sum.costPerKm != null ? money(sum.costPerKm) : '—'}</strong> per km</span>
          </div>
        )}
        {!loaded ? (
          <div className="mn-ord-skel"><TableSkeleton cols={6} /></div>
        ) : shown.length ? (
          <div className="mn-ord-list" role="list">
            <div className="mn-ord-cols mn-ff-cols" aria-hidden>
              <span>Fill</span>
              <span>Vehicle</span>
              <span>Diesel</span>
              <span className="is-num">Amount</span>
              <span>Mileage</span>
              <span>Tank</span>
            </div>
            {shown.map((r) => {
              const full = Boolean(r.isTankFull);
              const kpl = num(r.kmPerLitre);
              return (
                <div key={String(r.id)} className="mn-ord-row mn-ff-row" data-tone={full ? (kpl > 0 ? 'success' : 'info') : 'neutral'} role="listitem">
                  <div className="mn-ord-id">
                    <span className="mn-ord-no">{formatDate(r.fuelDate)}</span>
                    <span className="mn-ord-meta">{r.station ? String(r.station) : 'Pump not noted'}</span>
                  </div>
                  <div className="mn-ord-who">
                    <span className="mn-ord-cust">{String(r.vehicleNo ?? vehLabel(r.vehicleId))}</span>
                    <span className="mn-ord-meta">{typeLabel(r.vehicleType) || 'Vehicle'} · at {km(r.odometer)}</span>
                  </div>
                  <div className="mn-ff-diesel">
                    <span>{litres(r.quantityLitres)}</span>
                    <span className="mn-ord-meta">{num(r.ratePerLitre) ? `at ₹${two(r.ratePerLitre)}/L` : 'rate not noted'}</span>
                  </div>
                  <div className="mn-ord-val">
                    <span className="mn-ord-amt">{money(r.amount)}</span>
                  </div>
                  <div className="mn-ff-mileage">
                    {kpl > 0 ? (
                      <>
                        <span className="mn-od-num">{two(kpl)} km/l <span className="mn-ord-meta">over {km(r.distanceKm)}</span></span>
                        <span className="mn-od-linebar mn-ff-bar" aria-hidden><span style={{ width: `${bestKmPerL ? Math.max(4, (kpl / bestKmPerL) * 100) : 0}%` }} /></span>
                      </>
                    ) : (
                      <span className="mn-ord-meta">{full ? 'first full tank; measures from the next' : 'part fill; not measured'}</span>
                    )}
                  </div>
                  <div className="mn-ord-status">{full ? <Badge tone="success">full tank</Badge> : <Badge tone="neutral">part fill</Badge>}</div>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState
            title={filter ? `No fills on ${vehLabel(filter)}` : 'No fuel entries yet'}
            description={filter ? 'Press the chip again to see every vehicle.' : canRecord ? 'Press Log a fill after the next visit to the pump: the vehicle, the reading, the litres and the rate.' : 'Nothing to show.'}
            action={filter ? <Button variant="secondary" size="sm" onClick={() => setFilter('')}>All vehicles</Button> : canRecord ? <Button size="sm" icon={<Plus size={14} />} onClick={() => setShowForm(true)}>Log a fill</Button> : undefined}
          />
        )}
        <ListCap shown={rows.length} limit={win.limit} canWiden={win.canWiden} onWiden={() => win.setLimit(win.widen())} noun="fuel entries" hint="the running-cost report (Fleet → Running cost)" />
      </Card>
    </div>
  );
}
