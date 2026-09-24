'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Boxes, CalendarClock, CheckCircle2, Factory, FileText, Hammer, Hourglass, RefreshCw, XCircle } from 'lucide-react';
import { formatDate } from '../../../../../lib/format-date';
import { todayLocal } from '../../../../../lib/report-range';
import { qcApi, type Row } from '../../../../../lib/api';
import { getAccess } from '../../../../../lib/session';
import { Card } from '../../../../../components/ui/Card';
import { StatCard } from '../../../../../components/ui/StatCard';
import { Button } from '../../../../../components/ui/Button';
import { Field, Input, Select } from '../../../../../components/ui/Field';
import { Badge, StatusBadge } from '../../../../../components/ui/Badge';
import { Loading, ErrorState, EmptyState } from '../../../../../components/ui/States';

/**
 * One cube set — the numbers behind an acceptance.
 *
 * The header names the set with its stage, grade, cast and 28-day dates,
 * plant, ticket and sampling reference. Five tiles carry the strength the
 * grade needs, what the mean must reach, what no cube may fall below, the
 * 28-day mean and the lowest cube. The main card lists every cube crushed,
 * grouped by age, each on a bar against the floor; the side card explains
 * the verdict in plain words and, while the set is open, the record form
 * takes the next age's strengths, one box per cube. Same layout in both
 * skins; every colour reads the semantic tokens.
 */

const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v)) || 0;
const one = (v: unknown) => num(v).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const margin = (fck: number) => (fck >= 20 ? 4 : 3);
const daysSince = (d: unknown) => (d ? Math.floor((Date.now() - new Date(`${String(d).slice(0, 10)}T00:00:00`).getTime()) / 86_400_000) : 0);
const dueOn = (cast: unknown) => { const x = new Date(`${String(cast).slice(0, 10)}T00:00:00`); x.setDate(x.getDate() + 28); return x; };

