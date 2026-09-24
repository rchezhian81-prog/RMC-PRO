'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { AlertTriangle, Beaker, Boxes, CheckCircle2, ClipboardList, Plus, RefreshCw, X } from 'lucide-react';
import { formatDateTime } from '../../../../lib/format-date';
import { useListWindow } from '../../../../lib/list-window';
import { ListCap } from '../../../../components/ListCap';
import { batchTicketsApi, crud, mixDesignsApi, qcApi, type Row } from '../../../../lib/api';
import { getAccess } from '../../../../lib/session';
import { Card } from '../../../../components/ui/Card';
import { StatusBadge } from '../../../../components/ui/Badge';
import { Button } from '../../../../components/ui/Button';
import { Form } from '../../../../components/ui/Form';
import { Field, Input, Select } from '../../../../components/ui/Field';
import { ErrorState, EmptyState, TableSkeleton } from '../../../../components/ui/States';

/**
 * Slump tests — the wet-concrete check at the plant or the site.
 *
 * A result strip (in range / out of range) with live counts doubles as the
 * filter, a summary pill counts the tests on screen, a note counts the tests
 * out of range, and each test is one row: when it was taken with the sample
 * reference, the grade with its batch ticket and plant, the measured slump on
 * a bar against the target range, the result, who tested it and the remarks.
 * The record form opens on demand; picking a grade fills the target range
 * from its mix design, picking a batch ticket fixes the grade, and the result
 * shows as the number is typed. Same layout in both skins; every colour reads
 * the semantic tokens.
 */

const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v)) || 0;

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';
const RESULTS: Array<{ key: string; label: string; tone: Tone; hint: string }> = [
  { key: 'passed', label: 'In range', tone: 'success', hint: 'The slump was inside the target range, or no range was set' },
  { key: 'failed', label: 'Out of range', tone: 'danger', hint: 'Too stiff or too wet for the target' },
];
const resultOf = (r: Row) => (r.passed ? 'passed' : 'failed');
const labelOf = (k: string) => RESULTS.find((x) => x.key === k)?.label.toLowerCase() ?? k;

/** Where a slump sits on a 0–250 mm scale, with the target band. */
function SlumpBar({ value, min, max }: { value: number; min: number | null; max: number | null }) {
  const scale = 250;
  const pct = (v: number) => `${Math.max(0, Math.min(100, (v / scale) * 100))}%`;
  const ok = (min === null || value >= min) && (max === null || value <= max);
  return (
    <span className="mn-sl-bar" aria-hidden>
      {(min !== null || max !== null) && <span className="mn-sl-bar-band" style={{ left: pct(min ?? 0), width: `calc(${pct(max ?? scale)} - ${pct(min ?? 0)})` }} />}
      <span className={`mn-sl-bar-dot${ok ? '' : ' is-bad'}`} style={{ left: pct(value) }} />
    </span>
  );
}

