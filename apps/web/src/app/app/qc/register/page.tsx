'use client';

import { useEffect, useState } from 'react';
import { formatDate } from '../../../../lib/format-date';
import { currentMonthRange, settledFailure, settledValue } from '../../../../lib/report-range';
import { qcApi, type Row } from '../../../../lib/api';
import { Card } from '../../../../components/ui/Card';
import { Table, Th, Td } from '../../../../components/ui/Table';
import { StatCard } from '../../../../components/ui/StatCard';
import { StatusBadge } from '../../../../components/ui/Badge';
import { Button } from '../../../../components/ui/Button';
import { Field, Input } from '../../../../components/ui/Field';
import { ExportButton } from '../../../../components/ExportButton';
import { ErrorState, EmptyState, TableSkeleton } from '../../../../components/ui/States';

const n = (v: unknown) => Number(v ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });

export default function QcRegisterPage() {
  const [cube, setCube] = useState<{ rows: Row[]; count: number; accepted: number; rejected: number } | null>(null);
  const [slump, setSlump] = useState<{ rows: Row[]; count: number; passed: number; failed: number } | null>(null);
  const [sampling, setSampling] = useState<Awaited<ReturnType<typeof qcApi.samplingReport>> | null>(null);
  // Opens on the current month: both registers are capped at 5,000 rows.
  const [range, setRange] = useState(currentMonthRange());
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  async function load(from = range.from, to = range.to) {
    setError(null);
    // allSettled: a cube register too wide for its cap must not also hide the
    // slump results, which are a separate report entirely.
    const out = await Promise.allSettled([
      qcApi.cubeRegister(from || undefined, to || undefined),
      qcApi.slumpRegister(from || undefined, to || undefined),
      qcApi.samplingReport(from || undefined, to || undefined),
    ]);
    setCube(settledValue(out[0]));
    setSlump(settledValue(out[1]));
    setSampling(settledValue(out[2]));
    const why = settledFailure(out);
    if (why) setError(why);
  }

  useEffect(() => {
    load().catch((e) => setError(String(e))).finally(() => setLoaded(true));
  }, []);

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div>
        <h1 style={{ fontSize: 24, margin: '0 0 4px' }}>QC Register</h1>
        <p style={{ color: 'var(--mn-muted)', fontSize: 13, margin: 0 }}>Cube-set acceptance (target vs 28-day mean strength) and slump test results.</p>
      </div>
      {error && <ErrorState message={error} />}

      <Card title="Period">
        <div style={{ display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 150 }}><Field label="From"><Input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></Field></div>
          <div style={{ minWidth: 150 }}><Field label="To"><Input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></Field></div>
          <Button variant="secondary" onClick={() => load().catch((e) => setError(String(e)))}>Apply</Button>
          {(range.from || range.to) && <Button variant="ghost" onClick={() => { setRange({ from: '', to: '' }); load('', '').catch((e) => setError(String(e))); }}>Clear</Button>}
          <span style={{ color: 'var(--mn-muted)', fontSize: 12 }}>Cube sets bound by cast date, slump tests by test date.</span>
        </div>
      </Card>

      {cube && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12 }}>
          <StatCard label="Cube sets" value={String(cube.count)} />
          <StatCard label="Accepted" value={String(cube.accepted)} tone="success" />
          <StatCard label="Rejected" value={String(cube.rejected)} tone={cube.rejected > 0 ? 'danger' : 'neutral'} />
        </div>
      )}

      <Card
        title="Cube-set register"
        padded={false}
        actions={<ExportButton rows={cube?.rows ?? []} columns={['setNo', 'castDate', 'gradeLabel', 'targetStrengthMpa', 'meanStrengthMpa', 'acceptanceStatus']} filename="qc-cube-register" />}
      >
        {!loaded ? (
          <TableSkeleton cols={6} />
        ) : cube?.rows?.length ? (
          <Table>
            <thead>
              <tr>
                <Th>Set</Th>
                <Th>Cast date</Th>
                <Th>Grade</Th>
                <Th numeric>Target MPa</Th>
                <Th numeric>28-day mean</Th>
                <Th>Acceptance</Th>
              </tr>
            </thead>
            <tbody>
              {cube.rows.map((r, i) => (
                <tr key={i}>
                  <Td style={{ fontWeight: 600 }}>{String(r.setNo)}</Td>
                  <Td>{formatDate(r.castDate)}</Td>
                  <Td>{String(r.gradeLabel ?? '')}</Td>
                  <Td numeric>{n(r.targetStrengthMpa)}</Td>
                  <Td numeric>{r.meanStrengthMpa != null ? n(r.meanStrengthMpa) : <span style={{ color: 'var(--mn-muted)' }}>pending</span>}</Td>
                  <Td>{r.acceptanceStatus ? <StatusBadge status={String(r.acceptanceStatus)} /> : <span style={{ color: 'var(--mn-muted)', fontSize: 12 }}>open</span>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="No cube sets" description="Cube sets cast in the period will appear here." />
        )}
      </Card>

      {slump && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12 }}>
          <StatCard label="Slump tests" value={String(slump.count)} />
          <StatCard label="Passed" value={String(slump.passed)} tone="success" />
          <StatCard label="Failed" value={String(slump.failed)} tone={slump.failed > 0 ? 'danger' : 'neutral'} />
        </div>
      )}

      <Card
        title="Slump register"
        padded={false}
        actions={<ExportButton rows={slump?.rows ?? []} columns={['testedAt', 'gradeLabel', 'measuredSlumpMm', 'targetMinMm', 'targetMaxMm', 'passed']} filename="qc-slump-register" />}
      >
        {!loaded ? (
          <TableSkeleton cols={5} />
        ) : slump?.rows?.length ? (
          <Table>
            <thead>
              <tr>
                <Th>Tested</Th>
                <Th>Grade</Th>
                <Th numeric>Slump mm</Th>
                <Th numeric>Target range</Th>
                <Th>Result</Th>
              </tr>
            </thead>
            <tbody>
              {slump.rows.map((r, i) => (
                <tr key={i}>
                  <Td>{String(r.testedAt ?? '').slice(0, 10)}</Td>
                  <Td>{String(r.gradeLabel ?? '')}</Td>
                  <Td numeric>{n(r.measuredSlumpMm)}</Td>
                  <Td numeric>{r.targetMinMm != null || r.targetMaxMm != null ? `${n(r.targetMinMm)}–${n(r.targetMaxMm)}` : '—'}</Td>
                  <Td>{r.passed ? <StatusBadge status="passed" /> : <StatusBadge status="failed" />}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="No slump tests" description="Slump tests recorded in the period will appear here." />
        )}
      </Card>

      <Card
        title="Sampling frequency (IS 456 Table 10)"
        actions={
          <ExportButton
            rows={sampling?.rows ?? []}
            columns={['day', 'plantLabel', 'gradeLabel', 'producedM3', 'samplesRequired', 'samplesCast', 'shortfall']}
            filename="qc-sampling"
          />
        }
      >
        <p style={{ color: 'var(--mn-muted)', fontSize: 12.5, margin: '0 0 12px' }}>
          For each day and grade: the concrete batched, the cube sets IS 456 requires for that quantity, and
          the sets actually cast. A cube test cannot certify concrete it was not taken from, so a shortfall
          here is what an inspector will ask about first.
        </p>
        {sampling && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12, marginBottom: 14 }}>
            <StatCard label="Produced m³" value={n(sampling.totalProducedM3)} />
            <StatCard label="Samples required" value={String(sampling.totalRequired)} />
            <StatCard label="Samples cast" value={String(sampling.totalCast)} />
            <StatCard
              label="Under-sampled days"
              value={String(sampling.underSampled)}
              tone={sampling.underSampled > 0 ? 'danger' : 'success'}
            />
          </div>
        )}
        {!loaded ? (
          <TableSkeleton cols={7} />
        ) : sampling && sampling.rows.length ? (
          <Table>
            <thead>
              <tr>
                <Th>Day</Th>
                <Th>Plant</Th>
                <Th>Grade</Th>
                <Th numeric>Produced m³</Th>
                <Th numeric>Required</Th>
                <Th numeric>Cast</Th>
                <Th>Result</Th>
              </tr>
            </thead>
            <tbody>
              {sampling.rows.map((r, i) => (
                <tr key={i}>
                  <Td>{formatDate(r.day)}</Td>
                  <Td>{String(r.plantLabel ?? '—')}</Td>
                  <Td>{String(r.gradeLabel ?? '—')}</Td>
                  <Td numeric>{n(r.producedM3)}</Td>
                  <Td numeric>{String(r.samplesRequired)}</Td>
                  <Td numeric>{String(r.samplesCast)}</Td>
                  <Td>
                    {r.compliant ? (
                      <StatusBadge status="compliant" />
                    ) : (
                      <span style={{ color: 'var(--mn-danger)', fontWeight: 600 }}>{String(r.shortfall)} short</span>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="No production in the period" description="Confirmed batch tickets in the period are judged here against the cube sets cast." />
        )}
      </Card>
    </div>
  );
}
