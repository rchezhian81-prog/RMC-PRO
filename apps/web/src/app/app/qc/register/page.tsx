'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Beaker, Boxes, CalendarRange, ClipboardList, RefreshCw, XCircle } from 'lucide-react';
import { formatDate, formatDateTime } from '../../../../lib/format-date';
import { currentMonthRange, financialYearRange, settledFailure, settledReason, settledValue, todayLocal } from '../../../../lib/report-range';
import { qcApi, type Row } from '../../../../lib/api';
import { Card } from '../../../../components/ui/Card';
import { Table, Th, Td } from '../../../../components/ui/Table';
import { StatCard } from '../../../../components/ui/StatCard';
import { StatusBadge } from '../../../../components/ui/Badge';
import { Button } from '../../../../components/ui/Button';
import { Input } from '../../../../components/ui/Field';
import { ExportButton } from '../../../../components/ExportButton';
import { ErrorState, EmptyState, TableSkeleton } from '../../../../components/ui/States';

/**
 * QC register — what an inspector asks for, in one place.
 *
 * A period bar (this month, last month, this financial year, all time, or
 * any two dates) sets the window for all three reports. Six tiles carry the
 * cube sets with accepted and rejected, the slump tests with those out of
 * range, and the days under-sampled. Notes name the rejected sets and the
 * days short of samples. Then the cube-set register, the slump register and
 * the IS 456 sampling check (produced, samples required, samples cast, per
 * plant, day and grade), each exportable. Same layout in both skins; every
 * colour reads the semantic tokens.
 */

const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v)) || 0;
const one = (v: unknown) => num(v).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const m3 = (v: unknown) => num(v).toLocaleString('en-IN', { maximumFractionDigits: 3 });

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

type CubeReg = { rows: Row[]; count: number; accepted: number; rejected: number };
type SlumpReg = { rows: Row[]; count: number; passed: number; failed: number };
type Sampling = Awaited<ReturnType<typeof qcApi.samplingReport>>;

