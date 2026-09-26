'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { CalendarRange, Clock, RefreshCw, Truck, UserRound, Wrench } from 'lucide-react';
import { formatDate } from '../../../../lib/format-date';
import { currentMonthRange, financialYearRange, settledFailure, settledReason, settledValue, todayLocal } from '../../../../lib/report-range';
import { dispatchApi, type Row } from '../../../../lib/api';
import { Card } from '../../../../components/ui/Card';
import { Table, Th, Td } from '../../../../components/ui/Table';
import { StatCard } from '../../../../components/ui/StatCard';
import { Button } from '../../../../components/ui/Button';
import { Input } from '../../../../components/ui/Field';
import { ExportButton } from '../../../../components/ExportButton';
import { ErrorState, EmptyState, TableSkeleton } from '../../../../components/ui/States';

/**
 * Fleet utilisation — how hard the trucks and drivers worked.
 *
 * A period bar sets the window, five tiles carry the trips, the m³
 * delivered, the trucks that moved out of the fleet, the average turnaround
 * and the average load, and a note names the trucks that stood idle. Then
 * each truck is one row (with trips, m³ and m³ per trip, turnaround, and
 * the load factor on a bar), each driver is one row, and the cycle times
 * per trip (travel, wait, pour, turnaround) with their averages. Every
 * card checks its own settled slot first. Same layout in both skins; every
 * colour reads the semantic tokens.
 */

const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v)) || 0;
const m3 = (v: unknown) => num(v).toLocaleString('en-IN', { maximumFractionDigits: 3 });
const one = (v: unknown) => num(v).toLocaleString('en-IN', { maximumFractionDigits: 1 });
const mins = (v: unknown) => (v == null || !Number.isFinite(Number(v)) ? '—' : num(v) >= 60 ? `${Math.floor(num(v) / 60)} h ${Math.round(num(v) % 60)} min` : `${Math.round(num(v))} min`);
const VEHICLE_TYPES: Record<string, string> = { transit_mixer: 'Transit mixer', concrete_pump: 'Concrete pump', tipper: 'Tipper', boom_pump: 'Boom pump', other: 'Other' };
const typeLabel = (v: unknown) => (v ? VEHICLE_TYPES[String(v)] ?? String(v) : 'Vehicle');