export default function SlumpTests() {
  const [rows, setRows] = useState<Row[]>([]);
  const [grades, setGrades] = useState<Row[]>([]);
  const [plants, setPlants] = useState<Row[]>([]);
  const [tickets, setTickets] = useState<Row[]>([]);
  const [mixes, setMixes] = useState<Row[]>([]);
  const win = useListWindow();
  const [filter, setFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const canRecord = getAccess().has('qc.record');

  const [gradeId, setGradeId] = useState('');
  const [ticketId, setTicketId] = useState('');
  const [plantId, setPlantId] = useState('');
  const [measured, setMeasured] = useState('');
  const [tMin, setTMin] = useState('');
  const [tMax, setTMax] = useState('');
  const [sampleRef, setSampleRef] = useState('');
  const [remarks, setRemarks] = useState('');

  const reload = useCallback(async () => {
    const [list, g, p, t, mx] = await Promise.all([
      qcApi.slumpList(win.limit),
      crud('concrete-grades').list({ active: true }),
      crud('plants').list({ active: true }),
      // The pick-list only needs the recent confirmed tickets; the test can stand on its own.
      batchTicketsApi.list('confirmed', 50).catch(() => [] as Row[]),
      mixDesignsApi.list().catch(() => [] as Row[]),
    ]);
    setRows(list);
    setGrades(g);
    setPlants(p);
    setTickets(t);
    setMixes(mx);
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

  // The grade's mix design carries the slump the plant designs for; it becomes
  // the target range unless the tester overrides it.
  function pickGrade(gid: string) {
    setGradeId(gid);
    const mix = mixes.find((m) => String(m.gradeId) === gid && (m.slumpMin != null || m.slumpMax != null));
    setTMin(mix?.slumpMin != null ? String(mix.slumpMin) : '');
    setTMax(mix?.slumpMax != null ? String(mix.slumpMax) : '');
  }
  // A test against a ticket is for that ticket's grade; the API refuses a mismatch.
  function pickTicket(tid: string) {
    setTicketId(tid);
    const t = tickets.find((x) => String(x.id) === tid);
    if (t?.gradeId) pickGrade(String(t.gradeId));
    if (t?.plantId) setPlantId(String(t.plantId));
  }

  const m = num(measured);
  const mn = tMin === '' ? null : num(tMin);
  const mx = tMax === '' ? null : num(tMax);
  const preview = m > 0
    ? mn !== null && mx !== null && mn > mx ? { text: 'The target min is above the max; swap them.', tone: 'warning' as const }
    : mn === null && mx === null ? { text: `${m} mm recorded with no target; it counts as in range.`, tone: 'neutral' as const }
    : (mn === null || m >= mn) && (mx === null || m <= mx) ? { text: `${m} mm is within the target of ${mn ?? '…'}–${mx ?? '…'} mm.`, tone: 'success' as const }
    : m < (mn ?? 0) ? { text: `${m} mm is ${(mn ?? 0) - m} mm too stiff for the target of ${mn}–${mx ?? '…'} mm.`, tone: 'danger' as const }
    : { text: `${m} mm is ${m - (mx ?? 0)} mm too wet for the target of ${mn ?? '…'}–${mx} mm.`, tone: 'danger' as const }
    : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setMsg(null);
    if (!(m > 0)) { setError('Enter the measured slump in mm.'); return; }
    const g = grades.find((x) => String(x.id) === gradeId);
    setBusy(true);
    try {
      await qcApi.slumpCreate({
        gradeId: gradeId || undefined, gradeLabel: g ? String(g.gradeCode) : undefined,
        batchTicketId: ticketId || undefined, plantId: plantId || undefined,
        measuredSlumpMm: m, targetMinMm: mn ?? undefined, targetMaxMm: mx ?? undefined,
        sampleRef: sampleRef || undefined, remarks: remarks || undefined,
      });
      setMsg(`Slump test recorded: ${m} mm${g ? ` on ${String(g.gradeCode)}` : ''}${preview?.tone === 'danger' ? ', out of range' : ''}.`);
      setMeasured('');
      setSampleRef('');
      setRemarks('');
      setTicketId('');
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
    for (const r of rows) c.set(resultOf(r), (c.get(resultOf(r)) ?? 0) + 1);
    return c;
  }, [rows]);
  const shown = filter ? rows.filter((r) => resultOf(r) === filter) : rows;
  const failed = counts.get('failed') ?? 0;

  return (
    <div className="mn-ord mn-sl">
      <header className="mn-board-head">
        <div className="mn-board-title">
          <h1>Slump tests</h1>
          <p>The wet-concrete check before a truck leaves or when it arrives: a cone of concrete is lifted and the drop is measured in mm. Too stiff will not pump or place; too wet has had water added and loses strength. Each test is kept against its grade and batch ticket.</p>
        </div>
        <div className="mn-board-tools">
          <span className="mn-board-live mn-ord-sum" aria-live="polite">
            <Beaker size={14} aria-hidden />
            {loaded ? `${shown.length} ${filter ? labelOf(filter) : ''} ${shown.length === 1 ? 'test' : 'tests'}${!filter && failed ? ` · ${failed} out of range` : ''}` : 'Loading…'}
          </span>
          {canRecord && !showForm && <Button icon={<Plus size={14} />} onClick={() => { setShowForm(true); setMsg(null); }}>Record a test</Button>}
          <Link href="/app/qc/cubes" className="mn-ord-link">
            <Button variant="ghost" size="sm" icon={<Boxes size={14} />}>Cube sets</Button>
          </Link>
          <Link href="/app/qc/register" className="mn-ord-link">
            <Button variant="ghost" size="sm" icon={<ClipboardList size={14} />}>QC register</Button>
          </Link>
          <Button variant="ghost" size="sm" icon={<RefreshCw size={14} />} onClick={refresh} loading={refreshing}>
            Refresh
          </Button>
        </div>
      </header>

      {/* Result strip — counts per result; press one to filter, press again for all. */}
      <div className="mn-board-strip" role="group" aria-label="Filter by result">
        {RESULTS.map((s) => {
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

      {loaded && failed > 0 && !filter && (
        <div className="mn-ord-notes">
          <button type="button" className="mn-ord-note mn-ord-note--bad mn-ord-note--btn" onClick={() => setFilter('failed')}>
            <AlertTriangle size={16} aria-hidden />
            <span><strong>{failed} {failed === 1 ? 'test was' : 'tests were'} out of range.</strong> Check the remarks: a wet result usually means water was added on the way, a stiff one that the load waited too long.</span>
          </button>
        </div>
      )}

      {error && <ErrorState message={error} />}
      {msg && <div className="mn-ord-note mn-ord-note--ok" role="status"><CheckCircle2 size={16} aria-hidden /><span>{msg}</span></div>}

      {showForm && canRecord && (
        <Card
          title={<span className="mn-board-card-title"><Plus size={16} aria-hidden /> Record a slump test</span>}
          actions={<Button variant="ghost" size="sm" icon={<X size={14} />} onClick={() => setShowForm(false)}>Close</Button>}
        >
          <Form onSubmit={submit} className="mn-sl-form">
            <Field label="Batch ticket" help="Optional. Ties the test to the load; the grade follows the ticket.">
              <Select value={ticketId} onChange={(e) => pickTicket(e.target.value)}>
                <option value="">No ticket</option>
                {tickets.map((t) => <option key={String(t.id)} value={String(t.id)}>{String(t.batchTicketNo)} · {String(t.gradeLabel ?? '')} · {String(t.batchQuantityM3 ?? '')} m³</option>)}
              </Select>
            </Field>
            <Field label="Grade" help="Fills the target range from the grade's mix design.">
              <Select value={gradeId} onChange={(e) => pickGrade(e.target.value)} disabled={Boolean(ticketId)}>
                <option value="">Not set</option>
                {grades.map((g) => <option key={String(g.id)} value={String(g.id)}>{String(g.gradeCode)}{g.gradeName && g.gradeName !== g.gradeCode ? ` · ${String(g.gradeName)}` : ''}</option>)}
              </Select>
            </Field>
            <Field label="Plant">
              <Select value={plantId} onChange={(e) => setPlantId(e.target.value)}>
                <option value="">Not set</option>
                {plants.map((p) => <option key={String(p.id)} value={String(p.id)}>{String(p.plantName)}</option>)}
              </Select>
            </Field>
            <Field label="Measured slump (mm)" required>
              <Input type="number" inputMode="numeric" min={0} max={300} value={measured} onChange={(e) => setMeasured(e.target.value)} required autoFocus />
            </Field>
            <Field label="Target min (mm)" help="Leave both blank to record without a verdict.">
              <Input type="number" inputMode="numeric" min={0} max={300} value={tMin} onChange={(e) => setTMin(e.target.value)} />
            </Field>
            <Field label="Target max (mm)">
              <Input type="number" inputMode="numeric" min={0} max={300} value={tMax} onChange={(e) => setTMax(e.target.value)} />
            </Field>
            <Field label="Sample reference" help="Your lab's own number, if any.">
              <Input value={sampleRef} onChange={(e) => setSampleRef(e.target.value)} placeholder="e.g. S-104" />
            </Field>
            <Field label="Remarks" help="Truck, site, what was seen.">
              <Input value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="e.g. Water added at site by the driver" />
            </Field>
            <div className="mn-sl-form-foot">
              {preview ? <span className={`mn-ord-note mn-sl-preview${preview.tone === 'success' ? ' mn-ord-note--ok' : preview.tone === 'danger' ? ' mn-ord-note--bad' : preview.tone === 'warning' ? ' mn-ord-note--warn' : ''}`} role="status">{preview.text}</span> : <span className="mn-ord-how">Type the measured slump to see the result before you save.</span>}
              <div className="mn-sl-form-submit">
                <Button type="submit" loading={busy} icon={<Beaker size={14} />}>Save the test</Button>
                <Button type="button" variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
              </div>
            </div>
          </Form>
        </Card>
      )}

      <Card
        title={<span className="mn-board-card-title"><Beaker size={16} aria-hidden /> Tests <span className="mn-board-card-count">{shown.length}</span></span>}
        actions={<span className="mn-ord-how">Newest first. The bar runs 0 to 250 mm; the shaded band is the target.</span>}
        padded={false}
      >
        {!loaded ? (
          <div className="mn-ord-skel"><TableSkeleton cols={5} /></div>
        ) : shown.length ? (
          <div className="mn-ord-list" role="list">
            <div className="mn-ord-cols mn-sl-cols" aria-hidden>
              <span>Tested</span>
              <span>Grade and load</span>
              <span>Slump</span>
              <span>Result</span>
              <span>Remarks</span>
            </div>
            {shown.map((r) => {
              const res = resultOf(r);
              const min = r.targetMinMm == null ? null : num(r.targetMinMm);
              const max = r.targetMaxMm == null ? null : num(r.targetMaxMm);
              return (
                <div key={String(r.id)} className="mn-ord-row mn-sl-row" data-tone={res === 'passed' ? 'success' : 'danger'} role="listitem">
                  <div className="mn-ord-id">
                    <span className="mn-ord-no">{formatDateTime(r.testedAt)}</span>
                    <span className="mn-ord-meta">{r.sampleRef ? `Sample ${String(r.sampleRef)}` : 'No sample ref'}</span>
                  </div>
                  <div className="mn-ord-who">
                    <span className="mn-ord-cust">{r.gradeLabel ? String(r.gradeLabel) : 'Grade not set'}{r.batchTicketNo ? <span className="mn-ord-meta"> · {String(r.batchTicketNo)}</span> : null}</span>
                    <span className="mn-ord-meta">{r.plantName ? String(r.plantName) : 'Plant not set'}</span>
                  </div>
                  <div className="mn-sl-val">
                    <span className={`mn-ord-amt${res === 'failed' ? ' mn-id-bad' : ''}`}>{num(r.measuredSlumpMm)} mm</span>
                    <SlumpBar value={num(r.measuredSlumpMm)} min={min} max={max} />
                    <span className="mn-ord-meta">{min !== null || max !== null ? `target ${min ?? '…'}–${max ?? '…'} mm` : 'no target set'}</span>
                  </div>
                  <div className="mn-ord-status mn-sl-status">
                    <StatusBadge status={res === 'passed' ? 'in_range' : 'out_of_range'} />
                    <span className="mn-ord-meta">{r.testedByName ? String(r.testedByName) : ''}</span>
                  </div>
                  <div className="mn-sl-remarks">
                    <span className="mn-ord-meta">{r.remarks ? String(r.remarks) : '—'}</span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState
            title={filter ? `No tests ${labelOf(filter)}` : 'No slump tests yet'}
            description={filter ? 'Press the chip again to see every test.' : canRecord ? 'Press Record a test after the next cone: the grade, the load and the drop in mm.' : 'Nothing to show.'}
            action={filter ? <Button variant="secondary" size="sm" onClick={() => setFilter('')}>Show all tests</Button> : canRecord ? <Button size="sm" icon={<Plus size={14} />} onClick={() => setShowForm(true)}>Record a test</Button> : undefined}
          />
        )}
        <ListCap shown={rows.length} limit={win.limit} canWiden={win.canWiden} onWiden={() => win.setLimit(win.widen())} noun="slump tests" hint="the QC register" />
      </Card>
    </div>
  );
}
