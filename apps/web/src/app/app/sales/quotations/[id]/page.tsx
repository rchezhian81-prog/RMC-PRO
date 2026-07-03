'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { crud, orderDraftsApi, openQuotationPdf, quotationsApi, type Row } from '../../../../../lib/api';
import { button, card, ghostButton, input, table, td, th } from '../../../../../lib/ui';

const money = (v: unknown) => Number(v ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });

export default function QuotationDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [q, setQ] = useState<Row | null>(null);
  const [grades, setGrades] = useState<Row[]>([]);
  const [revs, setRevs] = useState<Row[]>([]);
  const [item, setItem] = useState({ gradeId: '', gradeLabel: '', estimatedQuantity: '', ratePerM3: '', transportCharge: '', pumpCharge: '', waitingCharge: '' });
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [full, g, r] = await Promise.all([quotationsApi.get(id), crud('concrete-grades').list(), quotationsApi.revisions(id)]);
    setQ(full);
    setGrades(g);
    setRevs(r);
  }, [id]);

  useEffect(() => {
    load().catch((e) => setError(String(e)));
  }, [load]);

  async function run(fn: () => Promise<unknown>, okMsg?: string) {
    setError(null);
    setMsg(null);
    try {
      await fn();
      await load();
      if (okMsg) setMsg(okMsg);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  }

  async function addItem(e: FormEvent) {
    e.preventDefault();
    const g = grades.find((x) => String(x.id) === item.gradeId);
    await run(async () => {
      await quotationsApi.addItem(id, {
        gradeId: item.gradeId || undefined,
        gradeLabel: item.gradeLabel || (g ? String(g.gradeCode) : ''),
        estimatedQuantity: Number(item.estimatedQuantity || 0),
        ratePerM3: Number(item.ratePerM3 || 0),
        transportCharge: Number(item.transportCharge || 0),
        pumpCharge: Number(item.pumpCharge || 0),
        waitingCharge: Number(item.waitingCharge || 0),
      });
      setItem({ gradeId: '', gradeLabel: '', estimatedQuantity: '', ratePerM3: '', transportCharge: '', pumpCharge: '', waitingCharge: '' });
    });
  }

  if (!q) return <p style={{ color: 'var(--muted)' }}>Loading…</p>;
  const items = (q.items as Row[]) ?? [];
  const status = String(q.approvalStatus);
  const locked = status === 'approved';

  return (
    <div>
      <button style={{ ...ghostButton, marginBottom: 12 }} onClick={() => router.push('/app/sales/quotations')}>← Quotations</button>
      <h1 style={{ fontSize: 22, marginTop: 0 }}>
        {String(q.quotationNo)} <span style={{ fontSize: 13, color: 'var(--muted)' }}>rev {String(q.revisionNo)} · {status}</span>
      </h1>
      {error && <p style={{ color: '#ff8080', fontSize: 13 }}>{error}</p>}
      {msg && <p style={{ color: '#6ee7a8', fontSize: 13 }}>{msg}</p>}

      {/* Actions */}
      <section style={{ ...card, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {status === 'draft' && <button style={button} onClick={() => run(() => quotationsApi.submit(id), 'Submitted for approval')}>Submit</button>}
        {status === 'rejected' && <button style={button} onClick={() => run(() => quotationsApi.submit(id), 'Re-submitted')}>Re-submit</button>}
        {status === 'submitted' && <button style={button} onClick={() => run(() => quotationsApi.approve(id), 'Approved')}>Approve</button>}
        {status === 'submitted' && <button style={ghostButton} onClick={() => run(() => quotationsApi.reject(id, 'Not accepted'), 'Rejected')}>Reject</button>}
        <button style={ghostButton} onClick={() => openQuotationPdf(id).catch((e) => setError(String(e)))}>Download PDF</button>
        <button style={ghostButton} onClick={() => run(async () => {
          const m = window.prompt('Recipient mobile (WhatsApp)', '');
          if (m !== null) await quotationsApi.share(id, m);
        }, 'WhatsApp message logged')}>Share on WhatsApp</button>
        <button style={ghostButton} onClick={() => run(async () => {
          const reason = window.prompt('Revision reason', '');
          if (reason !== null) await quotationsApi.createRevision(id, reason);
        }, 'New revision created')}>New revision</button>
        {status === 'approved' && (
          <button style={button} onClick={() => run(async () => {
            const od = await orderDraftsApi.fromQuotation(id, {});
            setMsg(`Order draft ${String(od.orderNo)} created`);
          })}>Convert → Order draft</button>
        )}
      </section>

      {/* Items */}
      <section style={card}>
        <h3 style={{ marginTop: 0, fontSize: 15 }}>Grade-wise items</h3>
        <table style={table}>
          <thead>
            <tr>
              <th style={th}>Grade</th>
              <th style={th}>Qty (m³)</th>
              <th style={th}>Rate/m³</th>
              <th style={th}>Transport</th>
              <th style={th}>Pump</th>
              <th style={th}>Waiting</th>
              <th style={th}>GST</th>
              <th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id}>
                <td style={td}>{String(it.gradeLabel ?? '')}</td>
                <td style={td}>{money(it.estimatedQuantity)}</td>
                <td style={td}>{money(it.ratePerM3)}</td>
                <td style={td}>{money(it.transportCharge)}</td>
                <td style={td}>{money(it.pumpCharge)}</td>
                <td style={td}>{money(it.waitingCharge)}</td>
                <td style={td}>{it.gstApplicable ? 'Yes' : 'No'}</td>
                <td style={td}>
                  {!locked && (
                    <button style={ghostButton} onClick={() => run(() => quotationsApi.deleteItem(id, String(it.id)))}>Remove</button>
                  )}
                </td>
              </tr>
            ))}
            {!items.length && <tr><td style={td} colSpan={8}>No items yet.</td></tr>}
          </tbody>
        </table>

        {!locked && (
          <form onSubmit={addItem} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end', marginTop: 12 }}>
            <div>
              <label style={lbl}>Grade</label>
              <select style={{ ...input, width: 130 }} value={item.gradeId} onChange={(e) => setItem({ ...item, gradeId: e.target.value })}>
                <option value="">— pick —</option>
                {grades.map((g) => <option key={g.id} value={String(g.id)}>{String(g.gradeCode)}</option>)}
              </select>
            </div>
            <Num label="Qty m³" v={item.estimatedQuantity} on={(v) => setItem({ ...item, estimatedQuantity: v })} />
            <Num label="Rate/m³" v={item.ratePerM3} on={(v) => setItem({ ...item, ratePerM3: v })} />
            <Num label="Transport" v={item.transportCharge} on={(v) => setItem({ ...item, transportCharge: v })} />
            <Num label="Pump" v={item.pumpCharge} on={(v) => setItem({ ...item, pumpCharge: v })} />
            <Num label="Waiting" v={item.waitingCharge} on={(v) => setItem({ ...item, waitingCharge: v })} />
            <button style={button}>Add item</button>
          </form>
        )}
        {locked && <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 10 }}>Approved quotation is locked. Create a revision to edit.</p>}
      </section>

      {/* Revisions */}
      <section style={card}>
        <h3 style={{ marginTop: 0, fontSize: 15 }}>Revision history</h3>
        <table style={table}>
          <thead><tr><th style={th}>Rev</th><th style={th}>Reason</th><th style={th}>When</th></tr></thead>
          <tbody>
            {revs.map((r) => (
              <tr key={r.id}>
                <td style={td}>{String(r.revisionNo)}</td>
                <td style={td}>{String(r.changeReason ?? '—')}</td>
                <td style={td}>{String(r.createdAt ?? '').slice(0, 19).replace('T', ' ')}</td>
              </tr>
            ))}
            {!revs.length && <tr><td style={td} colSpan={3}>No revisions.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}

const lbl = { fontSize: 12, color: 'var(--muted)' } as const;
function Num({ label, v, on }: { label: string; v: string; on: (v: string) => void }) {
  return (
    <div>
      <label style={lbl}>{label}</label>
      <input type="number" step="any" style={{ ...input, width: 90 }} value={v} onChange={(e) => on(e.target.value)} />
    </div>
  );
}
