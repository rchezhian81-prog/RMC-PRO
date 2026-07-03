'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { leadsApi, type Row } from '../../../../lib/api';
import { button, card, ghostButton, input, table, td, th } from '../../../../lib/ui';

const STAGES = ['new', 'qualified', 'quoted', 'won', 'lost'];

export default function LeadsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [sel, setSel] = useState<Row | null>(null);
  const [form, setForm] = useState({ customerName: '', contactPerson: '', mobile: '', siteLocation: '', leadSource: '' });
  const [fu, setFu] = useState({ notes: '', outcome: '', nextFollowupDate: '', leadStage: '' });
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    setRows(await leadsApi.list());
  }
  useEffect(() => {
    reload().catch((e) => setError(String(e)));
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
    <div>
      <h1 style={{ fontSize: 22, marginTop: 0 }}>Sales Leads</h1>
      {error && <p style={{ color: '#ff8080', fontSize: 13 }}>{error}</p>}

      <section style={card}>
        <h3 style={{ marginTop: 0, fontSize: 15 }}>New Lead</h3>
        <form onSubmit={create} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'end' }}>
          <Field label="Customer name *" v={form.customerName} on={(v) => setForm({ ...form, customerName: v })} w={190} />
          <Field label="Contact" v={form.contactPerson} on={(v) => setForm({ ...form, contactPerson: v })} w={140} />
          <Field label="Mobile" v={form.mobile} on={(v) => setForm({ ...form, mobile: v })} w={130} />
          <Field label="Site location" v={form.siteLocation} on={(v) => setForm({ ...form, siteLocation: v })} w={160} />
          <Field label="Source" v={form.leadSource} on={(v) => setForm({ ...form, leadSource: v })} w={120} />
          <button style={button}>Create</button>
        </form>
      </section>

      <section style={card}>
        <table style={table}>
          <thead>
            <tr>
              <th style={th}>Lead No</th>
              <th style={th}>Customer</th>
              <th style={th}>Mobile</th>
              <th style={th}>Stage</th>
              <th style={th}>Next follow-up</th>
              <th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td style={td}>{String(r.leadNo ?? '')}</td>
                <td style={td}>{String(r.customerName ?? '')}</td>
                <td style={td}>{String(r.mobile ?? '')}</td>
                <td style={td}>{String(r.leadStage ?? '')}</td>
                <td style={td}>{String(r.nextFollowupDate ?? '—')}</td>
                <td style={td}>
                  <button style={ghostButton} onClick={() => open(String(r.id))}>
                    Follow-ups
                  </button>
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr><td style={td} colSpan={6}>No leads yet.</td></tr>
            )}
          </tbody>
        </table>
      </section>

      {sel && (
        <section style={card}>
          <h3 style={{ marginTop: 0, fontSize: 15 }}>
            {String(sel.leadNo)} — {String(sel.customerName)}{' '}
            <span style={{ color: 'var(--muted)', fontSize: 12 }}>({String(sel.leadStage)})</span>
          </h3>

          <form onSubmit={addFollowup} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'end', marginBottom: 14 }}>
            <Field label="Notes" v={fu.notes} on={(v) => setFu({ ...fu, notes: v })} w={220} />
            <Field label="Outcome" v={fu.outcome} on={(v) => setFu({ ...fu, outcome: v })} w={130} />
            <div>
              <label style={lbl}>Next date</label>
              <input type="date" style={input} value={fu.nextFollowupDate} onChange={(e) => setFu({ ...fu, nextFollowupDate: e.target.value })} />
            </div>
            <div>
              <label style={lbl}>Move stage</label>
              <select style={{ ...input, width: 140 }} value={fu.leadStage} onChange={(e) => setFu({ ...fu, leadStage: e.target.value })}>
                <option value="">— keep —</option>
                {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <button style={button}>Add follow-up</button>
          </form>

          <table style={table}>
            <thead>
              <tr>
                <th style={th}>When</th>
                <th style={th}>Notes</th>
                <th style={th}>Outcome</th>
                <th style={th}>Next</th>
              </tr>
            </thead>
            <tbody>
              {followups.map((f) => (
                <tr key={f.id}>
                  <td style={td}>{String(f.createdAt ?? '').slice(0, 10)}</td>
                  <td style={td}>{String(f.notes ?? '')}</td>
                  <td style={td}>{String(f.outcome ?? '')}</td>
                  <td style={td}>{String(f.nextFollowupDate ?? '—')}</td>
                </tr>
              ))}
              {!followups.length && <tr><td style={td} colSpan={4}>No follow-ups yet.</td></tr>}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

const lbl = { fontSize: 12, color: 'var(--muted)' } as const;
function Field({ label, v, on, w }: { label: string; v: string; on: (v: string) => void; w: number }) {
  return (
    <div>
      <label style={lbl}>{label}</label>
      <input style={{ ...input, width: w }} value={v} onChange={(e) => on(e.target.value)} />
    </div>
  );
}
