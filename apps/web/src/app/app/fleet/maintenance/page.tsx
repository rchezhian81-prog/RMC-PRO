'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { AlertTriangle, CalendarClock, CheckCircle2, ClipboardList, FileWarning, Fuel, Plus, RefreshCw, Truck, Wrench, X, XCircle } from 'lucide-react';
import { formatDate } from '../../../../lib/format-date';
import { money } from '../../../../lib/money';
import { useListWindow } from '../../../../lib/list-window';
import { ListCap } from '../../../../components/ListCap';
import { crud, fleetApi, type Row } from '../../../../lib/api';
import { getAccess } from '../../../../lib/session';
import { Card } from '../../../../components/ui/Card';
import { Badge, StatusBadge } from '../../../../components/ui/Badge';
import { Button } from '../../../../components/ui/Button';
import { Form } from '../../../../components/ui/Form';
import { Field, Input, Select } from '../../../../components/ui/Field';
import { ErrorState, EmptyState, TableSkeleton } from '../../../../components/ui/States';
import { useConfirm } from '../../../../components/ui/ConfirmDialog';

/**
 * Fleet maintenance — the services that keep the mixers and pumps on the road.
 *
 * Notes name the services overdue or due soon and the vehicles whose papers
 * are running out. A schedules card lists each preventive service with how
 * often it is due, when it is next due against the vehicle's current reading,
 * its state, and a button that opens the job form on it. A stage strip
 * (open / completed / cancelled) filters the jobs, and each job is one row:
 * number with the reported date and kind; the vehicle and the garage; what
 * was done and the schedule it fulfils; the cost split with downtime; the
 * stage; Complete / Cancel. Both forms open on demand. Same layout in both
 * skins; every colour reads the semantic tokens.
 */

const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v)) || 0;
const km = (v: unknown) => `${num(v).toLocaleString('en-IN', { maximumFractionDigits: 0 })} km`;
const daysUntil = (d: unknown) => (d ? Math.round((new Date(`${String(d).slice(0, 10)}T00:00:00`).getTime() - new Date(new Date().toDateString()).getTime()) / 86_400_000) : null);
const VEHICLE_TYPES: Record<string, string> = { transit_mixer: 'Transit mixer', concrete_pump: 'Concrete pump', tipper: 'Tipper', boom_pump: 'Boom pump', other: 'Other' };
const typeLabel = (v: unknown) => (v ? VEHICLE_TYPES[String(v)] ?? String(v) : '');

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';
const STAGES: Array<{ key: string; label: string; tone: Tone; hint: string }> = [
  { key: 'open', label: 'Open', tone: 'warning', hint: 'Reported; the vehicle is off the road or waiting on the garage' },
  { key: 'completed', label: 'Completed', tone: 'success', hint: 'Done; the cost is in the running-cost report' },
  { key: 'cancelled', label: 'Cancelled', tone: 'danger', hint: 'Logged by mistake or never done' },
];
const toneOf = (s: string): Tone => STAGES.find((x) => x.key === s)?.tone ?? 'neutral';
const labelOf = (s: string) => STAGES.find((x) => x.key === s)?.label.toLowerCase() ?? s;
const JOB_TYPES = [
  { value: 'service', label: 'Service', hint: 'Planned; usually fulfils a schedule' },
  { value: 'repair', label: 'Repair', hint: 'Something worn or broken, fixed in the workshop' },
  { value: 'breakdown', label: 'Breakdown', hint: 'Stopped on the road or at site; count the hours lost' },
];
const jobTypeLabel = (v: unknown) => JOB_TYPES.find((t) => t.value === String(v))?.label ?? String(v ?? '');
const nice = (r: string) => r.replace(/(\d+) day\(s\)/g, (_m, n: string) => `${n} ${n === '1' ? 'day' : 'days'}`);
const dueTone = (s: string): Tone => (s === 'overdue' ? 'danger' : s === 'due_soon' ? 'warning' : 'success');
const PAPERS: Array<{ key: string; label: string }> = [
  { key: 'insuranceExpiry', label: 'insurance' },
  { key: 'fitnessExpiry', label: 'fitness (FC)' },
  { key: 'permitExpiry', label: 'permit' },
  { key: 'pollutionExpiry', label: 'PUC' },
  { key: 'roadTaxExpiry', label: 'road tax' },
];