export default function CubeSetDetail() {
  const { id } = useParams<{ id: string }>();
  const [s, setS] = useState<Row | null>(null);
  const [age, setAge] = useState('28');
  const [testedOn, setTestedOn] = useState(todayLocal());
  const [vals, setVals] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canRecord = getAccess().has('qc.record');

  const load = useCallback(async () => {
    const set = await qcApi.cubeSet(id);
    setS(set);
    setVals(Array.from({ length: Math.max(1, Number(set.specimenCount ?? 3)) }, () => ''));
    // The list's Record button says which age is up; otherwise 7-day until the set is 28 days old.
    const asked = new URLSearchParams(window.location.search).get('record');
    setAge(asked === '7' || asked === '28' ? asked : daysSince(set.castDate) >= 28 ? '28' : '7');
  }, [id]);
  useEffect(() => {
    load().catch((e) => setError(String(e)));
  }, [load]);

  async function record() {
    setError(null);
    setMsg(null);
    const results = vals
      .map((v, i) => ({ testAgeDays: Number(age), specimenNo: i + 1, compressiveStrengthMpa: Number(v), testedOn: testedOn || undefined }))
      .filter((r) => r.compressiveStrengthMpa > 0);
    if (!results.length) { setError('Enter at least one cube strength.'); return; }
    setBusy(true);
    try {
      const after = await qcApi.recordResults(id, results);
      await load();
      const verdict = after.acceptanceStatus === 'accepted' ? ' The set is accepted.' : after.acceptanceStatus === 'rejected' ? ' The set is rejected: it fell short of the grade.' : age === '28' ? ' Record the remaining cubes to decide the set.' : '';
      setMsg(`${results.length} ${results.length === 1 ? 'cube' : 'cubes'} recorded at ${age} days.${verdict}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  if (!s) return error ? <ErrorState message={error} /> : <Loading label="Loading cube set…" />;
  const results = ((s.results as Row[]) ?? []);
  const fck = num(s.targetStrengthMpa);
  const mg = margin(fck);
  const need = fck + mg;
  const floor = fck - mg;
  const accepted = s.acceptanceStatus === 'accepted';
  const rejected = s.acceptanceStatus === 'rejected';
  const decided = accepted || rejected;
  const n = num(s.specimenCount);
  const r28 = results.filter((r) => num(r.testAgeDays) >= 28);
  const r7 = results.filter((r) => num(r.testAgeDays) < 28);
  const min28 = r28.length ? Math.min(...r28.map((r) => num(r.compressiveStrengthMpa))) : null;
  const mean28 = s.meanStrengthMpa != null ? num(s.meanStrengthMpa) : r28.length ? r28.reduce((t, r) => t + num(r.compressiveStrengthMpa), 0) / r28.length : null;
  const ageDays = daysSince(s.castDate);
  const stage = decided ? String(s.acceptanceStatus) : ageDays >= 28 ? 'due' : 'curing';
  const scale = Math.max(need * 1.4, ...results.map((r) => num(r.compressiveStrengthMpa) * 1.1));
  const pct = (v: number) => `${Math.max(2, Math.min(100, (v / scale) * 100))}%`;
  const recordedAtAge = results.filter((r) => (num(r.testAgeDays) >= 28 ? '28' : '7') === age).length;
  const left = Math.max(0, n - recordedAtAge);
  const groups: Array<{ label: string; rows: Row[]; final: boolean }> = [
    { label: '7-day', rows: r7, final: false },
    { label: '28-day', rows: r28, final: true },
  ].filter((g) => g.rows.length);

  return (
    <div className="mn-od mn-cbd">
      <header className="mn-board-head">
        <div className="mn-board-title mn-od-title">
          <Link href="/app/qc/cubes" className="mn-od-back"><ArrowLeft size={14} aria-hidden /> Cube sets</Link>
          <h1>
            {String(s.setNo)}
            <span className="mn-od-badges">
              <StatusBadge status={stage} />
              {!decided && r28.length > 0 && <Badge tone="info">{r28.length} of {n} at 28 days</Badge>}
            </span>
          </h1>
          <p className="mn-od-facts">
            <span className="mn-od-fact mn-od-fact--who">{String(s.gradeLabel ?? 'Grade not set')} · fck {one(fck)} N/mm²</span>
            <span className="mn-od-fact"><CalendarClock size={13} aria-hidden /> cast {formatDate(s.castDate)} · 28-day {formatDate(dueOn(s.castDate))}{stage === 'curing' ? ` (in ${28 - ageDays} ${28 - ageDays === 1 ? 'day' : 'days'})` : ''}</span>
            <span className="mn-od-fact"><Factory size={13} aria-hidden /> {s.plantName ? String(s.plantName) : 'Plant not set'}</span>
            <span className="mn-od-fact"><FileText size={13} aria-hidden /> {s.batchTicketNo ? `${String(s.batchTicketNo)}${s.batchQuantityM3 != null ? ` · ${one(s.batchQuantityM3)} m³` : ''}${s.customerName ? ` · ${String(s.customerName)}` : ''}` : 'No batch ticket'}</span>
            <span className="mn-od-fact"><Boxes size={13} aria-hidden /> {n} {n === 1 ? 'cube' : 'cubes'} of {num(s.cubeSizeMm)} mm{s.samplingRef ? ` · ${String(s.samplingRef)}` : ''}</span>
          </p>
        </div>
        <div className="mn-board-tools">
          <Button variant="ghost" size="sm" icon={<RefreshCw size={14} />} onClick={() => load().catch((e) => setError(String(e)))}>Refresh</Button>
        </div>
      </header>

      {error && <ErrorState message={error} />}
      {msg && <div className="mn-ord-note mn-ord-note--ok" role="status"><CheckCircle2 size={16} aria-hidden /><span>{msg}</span></div>}

      {accepted && (
        <div className="mn-ord-note mn-ord-note--ok" role="status">
          <CheckCircle2 size={16} aria-hidden />
          <span><strong>Accepted.</strong> The 28-day mean of {one(mean28)} N/mm² clears the {one(need)} the grade needs and the lowest cube, {one(min28)}, is above {one(floor)}. The concrete met {String(s.gradeLabel ?? 'its grade')}.</span>
        </div>
      )}
      {rejected && (
        <div className="mn-ord-note mn-ord-note--bad" role="status">
          <XCircle size={16} aria-hidden />
          <span><strong>Rejected.</strong> {mean28 !== null && mean28 < need ? `The 28-day mean of ${one(mean28)} N/mm² is under the ${one(need)} the grade needs. ` : ''}{min28 !== null && min28 < floor ? `The lowest cube, ${one(min28)}, is under the ${one(floor)} floor. ` : ''}The pour this came from needs a core test or a call with the customer; the verdict is a record and cannot be changed.</span>
        </div>
      )}
      {stage === 'due' && (
        <div className="mn-ord-note mn-ord-note--warn" role="status">
          <Hammer size={16} aria-hidden />
          <span><strong>Due for 28-day crushing.</strong> {ageDays === 28 ? 'The cubes are 28 days old today.' : `The cubes are ${ageDays} days old.`} Record all {n} strengths and the set is judged on the spot.</span>
        </div>
      )}
      {stage === 'curing' && (
        <div className="mn-ord-note" role="status">
          <Hourglass size={16} aria-hidden />
          <span><strong>Curing.</strong> {r7.length ? `The 7-day results are in (mean ${one(r7.reduce((t, r) => t + num(r.compressiveStrengthMpa), 0) / r7.length)}); they usually reach about two thirds of the 28-day strength.` : 'Crush one set at 7 days for an early warning.'} The 28-day cubes are due on {formatDate(dueOn(s.castDate))}.</span>
        </div>
      )}

      <div className="mn-od-kpis mn-qd-kpis">
        <StatCard label="Grade strength (fck)" value={`${one(fck)} N/mm²`} />
        <StatCard label="Mean must reach" value={one(need)} tone="info" />
        <StatCard label="No cube below" value={one(floor)} tone="info" />
        <StatCard label="28-day mean" value={mean28 !== null ? one(mean28) : '—'} tone={mean28 === null ? 'neutral' : mean28 >= need ? 'success' : 'danger'} />
        <StatCard label="Lowest 28-day cube" value={min28 !== null ? one(min28) : '—'} tone={min28 === null ? 'neutral' : min28 >= floor ? 'success' : 'danger'} />
      </div>

      <div className="mn-od-grid">
        <div className="mn-od-main">
          <Card title={<span className="mn-board-card-title"><Hammer size={16} aria-hidden /> Cubes crushed <span className="mn-board-card-count">{results.length}</span></span>} actions={<span className="mn-ord-how">Each bar is the cube's strength; the line is the floor no 28-day cube may fall below.</span>} padded={false}>
            {groups.length ? (
              <div className="mn-cbd-groups">
                {groups.map((g) => {
                  const mean = g.rows.reduce((t, r) => t + num(r.compressiveStrengthMpa), 0) / g.rows.length;
                  return (
                    <div key={g.label} className="mn-cbd-group">
                      <div className="mn-cbd-group-head">
                        <span className="mn-cbd-group-title">{g.label}</span>
                        <span className="mn-ord-meta">{g.rows.length} of {n} {g.rows.length === 1 ? 'cube' : 'cubes'} · mean {one(mean)} N/mm²{g.final ? ` · needs ${one(need)}` : ' · early warning only'}</span>
                      </div>
                      {g.rows.map((r) => {
                        const v = num(r.compressiveStrengthMpa);
                        const bad = g.final && v < floor;
                        return (
                          <div key={String(r.id)} className={`mn-cbd-cube${bad ? ' is-bad' : ''}`}>
                            <span className="mn-cbd-cube-no">Cube {num(r.specimenNo) || '?'}</span>
                            <span className="mn-cbd-cube-bar" aria-hidden>
                              {g.final && <span className="mn-cbd-cube-floor" style={{ left: pct(floor) }} />}
                              <span className="mn-cbd-cube-fill" style={{ width: pct(v) }} />
                            </span>
                            <span className="mn-cbd-cube-val mn-od-num">{one(v)} <span className="mn-ord-meta">N/mm²</span></span>
                            <span className="mn-cbd-cube-meta mn-ord-meta">{r.loadKn != null ? `${one(r.loadKn)} kN · ` : ''}{r.testedOn ? formatDate(r.testedOn) : 'date not set'}{g.final ? (bad ? ' · below the floor' : ' · above the floor') : ''}</span>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            ) : (
              <EmptyState title="No cubes crushed yet" description={stage === 'curing' ? `Crush the 7-day cubes for an early warning, then the 28-day cubes on ${formatDate(dueOn(s.castDate))}.` : 'Record the 28-day strengths below and the set is judged.'} />
            )}
          </Card>
        </div>
        <div className="mn-od-side">
          {canRecord && !decided && (
            <Card title={<span className="mn-board-card-title"><Hammer size={16} aria-hidden /> Record results</span>}>
              <div className="mn-cbd-form">
                <div className="mn-cbd-form-row">
                  <Field label="Test age">
                    <Select value={age} onChange={(e) => setAge(e.target.value)}>
                      <option value="7">7 days</option>
                      <option value="28">28 days</option>
                    </Select>
                  </Field>
                  <Field label="Crushed on">
                    <Input type="date" value={testedOn} max={todayLocal()} onChange={(e) => setTestedOn(e.target.value)} />
                  </Field>
                </div>
                <p className="mn-ord-how mn-cbd-hint">{left === 0 ? `All ${n} cubes are already recorded at ${age} days.` : recordedAtAge ? `${recordedAtAge} of ${n} recorded at ${age} days; ${left} to go.` : age === '28' ? `Enter all ${n} strengths and the set is judged against ${one(need)} mean, ${one(floor)} floor.` : `Enter the ${n} strengths; a 7-day result is a heads-up only.`}</p>
                <div className="mn-cbd-cubes">
                  {vals.map((v, i) => (
                    <Field key={i} label={`Cube ${i + 1} (N/mm²)`}>
                      <Input type="number" step="any" inputMode="decimal" min={0} value={v} onChange={(e) => setVals((p) => p.map((x, j) => (j === i ? e.target.value : x)))} />
                    </Field>
                  ))}
                </div>
                <Button onClick={record} loading={busy} icon={<Hammer size={14} />} disabled={left === 0}>Record the {age}-day results</Button>
              </div>
            </Card>
          )}
          <Card title={<span className="mn-board-card-title"><CheckCircle2 size={16} aria-hidden /> How the set is judged</span>}>
            <dl className="mn-od-money mn-od-money--tight">
              <div><dt>Grade</dt><dd>{String(s.gradeLabel ?? '—')} · fck {one(fck)}</dd></div>
              <div><dt>Margin (IS 456 Table 11)</dt><dd>{mg} N/mm² {fck >= 20 ? '(M20 and up)' : '(below M20)'}</dd></div>
              <div><dt>28-day mean must reach</dt><dd>{one(need)} N/mm²</dd></div>
              <div><dt>No single cube below</dt><dd>{one(floor)} N/mm²</dd></div>
              <div><dt>Judged on</dt><dd>{n} cubes at 28 days</dd></div>
            </dl>
            <p className="mn-od-how mn-od-how--foot">The verdict is taken once every 28-day cube is in, and it is final. Seven-day results are kept for the record but do not decide the set.</p>
          </Card>
          {s.remarks ? (
            <Card title={<span className="mn-board-card-title"><FileText size={16} aria-hidden /> Remarks</span>}>
              <p className="mn-od-notes">{String(s.remarks)}</p>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
