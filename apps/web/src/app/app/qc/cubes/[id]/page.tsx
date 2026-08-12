'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { qcApi, type Row } from '../../../../../lib/api';
import { getAccess } from '../../../../../lib/session';
import { Card } from '../../../../../components/ui/Card';
import { Table, Th, Td } from '../../../../../components/ui/Table';
import { Button } from '../../../../../components/ui/Button';
import { Field, Input } from '../../../../../components/ui/Field';
import { Badge, StatusBadge } from '../../../../../components/ui/Badge';
import { Loading, ErrorState } from '../../../../../components/ui/States';

export default function CubeSetDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [s, setS] = useState<Row | null>(null);
  const [age, setAge] = useState('28');
  const [vals, setVals] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const canRecord = getAccess().has('qc.record');

  const load = useCallback(async () => {
    const set = await qcApi.cubeSet(id);
    setS(set);
    setVals(Array.from({ length: Math.max(1, Number(set.specimenCount ?? 3)) }, () => ''));
  }, [id]);
  useEffect(() => {
    load().catch((e) => setError(String(e)));
  }, [load]);

  async function record() {
    setError(null);
    setMsg(null);
    const results = vals
      .map((v, i) => ({ testAgeDays: Number(age), specimenNo: i + 1, compressiveStrengthMpa: Number(v) }))
      .filter((r) => r.compressiveStrengthMpa > 0);
    if (!results.length) {
      setError('Enter at least one cube strength.');
      return;
    }
    try {
      await qcApi.recordResults(id, results);
      await load();
      setMsg(`Recorded ${results.length} result(s) at ${age} days.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
  }

  if (!s) return <Loading label="Loading cube set…" />;
  const results = (s.results as Row[]) ?? [];
  const accepted = s.acceptanceStatus === 'accepted';
  const rejected = s.acceptanceStatus === 'rejected';

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div>
        <Button variant="ghost" size="sm" icon={<ArrowLeft size={16} />} onClick={() => router.push('/app/qc/cubes')}>
          Cube Sets
        </Button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 24, margin: 0 }}>{String(s.setNo)}</h1>
        <StatusBadge status={String(s.acceptanceStatus ?? s.status)} />
        <span style={{ fontSize: 13, color: 'var(--mn-muted)' }}>
          {String(s.gradeLabel ?? '')} · fck {String(s.targetStrengthMpa)} N/mm² · cast {String(s.castDate ?? '').slice(0, 10)}
        </span>
      </div>
      {error && <ErrorState message={error} />}
      {msg && (
        <div style={{ color: 'var(--mn-success)', background: 'var(--mn-success-tint)', border: '1px solid var(--mn-success)', borderRadius: 'var(--mn-radius-md)', padding: '10px 12px', fontSize: 13 }}>
          {msg}
        </div>
      )}

      {(accepted || rejected) && (
        <Card title="IS 456 acceptance">
          <p style={{ margin: 0, fontSize: 14 }}>
            28-day mean <strong>{String(s.meanStrengthMpa)}</strong> N/mm² against fck {String(s.targetStrengthMpa)} —{' '}
            {accepted ? <Badge tone="success">accepted</Badge> : <Badge tone="warning">rejected</Badge>}
          </p>
        </Card>
      )}

      <Card title="Cube results" padded={false}>
        {results.length ? (
          <Table>
            <thead>
              <tr>
                <Th numeric>Age (days)</Th>
                <Th numeric>Specimen</Th>
                <Th numeric>Strength (N/mm²)</Th>
                <Th numeric>Load (kN)</Th>
                <Th>Result</Th>
                <Th>Tested on</Th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => (
                <tr key={r.id}>
                  <Td numeric>{String(r.testAgeDays)}</Td>
                  <Td numeric>{String(r.specimenNo)}</Td>
                  <Td numeric>{String(r.compressiveStrengthMpa)}</Td>
                  <Td numeric>{r.loadKn == null ? '—' : String(r.loadKn)}</Td>
                  <Td>{r.passed == null ? '—' : r.passed ? <Badge tone="success">pass</Badge> : <Badge tone="warning">low</Badge>}</Td>
                  <Td>{r.testedOn == null ? '—' : String(r.testedOn).slice(0, 10)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <p style={{ margin: 16, color: 'var(--mn-muted)', fontSize: 13 }}>No results recorded yet.</p>
        )}
      </Card>

      {canRecord && (
        <Card title="Record results">
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end' }}>
            <div style={{ minWidth: 120 }}>
              <Field label="Test age (days)">
                <select
                  value={age}
                  onChange={(e) => setAge(e.target.value)}
                  style={{ width: '100%', padding: '9px 11px', borderRadius: 8, border: '1px solid var(--mn-border, #d9d9e3)', background: 'var(--mn-surface, #fff)', color: 'inherit' }}
                >
                  <option value="7">7</option>
                  <option value="28">28</option>
                </select>
              </Field>
            </div>
            {vals.map((v, i) => (
              <div key={i} style={{ minWidth: 130 }}>
                <Field label={`Cube ${i + 1} (N/mm²)`}>
                  <Input
                    type="number"
                    step="any"
                    value={v}
                    onChange={(e) => setVals((p) => p.map((x, j) => (j === i ? e.target.value : x)))}
                  />
                </Field>
              </div>
            ))}
            <div style={{ marginBottom: 14 }}>
              <Button onClick={record}>Record {age}-day results</Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
