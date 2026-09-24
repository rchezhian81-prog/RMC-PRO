'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, CalendarRange, ClipboardList, Fuel, RefreshCw, Wrench } from 'lucide-react';
import { formatDate } from '../../../../lib/format-date';
import { money } from '../../../../lib/money';
import { currentMonthRange, financialYearRange, todayLocal } from '../../../../lib/report-range';
import { fleetReportsApi, type Row } from '../../../../lib/api';
import { Card } from '../../../../components/ui/Card';
import { StatCard } from '../../../../components/ui/StatCard';
import { Button } from '../../../../components/ui/Button';
import { Input } from '../../../../components/ui/Field';
import { ExportButton } from '../../../../components/ExportButton';
import { ErrorState, EmptyState, TableSkeleton } from '../../../../components/ui/States';

/**
 * Fleet running cost — what each vehicle costs to keep moving.
 *
 * A period bar (this month, last month, this financial year, all time, or any
 * two dates) sets the window. Five tiles carry the total, the maintenance
 * and fuel parts, cost per km and km per litre. Notes name the vehicle that
 * costs most per km and the vehicles whose mileage could not be measured.
 * Each vehicle is one row: the vehicle and its type; the cost split as a bar
 * (maintenance against fuel) with the amounts; the total; the km measured
 * and the cost per km; km per litre. A foot totals the fleet. Same layout in
 * both skins; every colour reads the semantic tokens.
 */

const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v)) || 0;
const km = (v: unknown) => `${num(v).toLocaleString('en-IN', { maximumFractionDigits: 0 })} km`;
const two = (v: unknown) => num(v).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const VEHICLE_TYPES: Record<string, string> = { transit_mixer: 'Transit mixer', concrete_pump: 'Concrete pump', tipper: 'Tipper', boom_pump: 'Boom pump', other: 'Other' };
const typeLabel = (v: unknown) => (v ? VEHICLE_TYPES[String(v)] ?? String(v) : '');

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

