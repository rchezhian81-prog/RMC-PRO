'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Truck, UserRound, MapPin, RefreshCw, Plus, AlertTriangle, Undo2, FileText, ArrowUpRight, CheckCircle2,
} from 'lucide-react';
import { batchTicketsApi, challansApi, crud, dispatchApi, type Row } from '../../../../lib/api';
import { Card } from '../../../../components/ui/Card';
import { StatusBadge } from '../../../../components/ui/Badge';
import { Button } from '../../../../components/ui/Button';
import { Form } from '../../../../components/ui/Form';
import { Field } from '../../../../components/ui/Field';
import { AlertSurface } from '../../../../components/ui/AlertSurface';
import { ErrorState, EmptyState, Skeleton } from '../../../../components/ui/States';
import { useConfirm } from '../../../../components/ui/ConfirmDialog';

const qty = (v: unknown) => Number(v ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 3 });
const hhmm = (v: unknown) => {
  if (!v) return null;
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return null;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
};
/** "12m" / "2h 05m" since a timestamp — how long a load has sat in its stage. */
const since = (v: unknown) => {
  if (!v) return null;
  const ms = Date.now() - new Date(String(v)).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${String(m % 60).padStart(2, '0')}m`;
  return `${Math.floor(h / 24)}d`;
};

/**
 * Board stages, in trip order. The four live legs are always shown as lanes;
 * the two exception states appear as lanes only when a load is in them (and
 * always as counters in the strip), and the terminal states collapse into the
 * "Finished" list below the board.
 */
const STAGES: { key: string; label: string; short: string; tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger' }[] = [
  { key: 'waiting', label: 'Waiting', short: 'Waiting', tone: 'neutral' },
  { key: 'loaded', label: 'Loaded at plant', short: 'Loaded', tone: 'info' },
  { key: 'left_plant', label: 'On the road', short: 'On road', tone: 'info' },
  { key: 'reached_site', label: 'At site', short: 'At site', tone: 'info' },
  { key: 'pouring', label: 'Pouring', short: 'Pouring', tone: 'success' },
  { key: 'delayed', label: 'Delayed', short: 'Delayed', tone: 'warning' },
  { key: 'returning', label: 'Returning', short: 'Returning', tone: 'danger' },
];
const LIVE = ['loaded', 'left_plant', 'reached_site', 'pouring'];
const EXCEPTIONS = ['delayed', 'returning'];
const FINISHED = ['completed', 'rejected', 'cancelled'];
const stageOf = (key: string) => STAGES.find((s) => s.key === key);

// Happy-path board progression, plus the way out of each exception state so a
// delayed or returning load is never a dead-end (both are recoverable — only
// completed/cancelled/rejected are terminal on the server).
const NEXT: Record<string, { status: string; label: string }[]> = {
  waiting: [{ status: 'loaded', label: 'Loaded' }],
  loaded: [{ status: 'left_plant', label: 'Left plant' }],
  left_plant: [{ status: 'reached_site', label: 'Reached site' }],
  reached_site: [{ status: 'pouring', label: 'Start pour' }],
  pouring: [{ status: 'completed', label: 'Complete' }],
  delayed: [
    { status: 'reached_site', label: 'Reached site' },
    { status: 'completed', label: 'Complete' },
  ],
  returning: [{ status: 'completed', label: 'Complete' }],
};
// A load can be flagged delayed while it is still moving, and flagged as
// returning once it has left the plant with concrete on board.
const DELAYABLE = ['waiting', 'loaded', 'left_plant', 'reached_site', 'pouring'];
const RETURNABLE = ['left_plant', 'reached_site', 'pouring', 'delayed'];
const RETURN_REASONS = [
  { value: 'site_rejected', label: 'Rejected at site' },
  { value: 'excess_concrete', label: 'Excess / unpoured' },
  { value: 'access_issue', label: 'Site access issue' },
  { value: 'quality_issue', label: 'Quality issue' },
  { value: 'breakdown', label: 'Vehicle breakdown' },
  { value: 'other', label: 'Other' },
];

// The trip milestones a card's timeline shows, each read from the timestamp
// the API stamps on that transition.
const MILESTONES: { key: string; label: string; field: string }[] = [
  { key: 'left_plant', label: 'Left', field: 'dispatchTime' },
  { key: 'reached_site', label: 'Site', field: 'siteArrivalTime' },
  { key: 'pouring', label: 'Pour', field: 'pourStartTime' },
  { key: 'completed', label: 'Done', field: 'pourEndTime' },
];

const byId = (rows: Row[]) => new Map(rows.map((r) => [String(r.id), r]));

export default function DispatchBoardPage() {
  const router = useRouter();
  const { prompt } = useConfirm();
  const [rows, setRows] = useState<Row[]>([]);
  const [batches, setBatches] = useState<Row[]>([]);
  const [vehicles, setVehicles] = useState<Row[]>([]);
  const [drivers, setDrivers] = useState<Row[]>([]);
  const [customers, setCustomers] = useState<Row[]>([]);
  const [sites, setSites] = useState<Row[]>([]);
  const [challans, setChallans] = useState<Row[]>([]);
  const [form, setForm] = useState({ batchTicketId: '', vehicleId: '', driverId: '' });
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [focus, setFocus] = useState<string | null>(null);
  const [showAllDone, setShowAllDone] = useState(false);

  // Which dispatch already has a challan → drives the button state below, so it
  // reflects the real relation rather than a status guess.
  const challanByDispatch = new Map(challans.filter((c) => c.dispatchId).map((c) => [String(c.dispatchId), c]));
  const vehicleById = byId(vehicles), driverById = byId(drivers), customerById = byId(customers), siteById = byId(sites);

  async function reload() {
    // The masters (customers, sites) only label the cards, so a hiccup there
    // must not blank the board — they fall back to empty lists.
    const [d, b, v, dr, ch, cu, si] = await Promise.all([
      dispatchApi.list(),
      batchTicketsApi.list('confirmed'),
      crud('vehicles').list(),
      crud('drivers').list(),
      challansApi.list(),
      crud('customers').list().catch(() => [] as Row[]),
      crud('sites').list().catch(() => [] as Row[]),
    ]);
    setRows(d);
    setBatches(b);
    setVehicles(v);
    setDrivers(dr);
    setChallans(ch);
    setCustomers(cu);
    setSites(si);
  }
  useEffect(() => {
    reload().catch((e) => setError(String(e))).finally(() => setLoaded(true));
  }, []);

  async function refresh() {
    setRefreshing(true);
    try {
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  }

  async function run(fn: () => Promise<unknown>, okMsg?: string) {
    setError(null);
    setMsg(null);
    try {
      await fn();
      await reload();
      if (okMsg) setMsg(okMsg);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    await run(async () => {
      await dispatchApi.createFromBatch(form.batchTicketId, {
        vehicleId: form.vehicleId || undefined,
        driverId: form.driverId || undefined,
      });
      setForm({ batchTicketId: '', vehicleId: '', driverId: '' });
    }, 'Dispatch created');
  }

  async function genChallan(d: Row) {
    await run(async () => {
      const ch = await challansApi.createFromDispatch(String(d.id), {});
      router.push(`/app/dispatch/challans/${ch.id}`);
    });
  }

  // Flag a load as delayed, capturing why so the board shows the hold-up
  // instead of a silent status flip.
  async function markDelayed(r: Row) {
    const reason = await prompt({
      title: `Mark ${String(r.dispatchNo)} delayed`,
      message: 'Records the hold-up on the board and in the delivery history.',
      label: 'Delay reason',
      placeholder: 'e.g. traffic, site not ready, plant hold',
      defaultValue: '',
    });
    if (reason === null) return;
    await run(() => dispatchApi.setStatus(String(r.id), 'delayed', { delayReason: reason || 'Delayed' }), 'Marked delayed');
  }

  // Concrete coming back to the plant (short pour / rejected load). Captures the
  // returned volume and reason on the trip; the priced wastage is booked later
  // when the challan is delivered.
  async function markReturning(r: Row) {
    const qtyStr = await prompt({
      title: `${String(r.dispatchNo)} returning`,
      message: 'Concrete coming back to the plant.',
      label: 'Returned quantity (m³)',
      type: 'number',
      defaultValue: '',
    });
    if (qtyStr === null) return;
    const reason = await prompt({
      title: `${String(r.dispatchNo)} returning`,
      label: 'Return reason',
      options: RETURN_REASONS,
    });
    if (reason === null) return;
    await run(
      () => dispatchApi.setStatus(String(r.id), 'returning', { returnQuantityM3: Number(qtyStr) || 0, returnReason: reason }),
      'Marked returning',
    );
  }

  // ---- derived board state ----
  const active = rows.filter((r) => !FINISHED.includes(String(r.dispatchStatus)));
  const finished = rows
    .filter((r) => FINISHED.includes(String(r.dispatchStatus)))
    .sort((a, b) => String(b.pourEndTime ?? b.updatedAt ?? '').localeCompare(String(a.pourEndTime ?? a.updatedAt ?? '')));
  const counts = new Map<string, number>();
  for (const r of active) counts.set(String(r.dispatchStatus), (counts.get(String(r.dispatchStatus)) ?? 0) + 1);
  const activeM3 = active.reduce((a, r) => a + Number(r.quantityM3 ?? 0), 0);
  const doneToday = finished.filter((r) => {
    const t = r.pourEndTime ?? r.updatedAt;
    return t && new Date(String(t)).toDateString() === new Date().toDateString() && String(r.dispatchStatus) === 'completed';
  }).length;

  // Lanes: the live legs always; waiting + the exceptions only when occupied
  // (or when the strip has focused one); oldest-in-stage first inside a lane.
  const laneKeys = STAGES.map((s) => s.key).filter(
    (k) => LIVE.includes(k) || (counts.get(k) ?? 0) > 0 || focus === k,
  );
  const lanes = laneKeys
    .filter((k) => !focus || focus === k)
    .map((k) => ({
      stage: stageOf(k)!,
      items: active
        .filter((r) => String(r.dispatchStatus) === k)
        .sort((a, b) => String(a.updatedAt ?? '').localeCompare(String(b.updatedAt ?? ''))),
    }));

  const label = (map: Map<string, Row>, id: unknown, field: string) => {
    const r = id ? map.get(String(id)) : undefined;
    return r ? String(r[field] ?? '') : '';
  };

  return (
    <div className="mn-board">
      <header className="mn-board-head">
        <div className="mn-board-title">
          <h1>Dispatch Board</h1>
          <p>Create a dispatch from a confirmed batch ticket, move the load across the board, and generate the delivery challan.</p>
        </div>
        <div className="mn-board-tools">
          <span className="mn-board-live" aria-live="polite">
            <span className="mn-board-live-dot" aria-hidden />
            {active.length} live · {qty(activeM3)} m³ on the move · {doneToday} completed today
          </span>
          <Button variant="ghost" size="sm" icon={<RefreshCw size={14} />} onClick={refresh} loading={refreshing}>
            Refresh
          </Button>
        </div>
      </header>

      {/* Stage strip — counts per stage; tap one to focus its lane, tap again for all. */}
      <div className="mn-board-strip" role="group" aria-label="Filter by stage">
        {STAGES.filter((s) => s.key !== 'waiting' || (counts.get('waiting') ?? 0) > 0).map((s) => {
          const c = counts.get(s.key) ?? 0;
          const on = focus === s.key;
          return (
            <button
              key={s.key}
              type="button"
              className={`mn-board-chip${on ? ' is-on' : ''}${c === 0 ? ' is-empty' : ''}`}
              data-tone={s.tone}
              aria-pressed={on}
              onClick={() => setFocus(on ? null : s.key)}
            >
              <span className="mn-board-chip-n">{c}</span>
              <span className="mn-board-chip-l">{s.short}</span>
            </button>
          );
        })}
        {focus && (
          <button type="button" className="mn-board-chip mn-board-chip-clear" onClick={() => setFocus(null)}>
            Show all
          </button>
        )}
      </div>

      {error && <ErrorState message={error} />}
      {msg && <AlertSurface tone="success">{msg}</AlertSurface>}

      <Card title={<span className="mn-board-card-title"><Plus size={16} aria-hidden /> New dispatch</span>}>
        <Form onSubmit={create} className="mn-board-form">
          <div className="mn-board-form-batch">
            <Field label="Confirmed batch" required>
              <select className="mn-input" value={form.batchTicketId} onChange={(e) => setForm({ ...form, batchTicketId: e.target.value })} required>
                <option value="">— select —</option>
                {batches.map((b) => (
                  <option key={b.id} value={String(b.id)}>
                    {String(b.batchTicketNo)} · {String(b.gradeLabel ?? '')} · {qty(b.batchQuantityM3)} m³
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div>
            <Field label="Vehicle">
              <select className="mn-input" value={form.vehicleId} onChange={(e) => setForm({ ...form, vehicleId: e.target.value })}>
                <option value="">—</option>
                {vehicles.map((v) => (
                  <option key={v.id} value={String(v.id)}>{String(v.vehicleNo)}</option>
                ))}
              </select>
            </Field>
          </div>
          <div>
            <Field label="Driver">
              <select className="mn-input" value={form.driverId} onChange={(e) => setForm({ ...form, driverId: e.target.value })}>
                <option value="">—</option>
                {drivers.map((d) => (
                  <option key={d.id} value={String(d.id)}>{String(d.driverName)}</option>
                ))}
              </select>
            </Field>
          </div>
          <div className="mn-board-form-submit">
            <Button type="submit" icon={<Truck size={15} />}>Create dispatch</Button>
          </div>
        </Form>
        {loaded && batches.length === 0 && (
          <p className="mn-board-form-hint">No confirmed batch tickets waiting. Confirm one in Production → Batch tickets and it appears here.</p>
        )}
      </Card>

      {!loaded ? (
        <div className="mn-lanes" aria-busy="true" aria-label="Loading">
          {LIVE.map((k) => (
            <section className="mn-lane" key={k} data-tone={stageOf(k)!.tone}>
              <header className="mn-lane-head"><span className="mn-lane-name">{stageOf(k)!.label}</span></header>
              <div className="mn-lane-body">
                <div className="mn-dcard"><Skeleton height={14} width="45%" /><Skeleton height={26} width="70%" /><Skeleton height={12} /></div>
              </div>
            </section>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Truck size={22} />}
            title="No dispatches yet"
            description="Create a dispatch from a confirmed batch ticket above. It appears here as a card you move from loaded to completed."
          />
        </Card>
      ) : (
        <div className={`mn-lanes${focus ? ' mn-lanes--focus' : ''}`}>
          {lanes.map(({ stage, items }) => (
            <section className="mn-lane" key={stage.key} data-tone={stage.tone} aria-label={`${stage.label}: ${items.length}`}>
              <header className="mn-lane-head">
                <span className="mn-lane-name">{stage.label}</span>
                <span className="mn-lane-count">{items.length}</span>
              </header>
              <div className="mn-lane-body">
                {items.length === 0 ? (
                  <div className="mn-lane-empty">Nothing here</div>
                ) : (
                  items.map((r) => {
                    const st = String(r.dispatchStatus);
                    const ch = challanByDispatch.get(String(r.id));
                    const vehicle = label(vehicleById, r.vehicleId, 'vehicleNo');
                    const driver = label(driverById, r.driverId, 'driverName');
                    const customer = label(customerById, r.customerId, 'customerName');
                    const site = label(siteById, r.siteId, 'siteName');
                    const age = since(r.updatedAt);
                    const reached = MILESTONES.findIndex((m) => m.key === st);
                    return (
                      <article className="mn-dcard" key={String(r.id)} data-tone={stage.tone}>
                        <div className="mn-dcard-top">
                          <span className="mn-dcard-no">{String(r.dispatchNo ?? '')}</span>
                          <StatusBadge status={st} />
                          {age && <span className="mn-dcard-age" title="Time in this stage">{age}</span>}
                        </div>
                        <div className="mn-dcard-load">
                          <span className="mn-dcard-grade">{String(r.gradeLabel ?? '—')}</span>
                          <span className="mn-dcard-qty">{qty(r.quantityM3)} <small>m³</small></span>
                        </div>
                        <div className="mn-dcard-meta">
                          <span><Truck size={13} aria-hidden /> {vehicle || <em>No vehicle</em>}</span>
                          <span><UserRound size={13} aria-hidden /> {driver || <em>No driver</em>}</span>
                          {(customer || site) && (
                            <span className="mn-dcard-where"><MapPin size={13} aria-hidden /> <span className="mn-dcard-where-t" title={[customer, site].filter(Boolean).join(' · ')}>{[customer, site].filter(Boolean).join(' · ')}</span></span>
                          )}
                        </div>
                        <ol className="mn-dcard-tl" aria-label="Trip milestones">
                          {MILESTONES.map((m, i) => {
                            const t = hhmm(r[m.field]);
                            const state = t ? 'done' : i === reached + 1 && !EXCEPTIONS.includes(st) ? 'next' : 'todo';
                            return (
                              <li key={m.key} data-state={state}>
                                <span className="mn-dcard-tl-dot" aria-hidden />
                                <span className="mn-dcard-tl-l">{m.label}</span>
                                <span className="mn-dcard-tl-t">{t ?? '—'}</span>
                              </li>
                            );
                          })}
                        </ol>
                        {st === 'delayed' && r.delayReason ? (
                          <div className="mn-dcard-note" data-tone="warning"><AlertTriangle size={13} aria-hidden /> {String(r.delayReason)}</div>
                        ) : null}
                        {Number(r.returnQuantityM3) > 0 || r.returnReason ? (
                          <div className="mn-dcard-note" data-tone="danger">
                            <Undo2 size={13} aria-hidden /> Returning {qty(r.returnQuantityM3)} m³
                            {r.returnReason ? ` · ${RETURN_REASONS.find((x) => x.value === r.returnReason)?.label ?? String(r.returnReason)}` : ''}
                          </div>
                        ) : null}
                        <div className="mn-dcard-actions">
                          {(NEXT[st] ?? []).map((n, i) => (
                            <Button
                              key={n.status}
                              variant={i === 0 ? 'primary' : 'secondary'}
                              size="sm"
                              onClick={() => run(() => dispatchApi.setStatus(String(r.id), n.status), `${String(r.dispatchNo)} moved to ${stageOf(n.status)?.label.toLowerCase() ?? n.status}`)}
                            >
                              {n.label}
                            </Button>
                          ))}
                          {DELAYABLE.includes(st) && (
                            <Button variant="ghost" size="sm" onClick={() => markDelayed(r)}>Delay</Button>
                          )}
                          {RETURNABLE.includes(st) && (
                            <Button variant="ghost" size="sm" onClick={() => markReturning(r)}>Returning</Button>
                          )}
                          {ch ? (
                            <Link href={`/app/dispatch/challans/${ch.id}`} className="mn-dcard-link">
                              <FileText size={13} aria-hidden /> {String(ch.challanNo ?? 'Challan')}
                            </Link>
                          ) : (
                            <Button variant="secondary" size="sm" icon={<FileText size={13} />} onClick={() => genChallan(r)}>Challan</Button>
                          )}
                        </div>
                      </article>
                    );
                  })
                )}
              </div>
            </section>
          ))}
        </div>
      )}

      {loaded && finished.length > 0 && !focus && (
        <Card
          title={<span className="mn-board-card-title"><CheckCircle2 size={16} aria-hidden /> Finished <span className="mn-board-card-count">{finished.length}</span></span>}
          actions={
            <Link href="/app/dispatch/delivery-register" className="mn-dash-more">
              Delivery register <ArrowUpRight size={14} aria-hidden />
            </Link>
          }
          padded={false}
        >
          <div className="mn-done">
            {(showAllDone ? finished : finished.slice(0, 6)).map((r) => {
              const ch = challanByDispatch.get(String(r.id));
              const vehicle = label(vehicleById, r.vehicleId, 'vehicleNo');
              const t = hhmm(r.pourEndTime ?? r.updatedAt);
              return (
                <div className="mn-done-row" key={String(r.id)}>
                  <span className="mn-done-no">{String(r.dispatchNo ?? '')}</span>
                  <span className="mn-done-load">{String(r.gradeLabel ?? '—')} · {qty(r.quantityM3)} m³{vehicle ? ` · ${vehicle}` : ''}</span>
                  <span className="mn-done-t">{t ?? ''}</span>
                  <StatusBadge status={String(r.dispatchStatus)} />
                  {ch ? (
                    <Link href={`/app/dispatch/challans/${ch.id}`} className="mn-dcard-link">{String(ch.challanNo ?? 'Challan')}</Link>
                  ) : (
                    <span className="mn-done-nochallan">No challan</span>
                  )}
                </div>
              );
            })}
            {finished.length > 6 && (
              <button type="button" className="mn-done-more" onClick={() => setShowAllDone((v) => !v)}>
                {showAllDone ? 'Show fewer' : `Show all ${finished.length}`}
              </button>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