export default function FleetMaintenancePage() {
  const { confirm } = useConfirm();
  const [schedules, setSchedules] = useState<Row[]>([]);
  const [jobs, setJobs] = useState<Row[]>([]);
  const [vehicles, setVehicles] = useState<Row[]>([]);
  const [filter, setFilter] = useState('');
  const [showJob, setShowJob] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const win = useListWindow();

  const [sVehicle, setSVehicle] = useState('');
  const [sType, setSType] = useState('');
  const [sIntervalKm, setSIntervalKm] = useState('');
  const [sIntervalDays, setSIntervalDays] = useState('');
  const [sLastOdo, setSLastOdo] = useState('');
  const [sLastDate, setSLastDate] = useState('');

  const [jVehicle, setJVehicle] = useState('');
  const [jType, setJType] = useState('service');
  const [jSchedule, setJSchedule] = useState('');
  const [jOdo, setJOdo] = useState('');
  const [jVendor, setJVendor] = useState('');
  const [jLabour, setJLabour] = useState('');
  const [jParts, setJParts] = useState('');
  const [jDowntime, setJDowntime] = useState('');
  const [jDesc, setJDesc] = useState('');

  const canRecord = getAccess().has('fleet.maintenance.record');
  const vehLabel = (id: unknown) => String(vehicles.find((v) => String(v.id) === String(id))?.vehicleNo ?? '—');

  const reload = useCallback(async () => {
    const [sc, jb, vh] = await Promise.all([fleetApi.schedules(), fleetApi.jobs(undefined, undefined, win.limit), crud('vehicles').list()]);
    setSchedules(sc);
    setJobs(jb);
    // The vehicle master flags retired trucks by status; the pick-lists skip them.
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

  async function run(fn: () => Promise<unknown>, okMsg: string) {
    setError(null);
    setMsg(null);
    setBusy(true);
    try {
      await fn();
      await reload();
      setMsg(okMsg);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function createSchedule(e: FormEvent) {
    e.preventDefault();
    if (!sVehicle) { setError('Pick the vehicle the schedule is for.'); return; }
    if (!sType.trim()) { setError('Name the service (Engine oil, Hydraulic oil, Drum blades…).'); return; }
    if (!sIntervalKm && !sIntervalDays) { setError('Say how often: every so many km, so many days, or both.'); return; }
    const ok = await run(() => fleetApi.createSchedule({
      vehicleId: sVehicle, serviceType: sType.trim(),
      intervalKm: sIntervalKm ? Number(sIntervalKm) : undefined, intervalDays: sIntervalDays ? Number(sIntervalDays) : undefined,
      lastServiceOdometer: sLastOdo ? Number(sLastOdo) : undefined, lastServiceDate: sLastDate || undefined,
    }), `${sType.trim()} on ${vehLabel(sVehicle)} is now on the schedule.`);
    if (ok) {
      setSType(''); setSIntervalKm(''); setSIntervalDays(''); setSLastOdo(''); setSLastDate('');
      setShowSchedule(false);
    }
  }

  async function createJob(e: FormEvent) {
    e.preventDefault();
    if (!jVehicle) { setError('Pick the vehicle the job is for.'); return; }
    const ok = await run(async () => {
      const j = await fleetApi.createJob({
        vehicleId: jVehicle, jobType: jType, scheduleId: jSchedule || undefined,
        odometer: jOdo ? Number(jOdo) : undefined, vendorName: jVendor || undefined,
        labourCost: jLabour ? Number(jLabour) : undefined, partsCost: jParts ? Number(jParts) : undefined,
        downtimeHours: jDowntime ? Number(jDowntime) : undefined, description: jDesc || undefined,
      });
      return j;
    }, `${jobTypeLabel(jType)} job logged for ${vehLabel(jVehicle)}. Mark it complete when the vehicle is back.`);
    if (ok) {
      setJOdo(''); setJVendor(''); setJLabour(''); setJParts(''); setJDowntime(''); setJDesc(''); setJSchedule('');
      setShowJob(false);
    }
  }

  /** Opens the job form on a schedule: the vehicle, the service and the reading are filled. */
  function logService(s: Row) {
    setJVehicle(String(s.vehicleId));
    setJType('service');
    setJSchedule(String(s.id));
    setJOdo(s.currentOdometer != null ? String(s.currentOdometer) : '');
    setJDesc(String(s.serviceType));
    setShowJob(true);
    setMsg(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function completeJob(j: Row) {
    const linked = j.scheduleServiceType ? ` The ${String(j.scheduleServiceType)} schedule rolls forward from this reading.` : '';
    if (!(await confirm({ title: `Complete ${String(j.jobNo)}`, message: `${vehLabel(j.vehicleId)} is back on the road and the cost (${money(j.totalCost)}) goes into the running-cost report.${linked}`, confirmLabel: 'Mark complete' }))) return;
    await run(() => fleetApi.completeJob(String(j.id), {}), `${String(j.jobNo)} completed.`);
  }

  const schedulesForVehicle = jVehicle ? schedules.filter((s) => String(s.vehicleId) === jVehicle && s.isActive) : [];
  const lastOdo = (vehicleId: string) => {
    const s = schedules.filter((x) => String(x.vehicleId) === vehicleId).map((x) => num(x.currentOdometer));
    const j = jobs.filter((x) => String(x.vehicleId) === vehicleId).map((x) => num(x.odometer));
    const all = [...s, ...j].filter((x) => x > 0);
    return all.length ? Math.max(...all) : null;
  };
  const jobTotal = num(jLabour) + num(jParts);

  const counts = useMemo(() => {
    const c = new Map<string, number>();
    for (const j of jobs) c.set(String(j.status), (c.get(String(j.status)) ?? 0) + 1);
    return c;
  }, [jobs]);
  const shown = filter ? jobs.filter((j) => String(j.status) === filter) : jobs;
  const openJobs = counts.get('open') ?? 0;
  const dueOf = (s: Row) => ((s.dueState ?? {}) as { status?: string; reasons?: string[]; kmRemaining?: number | null; daysRemaining?: number | null });
  const overdue = schedules.filter((s) => s.isActive && dueOf(s).status === 'overdue');
  const dueSoon = schedules.filter((s) => s.isActive && dueOf(s).status === 'due_soon');
  const papers = vehicles.flatMap((v) => PAPERS.map((p) => ({ v, p, days: daysUntil(v[p.key]) })).filter((x) => x.days !== null && x.days <= 30));
  const sortedSchedules = useMemo(() => {
    const order: Record<string, number> = { overdue: 0, due_soon: 1, ok: 2 };
    return [...schedules].sort((a, b) => (a.isActive === b.isActive ? 0 : a.isActive ? -1 : 1) || (order[dueOf(a).status ?? 'ok'] ?? 9) - (order[dueOf(b).status ?? 'ok'] ?? 9) || String(a.vehicleNo ?? '').localeCompare(String(b.vehicleNo ?? '')));
  }, [schedules]);

  return (
    <div className="mn-ord mn-fm">
      <header className="mn-board-head">
        <div className="mn-board-title">
          <h1>Fleet maintenance</h1>
          <p>The services that keep the mixers and pumps on the road. A schedule says how often each service is due, by km or by days; a job is what was actually done and what it cost. Completing a service job rolls its schedule forward from that reading.</p>
        </div>
        <div className="mn-board-tools">
          <span className="mn-board-live mn-ord-sum" aria-live="polite">
            <Wrench size={14} aria-hidden />
            {loaded ? `${openJobs} open ${openJobs === 1 ? 'job' : 'jobs'} · ${overdue.length} overdue ${overdue.length === 1 ? 'service' : 'services'}` : 'Loading…'}
          </span>
          {canRecord && !showJob && <Button icon={<Plus size={14} />} onClick={() => { setShowJob(true); setMsg(null); }}>Log a job</Button>}
          {canRecord && !showSchedule && <Button variant="secondary" icon={<CalendarClock size={14} />} onClick={() => { setShowSchedule(true); setMsg(null); }}>Add a schedule</Button>}
          <Link href="/app/fleet/fuel" className="mn-ord-link">
            <Button variant="ghost" size="sm" icon={<Fuel size={14} />}>Fuel log</Button>
          </Link>
          <Link href="/app/fleet/reports" className="mn-ord-link">
            <Button variant="ghost" size="sm" icon={<ClipboardList size={14} />}>Running cost</Button>
          </Link>
          <Button variant="ghost" size="sm" icon={<RefreshCw size={14} />} onClick={refresh} loading={refreshing}>
            Refresh
          </Button>
        </div>
      </header>

      {loaded && (overdue.length > 0 || dueSoon.length > 0 || papers.length > 0) && (
        <div className="mn-ord-notes">
          {overdue.length > 0 && (
            <div className="mn-ord-note mn-ord-note--bad" role="status">
              <AlertTriangle size={16} aria-hidden />
              <span><strong>{overdue.length} {overdue.length === 1 ? 'service is' : 'services are'} overdue:</strong> {overdue.slice(0, 4).map((s) => `${String(s.vehicleNo ?? vehLabel(s.vehicleId))} ${String(s.serviceType)} (${(dueOf(s).reasons ?? []).map(nice).join(', ')})`).join('; ')}{overdue.length > 4 ? ' and more' : ''}. Book the garage and log the job from the schedule below.</span>
            </div>
          )}
          {dueSoon.length > 0 && (
            <div className="mn-ord-note mn-ord-note--warn" role="status">
              <CalendarClock size={16} aria-hidden />
              <span><strong>{dueSoon.length} {dueSoon.length === 1 ? 'service is' : 'services are'} due soon:</strong> {dueSoon.slice(0, 4).map((s) => `${String(s.vehicleNo ?? vehLabel(s.vehicleId))} ${String(s.serviceType)} (${(dueOf(s).reasons ?? []).map(nice).join(', ')})`).join('; ')}{dueSoon.length > 4 ? ' and more' : ''}.</span>
            </div>
          )}
          {papers.length > 0 && (
            <div className="mn-ord-note mn-ord-note--warn" role="status">
              <FileWarning size={16} aria-hidden />
              <span><strong>Papers running out:</strong> {papers.slice(0, 5).map((x) => `${String(x.v.vehicleNo)} ${x.p.label} ${x.days! < 0 ? `expired ${-x.days!} ${x.days === -1 ? 'day' : 'days'} ago` : x.days === 0 ? 'expires today' : `in ${x.days} ${x.days === 1 ? 'day' : 'days'}`}`).join('; ')}{papers.length > 5 ? ' and more' : ''}. Renew under <Link href="/app/masters/vehicles" prefetch={false} className="mn-id-link">Vehicles</Link>.</span>
            </div>
          )}
        </div>
      )}

      {error && <ErrorState message={error} />}
      {msg && <div className="mn-ord-note mn-ord-note--ok" role="status"><CheckCircle2 size={16} aria-hidden /><span>{msg}</span></div>}

      {showJob && canRecord && (
        <Card
          title={<span className="mn-board-card-title"><Wrench size={16} aria-hidden /> Log a maintenance job</span>}
          actions={<Button variant="ghost" size="sm" icon={<X size={14} />} onClick={() => setShowJob(false)}>Close</Button>}
        >
          <Form onSubmit={createJob} className="mn-fm-form">
            <Field label="Vehicle" required>
              <Select value={jVehicle} onChange={(e) => { setJVehicle(e.target.value); setJSchedule(''); }} required>
                <option value="">Choose…</option>
                {vehicles.map((v) => <option key={String(v.id)} value={String(v.id)}>{String(v.vehicleNo)}{v.vehicleType ? ` · ${typeLabel(v.vehicleType)}` : ''}</option>)}
              </Select>
            </Field>
            <Field label="Kind" help={JOB_TYPES.find((t) => t.value === jType)?.hint}>
              <Select value={jType} onChange={(e) => setJType(e.target.value)}>
                {JOB_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </Select>
            </Field>
            <Field label="Fulfils schedule" help={jVehicle && !schedulesForVehicle.length ? 'No schedules on this vehicle.' : 'Completing the job rolls that schedule forward.'}>
              <Select value={jSchedule} onChange={(e) => setJSchedule(e.target.value)} disabled={!schedulesForVehicle.length}>
                <option value="">None</option>
                {schedulesForVehicle.map((s) => <option key={String(s.id)} value={String(s.id)}>{String(s.serviceType)}</option>)}
              </Select>
            </Field>
            <Field label="Odometer (km)" help={jVehicle && lastOdo(jVehicle) ? `Last known reading ${km(lastOdo(jVehicle))}.` : 'The reading when the job was done.'}>
              <Input type="number" step="any" inputMode="decimal" min={0} value={jOdo} onChange={(e) => setJOdo(e.target.value)} />
            </Field>
            <Field label="Garage or vendor">
              <Input value={jVendor} placeholder="e.g. Sri Murugan Motors" onChange={(e) => setJVendor(e.target.value)} />
            </Field>
            <Field label="Labour (₹)">
              <Input type="number" step="any" inputMode="decimal" min={0} value={jLabour} onChange={(e) => setJLabour(e.target.value)} />
            </Field>
            <Field label="Parts (₹)">
              <Input type="number" step="any" inputMode="decimal" min={0} value={jParts} onChange={(e) => setJParts(e.target.value)} />
            </Field>
            <Field label="Hours off the road" help={jType === 'breakdown' ? 'Counts against the fleet.' : 'Optional.'}>
              <Input type="number" step="any" inputMode="decimal" min={0} value={jDowntime} onChange={(e) => setJDowntime(e.target.value)} />
            </Field>
            <div className="mn-fm-form-wide">
              <Field label="What was done">
                <Input value={jDesc} placeholder="e.g. Drum blade set replaced" onChange={(e) => setJDesc(e.target.value)} />
              </Field>
            </div>
            <div className="mn-fm-form-submit">
              <Button type="submit" loading={busy} icon={<Wrench size={14} />}>Log the job</Button>
              <Button type="button" variant="secondary" onClick={() => setShowJob(false)}>Cancel</Button>
              <span className="mn-ord-how">{jobTotal > 0 ? `Job total ${money(jobTotal)}.` : 'The cost can be filled in later, before the job is completed.'}</span>
            </div>
          </Form>
        </Card>
      )}

      {showSchedule && canRecord && (
        <Card
          title={<span className="mn-board-card-title"><CalendarClock size={16} aria-hidden /> Add a service schedule</span>}
          actions={<Button variant="ghost" size="sm" icon={<X size={14} />} onClick={() => setShowSchedule(false)}>Close</Button>}
        >
          <Form onSubmit={createSchedule} className="mn-fm-form">
            <Field label="Vehicle" required>
              <Select value={sVehicle} onChange={(e) => setSVehicle(e.target.value)} required>
                <option value="">Choose…</option>
                {vehicles.map((v) => <option key={String(v.id)} value={String(v.id)}>{String(v.vehicleNo)}{v.vehicleType ? ` · ${typeLabel(v.vehicleType)}` : ''}</option>)}
              </Select>
            </Field>
            <Field label="Service" required help="Engine oil, Hydraulic oil, Drum blades, Tyres…">
              <Input value={sType} placeholder="e.g. Engine oil and filters" onChange={(e) => setSType(e.target.value)} required />
            </Field>
            <Field label="Every (km)" help="Leave blank if it is by time only.">
              <Input type="number" inputMode="numeric" min={0} value={sIntervalKm} onChange={(e) => setSIntervalKm(e.target.value)} />
            </Field>
            <Field label="Every (days)" help="Leave blank if it is by distance only.">
              <Input type="number" inputMode="numeric" min={0} value={sIntervalDays} onChange={(e) => setSIntervalDays(e.target.value)} />
            </Field>
            <Field label="Last done at (km)" help="The next due works out from here.">
              <Input type="number" step="any" inputMode="decimal" min={0} value={sLastOdo} onChange={(e) => setSLastOdo(e.target.value)} />
            </Field>
            <Field label="Last done on">
              <Input type="date" value={sLastDate} onChange={(e) => setSLastDate(e.target.value)} />
            </Field>
            <div className="mn-fm-form-submit">
              <Button type="submit" loading={busy} icon={<CalendarClock size={14} />}>Add the schedule</Button>
              <Button type="button" variant="secondary" onClick={() => setShowSchedule(false)}>Cancel</Button>
              <span className="mn-ord-how">The state (ok, due soon, overdue) follows the vehicle's latest fuel or job reading.</span>
            </div>
          </Form>
        </Card>
      )}

      <Card
        title={<span className="mn-board-card-title"><CalendarClock size={16} aria-hidden /> Service schedules <span className="mn-board-card-count">{schedules.length}</span></span>}
        actions={<span className="mn-ord-how">Overdue first. Due soon means within 500 km or 14 days.</span>}
        padded={false}
      >
        {!loaded ? (
          <div className="mn-ord-skel"><TableSkeleton cols={5} /></div>
        ) : sortedSchedules.length ? (
          <div className="mn-ord-list" role="list">
            <div className="mn-ord-cols mn-fm-scols" aria-hidden>
              <span>Vehicle</span>
              <span>Service</span>
              <span>Next due</span>
              <span>State</span>
              <span />
            </div>
            {sortedSchedules.map((s) => {
              const due = dueOf(s);
              const state = s.isActive ? String(due.status ?? 'ok') : 'inactive';
              const every = [s.intervalKm ? `every ${km(s.intervalKm)}` : null, s.intervalDays ? `every ${String(s.intervalDays)} days` : null].filter(Boolean).join(' or ');
              const next = [s.nextDueOdometer ? km(s.nextDueOdometer) : null, s.nextDueDate ? formatDate(s.nextDueDate) : null].filter(Boolean).join(' · ') || 'Not worked out yet';
              return (
                <div key={String(s.id)} className={`mn-ord-row mn-fm-srow${s.isActive ? '' : ' is-void'}`} data-tone={s.isActive ? dueTone(state) : 'neutral'} role="listitem">
                  <div className="mn-ord-id">
                    <span className="mn-ord-no">{String(s.vehicleNo ?? vehLabel(s.vehicleId))}</span>
                    <span className="mn-ord-meta">{typeLabel(s.vehicleType) || 'Vehicle'}{s.currentOdometer != null ? ` · now at ${km(s.currentOdometer)}` : ''}</span>
                  </div>
                  <div className="mn-ord-who">
                    <span className="mn-ord-cust">{String(s.serviceType)}</span>
                    <span className="mn-ord-meta">{every || 'no interval'}{s.lastServiceDate || s.lastServiceOdometer ? ` · last ${[s.lastServiceDate ? formatDate(s.lastServiceDate) : null, s.lastServiceOdometer ? km(s.lastServiceOdometer) : null].filter(Boolean).join(' at ')}` : ' · never done'}</span>
                  </div>
                  <div className="mn-fm-next">
                    <span className={state === 'overdue' ? 'mn-id-bad' : ''}>{next}</span>
                    <span className="mn-ord-meta">{due.kmRemaining != null ? (due.kmRemaining <= 0 ? `${km(-due.kmRemaining)} over` : `${km(due.kmRemaining)} to go`) : ''}{due.kmRemaining != null && due.daysRemaining != null ? ' · ' : ''}{due.daysRemaining != null ? (due.daysRemaining < 0 ? `${-due.daysRemaining} ${due.daysRemaining === -1 ? 'day' : 'days'} over` : due.daysRemaining === 0 ? 'due today' : `${due.daysRemaining} ${due.daysRemaining === 1 ? 'day' : 'days'} to go`) : ''}</span>
                  </div>
                  <div className="mn-ord-status"><StatusBadge status={state === 'due_soon' ? 'due_soon' : state} /></div>
                  <div className="mn-ord-act mn-fm-acts">
                    {canRecord && Boolean(s.isActive) && <Button size="sm" variant={state === 'ok' ? 'ghost' : undefined} icon={<Wrench size={14} />} onClick={() => logService(s)}>Log this service</Button>}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState title="No service schedules yet" description={canRecord ? 'Add one per service per vehicle: engine oil every 5,000 km or 90 days, hydraulic oil every 180 days, and so on. The screen then says what is due.' : 'Nothing to show.'} action={canRecord ? <Button variant="secondary" size="sm" icon={<CalendarClock size={14} />} onClick={() => setShowSchedule(true)}>Add a schedule</Button> : undefined} />
        )}
      </Card>

      {/* Stage strip — counts per stage; press one to filter, press again for all. */}
      <div className="mn-board-strip" role="group" aria-label="Filter jobs by stage">
        {STAGES.map((s) => {
          const c = counts.get(s.key) ?? 0;
          const on = filter === s.key;
          return (
            <button key={s.key} type="button" className={`mn-board-chip${on ? ' is-on' : ''}${c === 0 ? ' is-empty' : ''}`} data-tone={s.tone} aria-pressed={on} title={s.hint} onClick={() => setFilter(on ? '' : s.key)}>
              <span className="mn-board-chip-n">{c}</span>
              <span className="mn-board-chip-l">{s.label}</span>
            </button>
          );
        })}
        {filter && <button type="button" className="mn-board-chip mn-board-chip-clear" onClick={() => setFilter('')}>Show all</button>}
      </div>

      <Card
        title={<span className="mn-board-card-title"><Wrench size={16} aria-hidden /> Jobs <span className="mn-board-card-count">{shown.length}</span></span>}
        actions={<span className="mn-ord-how">Newest first. Only completed jobs count in the running-cost report.</span>}
        padded={false}
      >
        {!loaded ? (
          <div className="mn-ord-skel"><TableSkeleton cols={6} /></div>
        ) : shown.length ? (
          <div className="mn-ord-list" role="list">
            <div className="mn-ord-cols mn-ord-cols--acts" aria-hidden>
              <span>Job</span>
              <span>Vehicle</span>
              <span>What was done</span>
              <span className="is-num">Cost</span>
              <span>Stage</span>
              <span />
            </div>
            {shown.map((j) => {
              const status = String(j.status);
              return (
                <div key={String(j.id)} className={`mn-ord-row mn-ord-row--acts mn-fm-row${status === 'cancelled' ? ' is-void' : ''}`} data-tone={toneOf(status)} role="listitem">
                  <div className="mn-ord-id">
                    <span className="mn-ord-no">{String(j.jobNo)}</span>
                    <span className="mn-ord-meta">{formatDate(j.reportedDate)}<span className="mn-ord-dot" aria-hidden>·</span>{jobTypeLabel(j.jobType)}</span>
                  </div>
                  <div className="mn-ord-who">
                    <span className="mn-ord-cust">{String(j.vehicleNo ?? vehLabel(j.vehicleId))}</span>
                    <span className="mn-ord-meta">{j.vendorName ? String(j.vendorName) : 'In-house'}{j.odometer ? ` · at ${km(j.odometer)}` : ''}</span>
                  </div>
                  <div className="mn-pu-mats">
                    <span className="mn-pu-mats-text">{j.description ? String(j.description) : <span className="mn-ord-meta">No description</span>}</span>
                    <span className="mn-ord-meta">{j.scheduleServiceType ? `fulfils ${String(j.scheduleServiceType)}` : ''}{j.scheduleServiceType && j.completedDate ? ' · ' : ''}{j.completedDate ? `done ${formatDate(j.completedDate)}` : ''}</span>
                  </div>
                  <div className="mn-ord-val">
                    <span className="mn-ord-amt">{money(j.totalCost)}</span>
                    <span className="mn-ord-meta">{num(j.labourCost) || num(j.partsCost) ? `labour ${money(j.labourCost)} · parts ${money(j.partsCost)}` : 'no cost yet'}{num(j.downtimeHours) ? ` · ${num(j.downtimeHours)} h off road` : ''}</span>
                  </div>
                  <div className="mn-ord-status">{status === 'open' && String(j.jobType) === 'breakdown' ? <Badge tone="danger">breakdown</Badge> : <StatusBadge status={status} />}</div>
                  <div className="mn-ord-act mn-fm-acts">
                    {canRecord && status === 'open' && <Button size="sm" icon={<CheckCircle2 size={14} />} disabled={busy} onClick={() => completeJob(j)}>Complete</Button>}
                    {canRecord && status === 'open' && (
                      <Button variant="ghost" size="sm" icon={<XCircle size={14} />} disabled={busy} onClick={async () => {
                        if (!(await confirm({ title: `Cancel ${String(j.jobNo)}`, message: 'The job is struck out; nothing goes into the running cost. This cannot be undone.', confirmLabel: 'Cancel job', danger: true }))) return;
                        run(() => fleetApi.cancelJob(String(j.id)), `${String(j.jobNo)} cancelled.`);
                      }}>Cancel</Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState
            title={filter ? `No ${labelOf(filter)} jobs` : 'No maintenance jobs yet'}
            description={filter ? 'Press the chip again to see every job.' : canRecord ? 'Press Log a job for a service, a repair or a breakdown: the vehicle, the garage, labour and parts.' : 'Nothing to show.'}
            action={filter ? <Button variant="secondary" size="sm" onClick={() => setFilter('')}>Show all jobs</Button> : canRecord ? <Button size="sm" icon={<Plus size={14} />} onClick={() => setShowJob(true)}>Log a job</Button> : undefined}
          />
        )}
        <ListCap shown={jobs.length} limit={win.limit} canWiden={win.canWiden} onWiden={() => win.setLimit(win.widen())} noun="jobs" />
      </Card>
      {loaded && !vehicles.length && (
        <div className="mn-ord-note" role="note">
          <Truck size={16} aria-hidden />
          <span>No vehicles yet. Add the mixers and pumps under <Link href="/app/masters/vehicles" prefetch={false} className="mn-id-link">Vehicles</Link> first.</span>
        </div>
      )}
    </div>
  );
}