export default function FleetRunningCostPage() {
  const [data, setData] = useState<{ rows: Row[]; totals: Row } | null>(null);
  // Opens on the current month rather than every fuel log ever entered.
  const [range, setRange] = useState(currentMonthRange());
  const [draft, setDraft] = useState(currentMonthRange());
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (r: Range) => {
    setBusy(true);
    setError(null);
    try {
      setData(await fleetReportsApi.runningCost(r.from || undefined, r.to || undefined));
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

  const rows = [...(data?.rows ?? [])].sort((a, b) => num(b.totalCost) - num(a.totalCost));
  const t = data?.totals;
  const measured = rows.filter((r) => r.costPerKm != null && num(r.distanceKm) > 0);
  const dearest = measured.length > 1 ? [...measured].sort((a, b) => num(b.costPerKm) - num(a.costPerKm))[0] : null;
  const unmeasured = rows.filter((r) => num(r.fuelCost) > 0 && !(num(r.distanceKm) > 0));
  const maxCost = Math.max(0, ...rows.map((r) => num(r.totalCost)));

  return (
    <div className="mn-ord mn-fr">
      <header className="mn-board-head">
        <div className="mn-board-title">
          <h1>Fleet running cost</h1>
          <p>What each mixer and pump cost to keep moving in the period: the maintenance jobs completed plus the diesel filled, against the km the fuel log measured. Cost per km is the number to watch from month to month; a vehicle that climbs is telling you something.</p>
        </div>
        <div className="mn-board-tools">
          <span className="mn-board-live mn-ord-sum" aria-live="polite">
            <ClipboardList size={14} aria-hidden />
            {loaded ? periodLabel : 'Loading…'}
          </span>
          <Link href="/app/fleet/maintenance" className="mn-ord-link">
            <Button variant="ghost" size="sm" icon={<Wrench size={14} />}>Maintenance</Button>
          </Link>
          <Link href="/app/fleet/fuel" className="mn-ord-link">
            <Button variant="ghost" size="sm" icon={<Fuel size={14} />}>Fuel log</Button>
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

      {loaded && (dearest || unmeasured.length > 0) && (
        <div className="mn-ord-notes">
          {dearest && (
            <div className="mn-ord-note mn-ord-note--warn" role="status">
              <AlertTriangle size={16} aria-hidden />
              <span><strong>{String(dearest.vehicleNo)} costs the most per km</strong> at {money(dearest.costPerKm)} against {money(t?.costPerKm)} for the fleet. Look at its jobs and its km/l ({two(dearest.kmPerLitre)}) before the next month's diesel goes the same way.</span>
            </div>
          )}
          {unmeasured.length > 0 && (
            <div className="mn-ord-note" role="status">
              <Fuel size={16} aria-hidden />
              <span><strong>No mileage measured for {unmeasured.map((r) => String(r.vehicleNo)).join(', ')}.</strong> Diesel was filled but no full tank closed against an earlier one in the period, so there is no cost per km. Fill to the brim each time and it appears.</span>
            </div>
          )}
        </div>
      )}

      <div className="mn-od-kpis mn-qd-kpis">
        <StatCard label="Running cost" value={t ? money(t.totalCost) : '—'} tone="info" />
        <StatCard label="Maintenance" value={t ? money(t.maintenanceCost) : '—'} />
        <StatCard label="Diesel" value={t ? money(t.fuelCost) : '—'} />
        <StatCard label="Cost per km" value={t?.costPerKm != null ? money(t.costPerKm) : '—'} tone={t?.costPerKm != null ? 'warning' : 'neutral'} />
        <StatCard label="km per litre" value={t?.kmPerLitre != null && num(t.kmPerLitre) > 0 ? two(t.kmPerLitre) : '—'} tone={num(t?.kmPerLitre) > 0 ? 'success' : 'neutral'} />
      </div>

      <Card
        title={<span className="mn-board-card-title"><Wrench size={16} aria-hidden /> By vehicle <span className="mn-board-card-count">{rows.length}</span></span>}
        actions={<><span className="mn-ord-how">Dearest first · maintenance by completed date, diesel by fill date · {periodLabel}</span><ExportButton rows={rows} columns={['vehicleNo', 'vehicleType', 'maintenanceCost', 'fuelCost', 'totalCost', 'distanceKm', 'costPerKm', 'kmPerLitre']} filename="fleet-running-cost" /></>}
        padded={false}
      >
        {!loaded ? (
          <div className="mn-ord-skel"><TableSkeleton cols={6} /></div>
        ) : rows.length ? (
          <div className="mn-ord-list" role="list">
            <div className="mn-ord-cols mn-fr-cols" aria-hidden>
              <span>Vehicle</span>
              <span>Maintenance and diesel</span>
              <span className="is-num">Total</span>
              <span>Per km</span>
              <span className="is-num">km/l</span>
            </div>
            {rows.map((r) => {
              const total = num(r.totalCost);
              const mPct = total ? (num(r.maintenanceCost) / total) * 100 : 0;
              const width = maxCost ? Math.max(4, (total / maxCost) * 100) : 0;
              return (
                <div key={String(r.vehicleId ?? r.vehicleNo)} className="mn-ord-row mn-fr-row" data-tone={dearest && dearest.vehicleId === r.vehicleId ? 'warning' : 'neutral'} role="listitem">
                  <div className="mn-ord-id">
                    <span className="mn-ord-no">{String(r.vehicleNo)}</span>
                    <span className="mn-ord-meta">{typeLabel(r.vehicleType) || 'Vehicle'}{num(r.jobs) ? ` · ${num(r.jobs)} ${num(r.jobs) === 1 ? 'job' : 'jobs'}` : ''}{num(r.litres) ? ` · ${two(r.litres)} L` : ''}</span>
                  </div>
                  <div className="mn-fr-split">
                    <span className="mn-fr-split-bar" style={{ width: `${width}%` }} aria-hidden>
                      <span className="mn-fr-split-m" style={{ width: `${mPct}%` }} />
                      <span className="mn-fr-split-f" style={{ width: `${100 - mPct}%` }} />
                    </span>
                    <span className="mn-ord-meta"><span className="mn-fr-dot mn-fr-dot--m" aria-hidden /> {money(r.maintenanceCost)} · <span className="mn-fr-dot mn-fr-dot--f" aria-hidden /> {money(r.fuelCost)}</span>
                  </div>
                  <div className="mn-ord-val">
                    <span className="mn-ord-amt">{money(total)}</span>
                  </div>
                  <div className="mn-fr-perkm">
                    <span className={`mn-od-num${dearest && dearest.vehicleId === r.vehicleId ? ' mn-id-bad' : ''}`}>{r.costPerKm != null ? money(r.costPerKm) : '—'}</span>
                    <span className="mn-ord-meta">{num(r.distanceKm) > 0 ? `over ${km(r.distanceKm)}` : 'no km measured'}</span>
                  </div>
                  <div className="mn-ord-val">
                    <span className="mn-od-num">{num(r.kmPerLitre) > 0 ? two(r.kmPerLitre) : '—'}</span>
                  </div>
                </div>
              );
            })}
            {t && (
              <div className="mn-ord-row mn-fr-row mn-fr-foot" data-tone="neutral" aria-label="Fleet total">
                <div className="mn-ord-id"><span className="mn-ord-no">Fleet</span><span className="mn-ord-meta">{num(t.vehicles)} {num(t.vehicles) === 1 ? 'vehicle' : 'vehicles'}</span></div>
                <div className="mn-fr-split"><span className="mn-ord-meta">{money(t.maintenanceCost)} maintenance · {money(t.fuelCost)} diesel</span></div>
                <div className="mn-ord-val"><span className="mn-ord-amt">{money(t.totalCost)}</span></div>
                <div className="mn-fr-perkm"><span className="mn-od-num">{t.costPerKm != null ? money(t.costPerKm) : '—'}</span><span className="mn-ord-meta">{num(t.distanceKm) > 0 ? `over ${km(t.distanceKm)}` : 'no km measured'}</span></div>
                <div className="mn-ord-val"><span className="mn-od-num">{num(t.kmPerLitre) > 0 ? two(t.kmPerLitre) : '—'}</span></div>
              </div>
            )}
          </div>
        ) : (
          <EmptyState title="No fleet costs in this period" description={`No completed maintenance jobs or fuel fills dated between ${periodLabel === 'all time' ? 'the start and today' : periodLabel}. Log them under Maintenance and Fuel log.`} action={activePreset !== 'all' ? <Button variant="secondary" size="sm" onClick={() => apply({ from: '', to: '' })}>Show all time</Button> : undefined} />
        )}
      </Card>
    </div>
  );
}
