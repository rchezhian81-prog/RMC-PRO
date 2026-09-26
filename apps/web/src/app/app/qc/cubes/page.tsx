'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Beaker, Boxes, CheckCircle2, ClipboardList, Hammer, Plus, RefreshCw, X, XCircle } from 'lucide-react';
import { formatDate } from '../../../../lib/format-date';
import { useListWindow } from '../../../../lib/list-window';
import { ListCap } from '../../../../components/ListCap';
import { batchTicketsApi, crud, qcApi, type Row } from '../../../../lib/api';
import { getAccess } from '../../../../lib/session';
import { Card } from '../../../../components/ui/Card';
import { StatusBadge } from '../../../../components/ui/Badge';
import { Button } from '../../../../components/ui/Button';
import { Form } from '../../../../components/ui/Form';
import { Field, Input, Select } from '../../../../components/ui/Field';
import { ErrorState, EmptyState, TableSkeleton } from '../../../../components/ui/States';
import { todayLocal } from '../../../../lib/report-range';

/**
 * Cube sets — the strength test that proves a pour.
 *
 * A stage strip (curing / due for crushing / accepted / rejected) with live
 * counts doubles as the filter, a summary pill counts the sets on screen, a
 * note names the sets past their 28-day date, and each set is one row: the
 * set number with its cast and due dates, the grade with its fck, ticket and
 * plant, the cubes crushed so far at 7 and 28 days, the 28-day mean against
 * what the grade needs, the stage, and Open / Record. The cast form opens on
 * demand: picking a grade sets the fck from its code, picking a ticket fixes
 * the grade. Same layout in both skins; every colour reads the semantic tokens.
 */

const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v)) || 0;
const one = (v: unknown) => num(v).toLocaleString('en-IN', { maximumFractionDigits: 1 });
const daysSince = (d: unknown) => (d ? Math.floor((Date.now() - new Date(`${String(d).slice(0, 10)}T00:00:00`).getTime()) / 86_400_000) : null);
const dueOn = (cast: unknown) => { const x = new Date(`${String(cast).slice(0, 10)}T00:00:00`); x.setDate(x.getDate() + 28); return x; };
/** IS 456 Table 11: the margin is 4 N/mm² from M20 up, 3 below. */
const margin = (fck: number) => (fck >= 20 ? 4 : 3);
const fckOfCode = (code: string) => { const mm = /(\d+(?:\.\d+)?)/.exec(code); return mm ? Number(mm[1]) : 0; };

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';
const STAGES: Array<{ key: string; label: string; tone: Tone; hint: string }> = [
  { key: 'curing', label: 'Curing', tone: 'info', hint: 'Cubes in the tank; not yet 28 days old' },
  { key: 'due', label: 'Due for crushing', tone: 'warning', hint: '28 days have passed; crush the cubes and record the results' },
  { key: 'accepted', label: 'Accepted', tone: 'success', hint: 'The 28-day results meet IS 456' },
  { key: 'rejected', label: 'Rejected', tone: 'danger', hint: 'The 28-day results fall short of IS 456' },
];
const stageOf = (r: Row) => {
  if (r.acceptanceStatus === 'accepted' || r.acceptanceStatus === 'rejected') return String(r.acceptanceStatus);
  return (daysSince(r.castDate) ?? 0) >= 28 ? 'due' : 'curing';
};
const toneOf = (s: string): Tone => STAGES.find((x) => x.key === s)?.tone ?? 'neutral';
const labelOf = (s: string) => STAGES.find((x) => x.key === s)?.label.toLowerCase() ?? s;

