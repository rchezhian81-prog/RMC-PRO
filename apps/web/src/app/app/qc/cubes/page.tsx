'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { qcApi, type Row } from '../../../../lib/api';
import { getAccess } from '../../../../lib/session';
import { Card } from '../../../../components/ui/Card';
import { Table, Th, Td } from '../../../../components/ui/Table';
import { Button } from '../../../../components/ui/Button';
import { Form } from '../../../../components/ui/Form';
import { Field, Input } from '../../../../components/ui/Field';
import { StatusBadge } from '../../../../components/ui/Badge';
import { ErrorState, EmptyState } from '../../../../components/ui/States';

const F = ['gradeLabel', 'targetStrengthMpa', 'castDate', 'specimenCount', 'samplingRef'] as const;
const LABELS: Record<string, string> = {
  gradeLabel: 'Grade',
  targetStrengthMpa: 'Target fck (N/mm²)',
  castDate: 'Cast date',
  specimenCount: 'Specimens',
  samplingRef: 'Sampling ref',
};
const TYPE: Record<string, string> = { targetStrengthMpa: 'number', castDate: 'date', specimenCount: 'number' };

export default function CubeSets() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [form, setForm] = useState<Record<string, string>>({ specimenCount: '3' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canRecord = getAccess().has('qc.record');

  async function reload() {
    setRows(await qcApi.cubeSets());
  }
  useEffect(() => {
    reload().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const body: Record<string, unknown> = {};
    for (const k of F) {
      const v = form[k];
      if (v !== undefined && v !== '') body[k] = TYPE[k] === 'number' ? Number(v) : v;
    }
    setBusy(true);
    try {
      const created = await qcApi.cubeSetCreate(body);
      router.push(`/app/qc/cubes/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1 style={{ fontSize: 24, marginTop: 0, marginBottom: 16 }}>Cube Sets</h1>
      {error && <div style={{ marginBottom: 12 }}><ErrorState message={error} /></div>}

      {canRecord && (
        <div style={{ marginBottom: 18 }}>
          <Card title="Cast a cube set">
            <Form onSubmit={submit} style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end' }}>
              {F.map((k) => (
                <div key={k} style={{ minWidth: 150 }}>
                  <Field label={LABELS[k] ?? k} required={k === 'castDate' || k === 'targetStrengthMpa'}>
                    <Input
                      type={TYPE[k] ?? 'text'}
                      value={form[k] ?? ''}
                      onChange={(e) => setForm((p) => ({ ...p, [k]: e.target.value }))}
                      required={k === 'castDate' || k === 'targetStrengthMpa'}
                    />
                  </Field>
                </div>
              ))}
              <div style={{ marginBottom: 14 }}>
                <Button type="submit" loading={busy}>Create set</Button>
              </div>
            </Form>
          </Card>
        </div>
      )}

      <Card title="Cube sets" padded={false}>
        {rows.length ? (
          <Table>
            <thead>
              <tr>
                <Th>Set</Th>
                <Th>Grade</Th>
                <Th numeric>fck</Th>
                <Th>Cast date</Th>
                <Th numeric>28-day mean</Th>
                <Th>Status</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <Td>{String(r.setNo)}</Td>
                  <Td>{String(r.gradeLabel ?? '—')}</Td>
                  <Td numeric>{String(r.targetStrengthMpa)}</Td>
                  <Td>{String(r.castDate ?? '').slice(0, 10)}</Td>
                  <Td numeric>{r.meanStrengthMpa == null ? '—' : String(r.meanStrengthMpa)}</Td>
                  <Td><StatusBadge status={String(r.acceptanceStatus ?? r.status)} /></Td>
                  <Td>
                    <Button variant="ghost" size="sm" onClick={() => router.push(`/app/qc/cubes/${r.id}`)}>Open</Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="No cube sets yet" description={canRecord ? 'Cast your first set above.' : 'Nothing to show.'} />
        )}
      </Card>
    </div>
  );
}