type Range = { from: string; to: string };
const ymd = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const PRESETS: Array<{ key: string; label: string; range: (now: Date) => Range }> = [
  { key: 'month', label: 'This month', range: (now) => currentMonthRange(now) },
  { key: 'last', label: 'Last month', range: (now) => ({ from: ymd(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: ymd(new Date(now.getFullYear(), now.getMonth(), 0)) }) },
  { key: 'fy', label: 'This financial year', range: (now) => ({ from: financialYearRange(now).from, to: todayLocal(now) }) },
  { key: 'all', label: 'All time', range: () => ({ from: '', to: '' }) },
];

export default function FleetUtilizationPage() {
  const [data, setData] = useState<{ rows: Row[]; totals: Row } | null>(null);
  // Per report: why it failed to load, or null. Keeps a refused fetch from
  // rendering as "No X" — a lie about data that exists and could not be read.
  const [failed, setFailed] = useState<(string | null)[]>([]);
  const [driver, setDriver] = useState<{ rows: Row[]; totals: Row } | null>(null);
  const [cycle, setCycle] = useState<{ rows: Row[]; averages: Row; count: number } | null>(null);
  // Opens on the current month rather than every trip ever run.
  const [range, setRange] = useState(currentMonthRange());
  const [draft, setDraft] = useState(currentMonthRange());
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (r: Range) => {
    setBusy(true);
    setError(null);
    try {
      // allSettled: vehicle utilisation, driver productivity and cycle times are
      // separate reports; one failing must not blank the others.
      const out = await Promise.allSettled([
        dispatchApi.fleetUtilization(r.from || undefined, r.to || undefined),
        dispatchApi.driverProductivity(r.from || undefined, r.to || undefined),
        dispatchApi.cycleTimes(r.from || undefined, r.to || undefined),
      ]);
      setData(settledValue(out[0]));
      setDriver(settledValue(out[1]));
      setCycle(settledValue(out[2]));
      setFailed(out.map(settledReason));
      const why = settledFailure(out);
      if (why) setError(why);
    } finally {
      setBusy(false);
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    load(currentMonthRange()).catch((e) => setError(String(e)));
  }, [load]);

  function apply(r: Range) {
    setRange(r);
    setDraft(r);
    load(r).catch((e) => setError(String(e)));
  }
  const now = new Date();
  const activePreset = PRESETS.find((p) => {
    const r = p.range(now);
    return r.from === range.from && r.to === range.to;
  })?.key ?? null;
  const periodLabel = range.from || range.to ? `${range.from ? formatDate(range.from) : 'the start'} → ${range.to ? formatDate(range.to) : 'today'}` : 'all time';

  const rows = [...(data?.rows ?? [])].sort((a, b) => num(b.trips) - num(a.trips) || num(b.totalM3) - num(a.totalM3));
  const t = data?.totals;
  const idle = rows.filter((r) => num(r.trips) === 0);
  const drivers = [...(driver?.rows ?? [])].sort((a, b) => num(b.trips) - num(a.trips));
  const avgLoad = rows.filter((r) => r.avgLoadPct != null && num(r.trips) > 0);
  const fleetLoad = avgLoad.length ? avgLoad.reduce((s, r) => s + num(r.avgLoadPct) * num(r.trips), 0) / Math.max(1, avgLoad.reduce((s, r) => s + num(r.trips), 0)) : null;

  return (
    <div className="mn-ord mn-fu">
      <header className="mn-board-head">
        <div className="mn-board-title">
          <h1>Fleet utilisation</h1>
          <p>How hard the trucks and the drivers worked in the period: trips completed, concrete delivered, how long a round trip took, and how full each load was against the drum. A truck that stood idle or ran half full is money parked in the yard.</p>
        </div>
        <div className="mn-board-tools">
          <span className="mn-board-live mn-ord-sum" aria-live="polite">
            <Truck size={14} aria-hidden />
            {loaded ? periodLabel : 'Loading…'}
          </span>
          <Link href="/app/fleet/reports" prefetch={false} className="mn-ord-link">
            <Button variant="ghost" size="sm" icon={<Wrench size={14} />}>Running cost</Button>
          </Link>
          <Button variant="ghost" size="sm" icon={<RefreshCw size={14} />} onClick={() => apply(range)} loading={busy}>
            Refresh
          </Button>
        </div>
      </header>

      <div className="mn-dr-period" role="group" aria-label="Period for the report">
        <div className="mn-board-strip">
          {PRESETS.map((p) => {
            const on = activePreset === p.key;
            return (
              <button key={p.key} type="button" className={`mn-board-chip mn-dr-chip${on ? ' is-on' : ''}`} aria-pressed={on} onClick={() => apply(p.range(new Date()))}>
                <span className="mn-board-chip-l">{p.label}</span>
              </button>
            );
          })}
        </div>
        <form
          className="mn-dr-range"
          onSubmit={(e) => {
            e.preventDefault();
            apply(draft);
          }}
        >
          <CalendarRange size={14} aria-hidden />
          <Input type="date" aria-label="From" value={draft.from} max={draft.to || undefined} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
          <span className="mn-ord-meta">to</span>
          <Input type="date" aria-label="To" value={draft.to} min={draft.from || undefined} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
          <Button type="submit" variant="secondary" size="sm" disabled={busy || (draft.from === range.from && draft.to === range.to)}>Apply</Button>
        </form>
      </div>

      {error && <ErrorState message={error} />}

      {loaded && idle.length > 0 && num(t?.trips) > 0 && (
        <div className="mn-ord-note mn-ord-note--warn" role="status">
          <Truck size={16} aria-hidden />
          <span><strong>{idle.length} {idle.length === 1 ? 'truck' : 'trucks'} did not move</strong> in the period: {idle.map((r) => String(r.vehicleNo)).join(', ')}. Under repair, no driver, or simply not needed; the running-cost report says what they still cost.</span>
        </div>
      )}

      <div className="mn-od-kpis mn-qd-kpis">
        <StatCard label="Trips" value={t ? num(t.trips) : '—'} tone="info" />
        <StatCard label="Delivered" value={t ? `${m3(t.totalM3)} m³` : '—'} tone="success" />
        <StatCard label="Trucks that moved" value={t ? `${num(t.activeVehicles)} of ${num(t.vehicles)}` : '—'} tone={t && num(t.activeVehicles) < num(t.vehicles) ? 'warning' : 'neutral'} />
        <StatCard label="Round trip" value={cycle?.averages?.turnaroundMin != null ? mins(cycle.averages.turnaroundMin) : '—'} />
        <StatCard label="Average load" value={fleetLoad != null ? `${one(fleetLoad)}%` : '—'} tone={fleetLoad != null && fleetLoad < 80 ? 'warning' : 'neutral'} />
      </div>

      <Card
        title={<span className="mn-board-card-title"><Truck size={16} aria-hidden /> By truck <span className="mn-board-card-count">{rows.length}</span></span>}
        actions={<><span className="mn-ord-how">Busiest first; idle trucks greyed. Load is m³ per trip against the drum.</span><ExportButton rows={rows} columns={['vehicleNo', 'vehicleType', 'capacityM3', 'trips', 'totalM3', 'avgTurnaroundMin', 'avgLoadPct']} filename="fleet-utilization" /></>}
        padded={false}
      >
        {!loaded ? (
          <div className="mn-ord-skel"><TableSkeleton cols={5} /></div>
        ) : rows.length ? (
          <div className="mn-ord-list" role="list">
            <div className="mn-ord-cols mn-fu-cols" aria-hidden>
              <span>Truck</span>
              <span className="is-num">Trips</span>
              <span>Delivered</span>
              <span>Round trip</span>
              <span>Load</span>
            </div>
            {rows.map((r) => {
              const trips = num(r.trips);
              const load = r.avgLoadPct == null ? null : num(r.avgLoadPct);
              return (
                <div key={String(r.vehicleNo)} className={`mn-ord-row mn-fu-row${trips ? '' : ' is-idle'}`} data-tone={trips ? (load != null && load < 80 ? 'warning' : 'success') : 'neutral'} role="listitem">
                  <div className="mn-ord-id">
                    <span className="mn-ord-no">{String(r.vehicleNo)}</span>
                    <span className="mn-ord-meta">{typeLabel(r.vehicleType)}{r.capacityM3 != null ? ` · ${one(r.capacityM3)} m³ drum` : ''}</span>
                  </div>
                  <div className="mn-ord-val"><span className="mn-ord-amt">{trips}</span></div>
                  <div className="mn-fu-m3">
                    <span>{m3(r.totalM3)} m³</span>
                    <span className="mn-ord-meta">{trips ? `${m3(num(r.totalM3) / trips)} m³ a trip` : 'stood idle'}</span>
                  </div>
                  <div className="mn-fu-m3">
                    <span>{trips && num(r.avgTurnaroundMin) ? mins(r.avgTurnaroundMin) : '—'}</span>
                    <span className="mn-ord-meta">{trips && num(r.avgTurnaroundMin) ? 'plant to plant' : ''}</span>
                  </div>
                  <div className="mn-fu-load">
                    <span className={load != null && load < 80 ? 'mn-id-bad' : ''}>{load == null ? '—' : `${one(load)}%`}</span>
                    {load != null && <span className="mn-od-linebar mn-fu-bar" aria-hidden><span style={{ width: `${Math.min(100, load)}%` }} /></span>}
                  </div>
                </div>
              );
            })}
            {t && (
              <div className="mn-ord-row mn-fu-row mn-fu-foot" data-tone="neutral" aria-label="Fleet total">
                <div className="mn-ord-id"><span className="mn-ord-no">Fleet</span><span className="mn-ord-meta">{num(t.activeVehicles)} of {num(t.vehicles)} moved</span></div>
                <div className="mn-ord-val"><span className="mn-ord-amt">{num(t.trips)}</span></div>
                <div className="mn-fu-m3"><span>{m3(t.totalM3)} m³</span></div>
                <div className="mn-fu-m3"><span>{cycle?.averages?.turnaroundMin != null ? mins(cycle.averages.turnaroundMin) : '—'}</span></div>
                <div className="mn-fu-load"><span>{fleetLoad != null ? `${one(fleetLoad)}%` : '—'}</span></div>
              </div>
            )}
          </div>
        ) : (
          failed[0] ? <ErrorState message={String(failed[0])} /> : (
            <EmptyState title="No trucks" description="Add the mixers and pumps under Vehicles; completed dispatches then show here as trips." />
          )
        )}
      </Card>

      <div className="mn-ir-two">
        <Card
          title={<span className="mn-board-card-title"><UserRound size={16} aria-hidden /> By driver <span className="mn-board-card-count">{drivers.length}</span></span>}
          actions={<ExportButton rows={drivers} columns={['driverName', 'driverCode', 'trips', 'totalM3', 'avgTurnaroundMin', 'm3PerTrip']} filename="driver-productivity" />}
          padded={false}
        >
          {!loaded ? (
            <TableSkeleton cols={4} />
          ) : drivers.length ? (
            <Table>
              <thead><tr><Th>Driver</Th><Th numeric>Trips</Th><Th numeric>m³</Th><Th numeric>Round trip</Th></tr></thead>
              <tbody>
                {drivers.map((r, i) => (
                  <tr key={i} className={num(r.trips) ? '' : 'mn-fu-idle'}>
                    <Td><span className="mn-od-num">{String(r.driverName ?? '—')}</span><span className="mn-ord-meta"> {r.driverCode ? String(r.driverCode) : ''}</span></Td>
                    <Td numeric>{num(r.trips)}</Td>
                    <Td numeric>{m3(r.totalM3)}{num(r.trips) ? <span className="mn-ord-meta"> · {m3(r.m3PerTrip)} a trip</span> : null}</Td>
                    <Td numeric>{num(r.trips) && num(r.avgTurnaroundMin) ? mins(r.avgTurnaroundMin) : '—'}</Td>
                  </tr>
                ))}
              </tbody>
              {driver?.totals && (
                <tfoot><tr className="mn-ir-total"><Td>All drivers</Td><Td numeric><span className="mn-ir-total-value">{num(driver.totals.trips)}</span></Td><Td numeric>{m3(driver.totals.totalM3)}</Td><Td /></tr></tfoot>
              )}
            </Table>
          ) : (
            failed[1] ? <ErrorState message={String(failed[1])} /> : (
              <EmptyState title="No drivers" description="Add drivers under Masters; completed dispatches then show here as trips." />
            )
          )}
        </Card>
        <Card
          title={<span className="mn-board-card-title"><Clock size={16} aria-hidden /> Cycle times <span className="mn-board-card-count">{cycle?.count ?? 0}</span></span>}
          actions={<span className="mn-ord-how">Per completed trip: plant to site, waiting at site, pouring, and the whole round.</span>}
          padded={false}
        >
          {!loaded ? (
            <TableSkeleton cols={5} />
          ) : cycle?.rows?.length ? (
            <div className="mn-id-scroll">
              <Table>
                <thead><tr><Th>Trip</Th><Th numeric>Travel</Th><Th numeric>Waited</Th><Th numeric>Pour</Th><Th numeric>Round trip</Th></tr></thead>
                <tbody>
                  {cycle.rows.map((r, i) => (
                    <tr key={i}>
                      <Td><span className="mn-od-num">{String(r.dispatchNo)}</span>{r.gradeLabel ? <span className="mn-ord-meta"> {String(r.gradeLabel)}</span> : null}</Td>
                      <Td numeric>{mins(r.travelMin)}</Td>
                      <Td numeric><span className={num(r.waitMin) > 30 ? 'mn-id-bad' : ''}>{mins(r.waitMin)}</span></Td>
                      <Td numeric>{mins(r.pourMin)}</Td>
                      <Td numeric>{mins(r.turnaroundMin)}</Td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="mn-ir-total"><Td>Average</Td><Td numeric>{mins(cycle.averages?.travelMin)}</Td><Td numeric>{mins(cycle.averages?.waitMin)}</Td><Td numeric>{mins(cycle.averages?.pourMin)}</Td><Td numeric><span className="mn-ir-total-value">{mins(cycle.averages?.turnaroundMin)}</span></Td></tr>
                </tfoot>
              </Table>
            </div>
          ) : (
            failed[2] ? <ErrorState message={String(failed[2])} /> : (
              <EmptyState title="No completed trips" description="A trip shows once the dispatch is marked left plant, reached site, poured and returned." />
            )
          )}
        </Card>
      </div>
    </div>
  );
}