export default function CubeSets() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [grades, setGrades] = useState<Row[]>([]);
  const [plants, setPlants] = useState<Row[]>([]);
  const [tickets, setTickets] = useState<Row[]>([]);
  const win = useListWindow();
  const [filter, setFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const canRecord = getAccess().has('qc.record');

  const [gradeId, setGradeId] = useState('');
  const [ticketId, setTicketId] = useState('');
  const [plantId, setPlantId] = useState('');
  const [castDate, setCastDate] = useState(todayLocal());
  const [specimens, setSpecimens] = useState('3');
  const [samplingRef, setSamplingRef] = useState('');
  const [remarks, setRemarks] = useState('');

  const reload = useCallback(async () => {
    const [list, g, p, t] = await Promise.all([
      qcApi.cubeSets(undefined, win.limit),
      crud('concrete-grades').list({ active: true }),
      crud('plants').list({ active: true }),
      batchTicketsApi.list('confirmed', 50).catch(() => [] as Row[]),
    ]);
    setRows(list);
    setGrades(g);
    setPlants(p);
    setTickets(t);
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

  function pickTicket(tid: string) {
    setTicketId(tid);
    const t = tickets.find((x) => String(x.id) === tid);
    if (t?.gradeId) setGradeId(String(t.gradeId));
    if (t?.plantId) setPlantId(String(t.plantId));
    if (t?.batchStartTime) setCastDate(String(t.batchStartTime).slice(0, 10));
  }
  const grade = grades.find((g) => String(g.id) === gradeId);
  const fck = grade ? fckOfCode(String(grade.gradeCode)) : 0;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!gradeId) { setError('Pick the grade; its code gives the strength the cubes must reach.'); return; }
    setBusy(true);
    try {
      const created = await qcApi.cubeSetCreate({
        gradeId, batchTicketId: ticketId || undefined, plantId: plantId || undefined,
        castDate, specimenCount: num(specimens) || 3, samplingRef: samplingRef || undefined, remarks: remarks || undefined,
      });
      router.push(`/app/qc/cubes/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
      setBusy(false);
    }
  }

  const counts = useMemo(() => {
    const c = new Map<string, number>();
    for (const r of rows) c.set(stageOf(r), (c.get(stageOf(r)) ?? 0) + 1);
    return c;
  }, [rows]);
  const shown = useMemo(() => {
    const list = filter ? rows.filter((r) => stageOf(r) === filter) : rows;
    // Due sets first (oldest first), then curing, then the decided ones newest first.
    const order: Record<string, number> = { due: 0, curing: 1, rejected: 2, accepted: 3 };
    return [...list].sort((a, b) => (order[stageOf(a)] ?? 9) - (order[stageOf(b)] ?? 9) || (stageOf(a) === 'due' ? String(a.castDate).localeCompare(String(b.castDate)) : String(b.castDate).localeCompare(String(a.castDate))));
  }, [rows, filter]);
  const due = counts.get('due') ?? 0;
  const rejected = counts.get('rejected') ?? 0;
  const oldestDue = rows.filter((r) => stageOf(r) === 'due').reduce((t, r) => Math.max(t, daysSince(r.castDate) ?? 0), 0);

  return (
    <div className="mn-ord mn-cb">
      <header className="mn-board-head">
        <div className="mn-board-title">
          <h1>Cube sets</h1>
          <p>Cubes cast from a pour, cured in the tank and crushed at 7 and 28 days. The 28-day results decide whether the concrete met its grade under IS 456: the mean must clear fck plus a margin and no single cube may fall below fck minus it. One set per sample; IS 456 says how many samples a day's pour needs.</p>
        </div>
        <div className="mn-board-tools">
          <span className="mn-board-live mn-ord-sum" aria-live="polite">
            <Boxes size={14} aria-hidden />
            {loaded ? `${shown.length} ${filter ? labelOf(filter) : ''} ${shown.length === 1 ? 'set' : 'sets'}${!filter && due ? ` · ${due} due` : ''}` : 'Loading…'}
          </span>
          {canRecord && !showForm && <Button icon={<Plus size={14} />} onClick={() => setShowForm(true)}>Cast a set</Button>}
          <Link href="/app/qc/slump" className="mn-ord-link">
            <Button variant="ghost" size="sm" icon={<Beaker size={14} />}>Slump tests</Button>
          </Link>
          <Link href="/app/qc/register" className="mn-ord-link">
            <Button variant="ghost" size="sm" icon={<ClipboardList size={14} />}>QC register</Button>
          </Link>
          <Button variant="ghost" size="sm" icon={<RefreshCw size={14} />} onClick={refresh} loading={refreshing}>
            Refresh
          </Button>
        </div>
      </header>

      {/* Stage strip — counts per stage; press one to filter, press again for all. */}
      <div className="mn-board-strip" role="group" aria-label="Filter by stage">
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

      {loaded && !filter && (due > 0 || rejected > 0) && (
        <div className="mn-ord-notes">
          {due > 0 && (
            <button type="button" className="mn-ord-note mn-ord-note--warn mn-ord-note--btn" onClick={() => setFilter('due')}>
              <Hammer size={16} aria-hidden />
              <span><strong>{due} {due === 1 ? 'set is' : 'sets are'} due for 28-day crushing.</strong> {oldestDue > 28 ? `The oldest was cast ${oldestDue} days ago. ` : ''}Crush the cubes, record the strengths, and the set is judged on the spot.</span>
            </button>
          )}
          {rejected > 0 && (
            <button type="button" className="mn-ord-note mn-ord-note--bad mn-ord-note--btn" onClick={() => setFilter('rejected')}>
              <XCircle size={16} aria-hidden />
              <span><strong>{rejected} {rejected === 1 ? 'set fell' : 'sets fell'} short of the grade.</strong> Open each one for the numbers; the pour it came from needs a core test or a call with the customer.</span>
            </button>
          )}
        </div>
      )}

      {error && <ErrorState message={error} />}

      {showForm && canRecord && (
        <Card
          title={<span className="mn-board-card-title"><Plus size={16} aria-hidden /> Cast a cube set</span>}
          actions={<Button variant="ghost" size="sm" icon={<X size={14} />} onClick={() => setShowForm(false)}>Close</Button>}
        >
          <Form onSubmit={submit} className="mn-cb-form">
            <Field label="Batch ticket" help="Optional. Ties the set to the load it was taken from; the grade and plant follow.">
              <Select value={ticketId} onChange={(e) => pickTicket(e.target.value)}>
                <option value="">No ticket</option>
                {tickets.map((t) => <option key={String(t.id)} value={String(t.id)}>{String(t.batchTicketNo)} · {String(t.gradeLabel ?? '')} · {String(t.batchQuantityM3 ?? '')} m³</option>)}
              </Select>
            </Field>
            <Field label="Grade" required help={fck ? `fck ${fck} N/mm²: the mean must reach ${fck + margin(fck)}, no cube below ${fck - margin(fck)}.` : 'The code gives the strength (M25 is 25 N/mm²).'}>
              <Select value={gradeId} onChange={(e) => setGradeId(e.target.value)} disabled={Boolean(ticketId)} required>
                <option value="">Choose…</option>
                {grades.map((g) => <option key={String(g.id)} value={String(g.id)}>{String(g.gradeCode)}{g.gradeName && g.gradeName !== g.gradeCode ? ` · ${String(g.gradeName)}` : ''}</option>)}
              </Select>
            </Field>
            <Field label="Plant">
              <Select value={plantId} onChange={(e) => setPlantId(e.target.value)}>
                <option value="">Not set</option>
                {plants.map((p) => <option key={String(p.id)} value={String(p.id)}>{String(p.plantName)}</option>)}
              </Select>
            </Field>
            <Field label="Cast date" required help="The 28-day date follows from it.">
              <Input type="date" value={castDate} max={todayLocal()} onChange={(e) => setCastDate(e.target.value)} required />
            </Field>
            <Field label="Cubes in the set" help="Usually 3; the set is judged once all are crushed at 28 days.">
              <Input type="number" inputMode="numeric" min={1} max={20} value={specimens} onChange={(e) => setSpecimens(e.target.value)} />
            </Field>
            <Field label="Sampling reference" help="Your lab's own number, if any.">
              <Input value={samplingRef} onChange={(e) => setSamplingRef(e.target.value)} placeholder="e.g. CS-15" />
            </Field>
            <Field label="Remarks">
              <Input value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="e.g. Taken from the third truck" />
            </Field>
            <div className="mn-cb-form-submit">
              <Button type="submit" loading={busy} icon={<Boxes size={14} />}>Cast the set</Button>
              <Button type="button" variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
              <span className="mn-ord-how">Opens the set so the 7-day results can be recorded when they come.</span>
            </div>
          </Form>
        </Card>
      )}

      <Card
        title={<span className="mn-board-card-title"><Boxes size={16} aria-hidden /> Sets <span className="mn-board-card-count">{shown.length}</span></span>}
        actions={<span className="mn-ord-how">Due sets first, then curing, then the decided ones.</span>}
        padded={false}
      >
        {!loaded ? (
          <div className="mn-ord-skel"><TableSkeleton cols={6} /></div>
        ) : shown.length ? (
          <div className="mn-ord-list" role="list">
            <div className="mn-ord-cols mn-ord-cols--acts" aria-hidden>
              <span>Set</span>
              <span>Grade and load</span>
              <span>Crushed so far</span>
              <span className="is-num">28-day mean</span>
              <span>Stage</span>
              <span />
            </div>
            {shown.map((r) => {
              const stage = stageOf(r);
              const id = String(r.id);
              const f = num(r.targetStrengthMpa);
              const need = f + margin(f);
              const floor = f - margin(f);
              const age = daysSince(r.castDate) ?? 0;
              const n = num(r.specimenCount);
              const has28 = num(r.results28) > 0;
              return (
                <div key={id} className="mn-ord-row mn-ord-row--acts mn-cb-row" data-tone={toneOf(stage)} role="listitem">
                  <div className="mn-ord-id">
                    <Link href={`/app/qc/cubes/${id}`} className="mn-ord-no mn-id-link">{String(r.setNo)}</Link>
                    <span className="mn-ord-meta">cast {formatDate(r.castDate)}<span className="mn-ord-dot" aria-hidden>·</span>{stage === 'curing' ? `28-day on ${formatDate(dueOn(r.castDate))}` : stage === 'due' ? (age === 28 ? 'due today' : `${age - 28} ${age - 28 === 1 ? 'day' : 'days'} past due`) : `${age} days old`}</span>
                  </div>
                  <div className="mn-ord-who">
                    <span className="mn-ord-cust">{String(r.gradeLabel ?? '—')} <span className="mn-ord-meta">fck {one(f)}</span>{r.batchTicketNo ? <span className="mn-ord-meta"> · {String(r.batchTicketNo)}</span> : null}</span>
                    <span className="mn-ord-meta">{r.plantName ? String(r.plantName) : 'Plant not set'}{r.samplingRef ? ` · ${String(r.samplingRef)}` : ''}</span>
                  </div>
                  <div className="mn-cb-res">
                    <span className="mn-cb-res-line">{num(r.results7) ? <><strong>7-day</strong> {num(r.results7)} of {n}{r.mean7 != null ? ` · mean ${one(r.mean7)}` : ''}</> : <span className="mn-ord-meta">7-day not crushed</span>}</span>
                    <span className="mn-cb-res-line">{has28 ? <><strong>28-day</strong> {num(r.results28)} of {n}{num(r.results28) < n ? ' · waiting for the rest' : ''}</> : <span className="mn-ord-meta">28-day not crushed</span>}</span>
                  </div>
                  <div className="mn-ord-val">
                    <span className={`mn-ord-amt${stage === 'rejected' ? ' mn-id-bad' : ''}`}>{r.meanStrengthMpa != null ? `${one(r.meanStrengthMpa)} N/mm²` : '—'}</span>
                    <span className="mn-ord-meta">{r.meanStrengthMpa != null ? `needs ≥ ${one(need)}${r.min28 != null ? ` · lowest ${one(r.min28)} (≥ ${one(floor)})` : ''}` : `needs ≥ ${one(need)}, no cube < ${one(floor)}`}</span>
                  </div>
                  <div className="mn-ord-status"><StatusBadge status={stage === 'due' ? 'due' : stage} /></div>
                  <div className="mn-ord-act mn-cb-acts">
                    {canRecord && (stage === 'due' || stage === 'curing') && (
                      <Link href={`/app/qc/cubes/${id}?record=${stage === 'due' ? 28 : 7}`} className="mn-ord-link"><Button size="sm" variant={stage === 'due' ? undefined : 'ghost'} icon={<Hammer size={14} />}>Record</Button></Link>
                    )}
                    <Link href={`/app/qc/cubes/${id}`} className="mn-ord-link"><Button variant="ghost" size="sm">Open</Button></Link>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState
            title={filter ? `No ${labelOf(filter)} sets` : 'No cube sets yet'}
            description={filter ? 'Press the chip again to see every set.' : canRecord ? 'Press Cast a set after the next sample: the grade, the ticket it came from, the cast date and how many cubes.' : 'Nothing to show.'}
            action={filter ? <Button variant="secondary" size="sm" onClick={() => setFilter('')}>Show all sets</Button> : canRecord ? <Button size="sm" icon={<Plus size={14} />} onClick={() => setShowForm(true)}>Cast a set</Button> : undefined}
          />
        )}
        <ListCap shown={rows.length} limit={win.limit} canWiden={win.canWiden} onWiden={() => win.setLimit(win.widen())} noun="cube sets" hint="the QC register" />
      </Card>
      {loaded && (
        <div className="mn-ord-note" role="note">
          <CheckCircle2 size={16} aria-hidden />
          <span><strong>How a set is judged (IS 456 Table 11).</strong> From M20 up the margin is 4 N/mm², below it 3. An M25 set passes when its 28-day mean is at least 29 and no single cube is under 21. The 7-day results are a heads-up only; a set is decided on its 28-day cubes once all of them are recorded.</span>
        </div>
      )}
    </div>
  );
}
