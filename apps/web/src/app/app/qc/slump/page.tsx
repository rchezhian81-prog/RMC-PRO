'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { qcApi, type Row } from '../../../../lib/api';
import { getAccess } from '../../../../lib/session';
import { Card } from '../../../../components/ui/Card';
import { Table, Th, Td } from '../../../../components/ui/Table';
import { Button } from '../../../../components/ui/Button';
import { Form } from '../../../../components/ui/Form';
import { Field, Input } from '../../../../components/ui/Field';
import { Badge } from '../../../../components/ui/Badge';
import { ErrorState, EmptyState } from '../../../../components/ui/States';

const F = ['gradeLabel', 'measuredSlumpMm', 'targetMinMm', 'targetMaxMm', 'sampleRef', 'remarks'] as const;
const LABELS: Record<string, string> = {
  gradeLabel: 'Grade',
  measuredSlumpMm: 'Measured slump (mm)',
  targetMinMm: 'Target min (mm)',
  targetMaxMm: 'Target max (mm)',
  sampleRef: 'Sample ref',
  remarks: 'Remarks',
};
const NUMERIC = new Set(['measuredSlumpMm', 'targetMinMm', 'targetMaxMm']);

export default function SlumpTests() {
  const [rows, setRows] = useState<Row[]>([]);
  const [form, setForm] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canRecord = getAccess().has('qc.record');

  async function reload() {
    setRows(await qcApi.slumpList());
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
      if (v !== undefined && v !== '') body[k] = NUMERIC.has(k) ? Number(v) : v;
    }
    setBusy(true);
    try {
      await qcApi.slumpCreate(body);
      setForm({});
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1 style={{ fontSize: 24, marginTop: 0, marginBottom: 16 }}>Slump Tests</h1>
      {error && <div style={{ marginBottom: 12 }}><ErrorState message={error} /></div>}

      {canRecord && (
        <div style={{ marginBottom: 18 }}>
          <Card title="Record a slump test">
            <Form onSubmit={submit} style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end' }}>
              {F.map((k) => (
                <div key={k} style={{ minWidth: 140 }}>
                  <Field label={LABELS[k] ?? k} required={k === 'measuredSlumpMm'}>
                    <Input
                      type={NUMERIC.has(k) ? 'number' : 'text'}
                      value={form[k] ?? ''}
                      onChange={(e) => setForm((p) => ({ ...p, [k]: e.target.value }))}
                      required={k === 'measuredSlumpMm'}
                    />
                  </Field>
                </div>
              ))}
              <div style={{ marginBottom: 14 }}>
                <Button type="submit" loading={busy}>Record</Button>
              </div>
            </Form>
          </Card>
        </div>
      )}

      <Card title="Slump tests" padded={false}>
        {rows.length ? (
          <Table>
            <thead>
              <tr>
                <Th>Grade</Th>
                <Th numeric>Slump (mm)</Th>
                <Th>Target</Th>
                <Th>Result</Th>
                <Th>Sample</Th>
                <Th>Tested</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <Td>{String(r.gradeLabel ?? '—')}</Td>
                  <Td numeric>{String(r.measuredSlumpMm)}</Td>
                  <Td>
                    {r.targetMinMm != null || r.targetMaxMm != null
                      ? `${r.targetMinMm ?? '…'}–${r.targetMaxMm ?? '…'}`
                      : '—'}
                  </Td>
                  <Td>{r.passed ? <Badge tone="success">pass</Badge> : <Badge tone="warning">fail</Badge>}</Td>
                  <Td>{String(r.sampleRef ?? '—')}</Td>
                  <Td>{String(r.testedAt ?? '').slice(0, 10)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="No slump tests yet" description={canRecord ? 'Record your first test above.' : 'Nothing to show.'} />
        )}
      </Card>
    </div>
  );
}