export default function QcRegisterPage() {
  const [cube, setCube] = useState<CubeReg | null>(null);
  const [slump, setSlump] = useState<SlumpReg | null>(null);
  const [sampling, setSampling] = useState<Sampling | null>(null);
  // Per report: why it failed to load, or null. Keeps a refused fetch from
  // rendering as "No X" — a lie about data that exists and could not be read.
  const [failed, setFailed] = useState<(string | null)[]>([]);
  // Opens on the current month: both registers are capped at 5,000 rows.
  const [range, setRange] = useState(currentMonthRange());
  const [draft, setDraft] = useState(currentMonthRange());
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (r: Range) => {
    setBusy(true);
    setError(null);
    try {
      // allSettled: a cube register too wide for its cap must not also hide the
      // slump results, which are a separate report entirely.
      const out = await Promise.allSettled([
        qcApi.cubeRegister(r.from || undefined, r.to || undefined),
        qcApi.slumpRegister(r.from || undefined, r.to || undefined),
        qcApi.samplingReport(r.from || undefined, r.to || undefined),
      ]);
      setCube(settledValue(out[0]));
      setSlump(settledValue(out[1]));
      setSampling(settledValue(out[2]));
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
  const rejectedSets = (cube?.rows ?? []).filter((r) => r.acceptanceStatus === 'rejected');
  const shortDays = (sampling?.rows ?? []).filter((r) => !r.compliant);

  return (
    <div className="mn-ord mn-qr">
      <header className="mn-board-head">
        <div className="mn-board-title">
          <h1>QC register</h1>
          <p>The quality record for a period: every cube set with its 28-day verdict, every slump test with its result, and whether each day's pour had the cube samples IS 456 asks for. This is what an inspector or a customer's engineer will ask to see.</p>
        </div>
        <div className="mn-board-tools">
          <span className="mn-board-live mn-ord-sum" aria-live="polite">
            <ClipboardList size={14} aria-hidden />
            {loaded ? periodLabel : 'Loading…'}
          </span>
          <Link href="/app/qc/cubes" className="mn-ord-link">
            <Button variant="ghost" size="sm" icon={<Boxes size={14} />}>Cube sets</Button>
          </Link>
          <Link href="/app/qc/slump" className="mn-ord-link">
            <Button variant="ghost" size="sm" icon={<Beaker size={14} />}>Slump tests</Button>
          </Link>
          <Button variant="ghost" size="sm" icon={<RefreshCw size={14} />} onClick={() => apply(range)} loading={busy}>
            Refresh
          </Button>
        </div>
      </header>

      <div className="mn-dr-period" role="group" aria-label="Period for the register">
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

      {loaded && (rejectedSets.length > 0 || shortDays.length > 0) && (
        <div className="mn-ord-notes">
          {rejectedSets.length > 0 && (
            <div className="mn-ord-note mn-ord-note--bad" role="status">
              <XCircle size={16} aria-hidden />
              <span><strong>{rejectedSets.length} cube {rejectedSets.length === 1 ? 'set' : 'sets'} fell short of the grade:</strong> {rejectedSets.slice(0, 6).map((r) => `${String(r.setNo)} (${String(r.gradeLabel ?? '')} · mean ${one(r.meanStrengthMpa)})`).join(', ')}{rejectedSets.length > 6 ? ' and more' : ''}. Each needs a core test or a call with the customer.</span>
            </div>
          )}
          {shortDays.length > 0 && (
            <div className="mn-ord-note mn-ord-note--warn" role="status">
              <AlertTriangle size={16} aria-hidden />
              <span><strong>{shortDays.length} {shortDays.length === 1 ? 'day was' : 'days were'} under-sampled</strong> by {sampling?.totalShortfall ?? 0} {num(sampling?.totalShortfall) === 1 ? 'set' : 'sets'} in all. A cube test cannot certify concrete it was not taken from; this is what an inspector asks about first.</span>
            </div>
          )}
        </div>
      )}

      <div className="mn-od-kpis mn-qr-kpis">
        <StatCard label="Cube sets cast" value={cube ? cube.count : '—'} />
        <StatCard label="Accepted" value={cube ? cube.accepted : '—'} tone={cube?.accepted ? 'success' : 'neutral'} />
        <StatCard label="Rejected" value={cube ? cube.rejected : '—'} tone={cube?.rejected ? 'danger' : 'neutral'} />
        <StatCard label="Slump tests" value={slump ? slump.count : '—'} />
        <StatCard label="Out of range" value={slump ? slump.failed : '—'} tone={slump?.failed ? 'danger' : 'neutral'} />
        <StatCard label="Days under-sampled" value={sampling ? sampling.underSampled : '—'} tone={sampling?.underSampled ? 'warning' : 'success'} />
      </div>

      <Card
        title={<span className="mn-board-card-title"><Boxes size={16} aria-hidden /> Cube-set register <span className="mn-board-card-count">{cube?.count ?? 0}</span></span>}
        actions={<><span className="mn-ord-how">By cast date · {periodLabel}</span><ExportButton rows={cube?.rows ?? []} columns={['setNo', 'castDate', 'gradeLabel', 'targetStrengthMpa', 'meanStrengthMpa', 'acceptanceStatus']} filename="qc-cube-register" /></>}
        padded={false}
      >
        {!loaded ? (
          <TableSkeleton cols={6} />
        ) : cube?.rows?.length ? (
          <div className="mn-id-scroll">
            <Table>
              <thead>
                <tr>
                  <Th>Set</Th>
                  <Th>Cast</Th>
                  <Th>Grade</Th>
                  <Th numeric>fck</Th>
                  <Th numeric>28-day mean</Th>
                  <Th>Verdict</Th>
                </tr>
              </thead>
              <tbody>
                {cube.rows.map((r) => {
                  const f = num(r.targetStrengthMpa);
                  const need = f + (f >= 20 ? 4 : 3);
                  return (
                    <tr key={String(r.id)}>
                      <Td><Link href={`/app/qc/cubes/${String(r.id)}`} className="mn-id-link mn-od-num">{String(r.setNo)}</Link></Td>
                      <Td>{formatDate(r.castDate)}</Td>
                      <Td>{String(r.gradeLabel ?? '—')}</Td>
                      <Td numeric>{one(f)}</Td>
                      <Td numeric>{r.meanStrengthMpa != null ? <span className={r.acceptanceStatus === 'rejected' ? 'mn-id-bad' : ''}>{one(r.meanStrengthMpa)}</span> : <span className="mn-ord-meta">pending</span>}<span className="mn-ord-meta"> / {one(need)}</span></Td>
                      <Td>{r.acceptanceStatus ? <StatusBadge status={String(r.acceptanceStatus)} /> : <StatusBadge status={String(r.status ?? 'open')} />}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </div>
        ) : (
          failed[0] ? <ErrorState message={String(failed[0])} /> : (
            <EmptyState title="No cube sets in this period" description={`Nothing was cast between ${periodLabel === 'all time' ? 'the start and today' : periodLabel}.`} action={activePreset !== 'all' ? <Button variant="secondary" size="sm" onClick={() => apply({ from: '', to: '' })}>Show all time</Button> : undefined} />
          )
        )}
      </Card>

      <Card
        title={<span className="mn-board-card-title"><Beaker size={16} aria-hidden /> Slump register <span className="mn-board-card-count">{slump?.count ?? 0}</span></span>}
        actions={<><span className="mn-ord-how">By test date · {periodLabel}</span><ExportButton rows={slump?.rows ?? []} columns={['testedAt', 'gradeLabel', 'measuredSlumpMm', 'targetMinMm', 'targetMaxMm', 'passed']} filename="qc-slump-register" /></>}
        padded={false}
      >
        {!loaded ? (
          <TableSkeleton cols={5} />
        ) : slump?.rows?.length ? (
          <div className="mn-id-scroll">
            <Table>
              <thead>
                <tr>
                  <Th>Tested</Th>
                  <Th>Grade</Th>
                  <Th numeric>Slump (mm)</Th>
                  <Th numeric>Target (mm)</Th>
                  <Th>Result</Th>
                  <Th>Sample</Th>
                </tr>
              </thead>
              <tbody>
                {slump.rows.map((r) => (
                  <tr key={String(r.id)}>
                    <Td>{formatDateTime(r.testedAt)}</Td>
                    <Td>{String(r.gradeLabel ?? '—')}</Td>
                    <Td numeric><span className={r.passed ? '' : 'mn-id-bad'}>{one(r.measuredSlumpMm)}</span></Td>
                    <Td numeric>{r.targetMinMm != null || r.targetMaxMm != null ? `${r.targetMinMm ?? '…'}–${r.targetMaxMm ?? '…'}` : <span className="mn-ord-meta">none</span>}</Td>
                    <Td><StatusBadge status={r.passed ? 'in_range' : 'out_of_range'} /></Td>
                    <Td>{r.sampleRef ? String(r.sampleRef) : <span className="mn-ord-meta">—</span>}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        ) : (
          failed[1] ? <ErrorState message={String(failed[1])} /> : (
            <EmptyState title="No slump tests in this period" description={`Nothing was tested between ${periodLabel === 'all time' ? 'the start and today' : periodLabel}.`} action={activePreset !== 'all' ? <Button variant="secondary" size="sm" onClick={() => apply({ from: '', to: '' })}>Show all time</Button> : undefined} />
          )
        )}
      </Card>

      <Card
        title={<span className="mn-board-card-title"><ClipboardList size={16} aria-hidden /> Sampling check (IS 456 Table 10) <span className="mn-board-card-count">{sampling?.rows.length ?? 0}</span></span>}
        actions={<><span className="mn-ord-how">Per plant, day and grade · {periodLabel}</span><ExportButton rows={sampling?.rows ?? []} columns={['day', 'plantLabel', 'gradeLabel', 'producedM3', 'samplesRequired', 'samplesCast', 'shortfall']} filename="qc-sampling" /></>}
        padded={false}
      >
        {sampling && (
          <div className="mn-qr-sum">
            <span><strong>{m3(sampling.totalProducedM3)} m³</strong> batched</span>
            <span><strong>{sampling.totalRequired}</strong> {sampling.totalRequired === 1 ? 'set' : 'sets'} required</span>
            <span><strong>{sampling.totalCast}</strong> cast</span>
            <span className={sampling.totalShortfall ? 'mn-id-bad' : ''}><strong>{sampling.totalShortfall}</strong> short</span>
          </div>
        )}
        {!loaded ? (
          <TableSkeleton cols={7} />
        ) : sampling && sampling.rows.length ? (
          <div className="mn-id-scroll">
            <Table>
              <thead>
                <tr>
                  <Th>Day</Th>
                  <Th>Plant</Th>
                  <Th>Grade</Th>
                  <Th numeric>Batched m³</Th>
                  <Th numeric>Sets required</Th>
                  <Th numeric>Sets cast</Th>
                  <Th>Result</Th>
                </tr>
              </thead>
              <tbody>
                {sampling.rows.map((r, i) => (
                  <tr key={i}>
                    <Td>{formatDate(r.day)}</Td>
                    <Td>{String(r.plantLabel ?? '—')}</Td>
                    <Td>{String(r.gradeLabel ?? '—')}</Td>
                    <Td numeric>{m3(r.producedM3)}</Td>
                    <Td numeric>{String(r.samplesRequired)}</Td>
                    <Td numeric><span className={r.compliant ? '' : 'mn-id-bad'}>{String(r.samplesCast)}</span></Td>
                    <Td>{r.compliant ? <StatusBadge status="compliant" /> : <span className="mn-qr-short"><StatusBadge status="under_sampled" /><span className="mn-ord-meta">{String(r.shortfall)} {num(r.shortfall) === 1 ? 'set' : 'sets'} short</span></span>}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        ) : (
          failed[2] ? <ErrorState message={String(failed[2])} /> : (
            <EmptyState title="No production in this period" description="Confirmed batch tickets in the period are judged here against the cube sets cast on the same day for the same grade." action={activePreset !== 'all' ? <Button variant="secondary" size="sm" onClick={() => apply({ from: '', to: '' })}>Show all time</Button> : undefined} />
          )
        )}
        <p className="mn-ord-how mn-ord-how--foot mn-qr-foot">IS 456 Table 10: one sample for the first 5 m³, then one each for 6–15, 16–30 and 31–50 m³, and one more for every 50 m³ after that. Each sample is a set of three cubes.</p>
      </Card>
    </div>
  );
}
