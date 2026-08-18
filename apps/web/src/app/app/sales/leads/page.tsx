'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { leadsApi, type Row } from '../../../../lib/api';
import { Card } from '../../../../components/ui/Card';
import { Table, Th, Td } from '../../../../components/ui/Table';
import { StatusBadge } from '../../../../components/ui/Badge';
import { Button } from '../../../../components/ui/Button';
import { Form } from '../../../../components/ui/Form';
import { Field, Input } from '../../../../components/ui/Field';
import { ErrorState, EmptyState, TableSkeleton } from '../../../../components/ui/States';

const STAGES = ['new', 'qualified', 'quoted', 'won', 'lost'];

// Module-scope text field: declared inside the page it would remount on every
// keystroke and drop focus after one character.
function F({ label, v, on, w, req }: { label: string; v: string; on: (v: string) => void; w?: number; req?: boolean }) {
  return (
    <div style={{ minWidth: w ?? 150 }}>
      <Field label={label} required={req}>
        <Input value={v} onChange={(e) => on(e.target.value)} required={req} />
      </Field>
    </div>
  );
}

export default function LeadsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [sel, setSel] = useState<Row | null>(null);
  const [form, setForm] = useState({ customerName: '', contactPerson: '', mobile: '', siteLocation: '', leadSource: '' });
  const [fu, setFu] = useState({ notes: '', outcome: '', nextFollowupDate: '', leadStage: '' });
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  async function reload() {
    setRows(await leadsApi.list());
  }
  useEffect(() => {
    reload()
      .catch((e) => setError(String(e)))
      .finally(() => setLoaded(true));
  }, []);

  async function open(id: string) {
    setError(null);
    setSel(await leadsApi.get(id));
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await leadsApi.create(form);
      setForm({ customerName: '', contactPerson: '', mobile: '', siteLocation: '', leadSource: '' });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  }

  async function addFollowup(e: FormEvent) {
    e.preventDefault();
    if (!sel) return;
    setError(null);
    try {
      await leadsApi.addFollowup(String(sel.id), fu);
      setFu({ notes: '', outcome: '', nextFollowupDate: '', leadStage: '' });
      await open(String(sel.id));
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  }

  const followups = (sel?.followups as Row[]) ?? [];

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <h1 style={{ fontSize: 24, margin: 0 }}>Sales Leads</h1>
      {error && <ErrorState message={error} />}

      <Card title="New lead">
        <Form onSubmit={create} style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end' }}>
          <F label="Customer name" v={form.customerName} on={(v) => setForm({ ...form, customerName: v })} w={190} req />
          <F label="Contact" v={form.contactPerson} on={(v) => setForm({ ...form, contactPerson: v })} w={140} />
          <F label="Mobile" v={form.mobile} on={(v) => setForm({ ...form, mobile: v })} w={130} />
          <F label="Site location" v={form.siteLocation} on={(v) => setForm({ ...form, siteLocation: v })} w={160} />
          <F label="Source" v={form.leadSource} on={(v) => setForm({ ...form, leadSource: v })} w={120} />
          <div style={{ marginBottom: 14 }}>
            <Button type="submit">Create</Button>
          </div>
        </Form>
      </Card>

      <Card title="Leads" padded={false}>
        {!loaded ? (
          <TableSkeleton cols={6} />
        ) : rows.length ? (
          <Table>
            <thead>
              <tr>
                <Th>Lead No</Th>
                <Th>Customer</Th>
                <Th>Mobile</Th>
                <Th>Stage</Th>
                <Th>Next follow-up</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <Td style={{ fontWeight: 600 }}>{String(r.leadNo ?? '')}</Td>
                  <Td>{String(r.customerName ?? '')}</Td>
                  <Td>{String(r.mobile ?? '')}</Td>
                  <Td><StatusBadge status={String(r.leadStage ?? '')} /></Td>
                  <Td>{String(r.nextFollowupDate ?? '—')}</Td>
                  <Td style={{ textAlign: 'right' }}>
                    <Button variant="secondary" size="sm" onClick={() => open(String(r.id))}>Follow-ups</Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="No leads yet" description="Capture your first lead above." />
        )}
      </Card>

      {sel && (
        <Card title={`${String(sel.leadNo)} — ${String(sel.customerName)}`} actions={<StatusBadge status={String(sel.leadStage)} />}>
          <Form onSubmit={addFollowup} style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end', marginBottom: 16 }}>
            <F label="Notes" v={fu.notes} on={(v) => setFu({ ...fu, notes: v })} w={220} />
            <F label="Outcome" v={fu.outcome} on={(v) => setFu({ ...fu, outcome: v })} w={130} />
            <div style={{ minWidth: 150 }}>
              <Field label="Next date">
                <Input type="date" value={fu.nextFollowupDate} onChange={(e) => setFu({ ...fu, nextFollowupDate: e.target.value })} />
              </Field>
            </div>
            <div style={{ minWidth: 140 }}>
              <Field label="Move stage">
                <select className="mn-input" value={fu.leadStage} onChange={(e) => setFu({ ...fu, leadStage: e.target.value })}>
                  <option value="">— keep —</option>
                  {STAGES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </Field>
            </div>
            <div style={{ marginBottom: 14 }}>
              <Button type="submit">Add follow-up</Button>
            </div>
          </Form>

          <Table>
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Notes</Th>
                <Th>Outcome</Th>
                <Th>Next</Th>
              </tr>
            </thead>
            <tbody>
              {followups.map((f) => (
                <tr key={f.id}>
                  <Td>{String(f.createdAt ?? '').slice(0, 10)}</Td>
                  <Td>{String(f.notes ?? '')}</Td>
                  <Td>{String(f.outcome ?? '')}</Td>
                  <Td>{String(f.nextFollowupDate ?? '—')}</Td>
                </tr>
              ))}
              {!followups.length && (
                <tr>
                  <Td colSpan={4} style={{ color: 'var(--mn-muted)' }}>No follow-ups yet.</Td>
                </tr>
              )}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  );
}
