'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { crud, orderDraftsApi, rateContractsApi, type Row } from '../../../../../lib/api';
import { button, card, ghostButton, input, table, td, th } from '../../../../../lib/ui';

const money = (v: unknown) => Number(v ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });

export default function RateContractDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [rc, setRc] = useState<Row | null>(null);
  const [grades, setGrades] = useState<Row[]>([]);
  const [item, setItem] = useState({ gradeId: '', ratePerM3: '', transportCharge: '', pumpCharge: '', waitingCharge: '' });
  const [qty, setQty] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [full, g] = await Promise.all([rateContractsApi.get(id), crud('concrete-grades').list()]);
    setRc(full);
    setGrades(g);
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
      await rateContractsApi.addItem(id, {
        gradeId: item.gradeId || undefined,
        gradeLabel: g ? String(g.gradeCode) : '',
        ratePerM3: Number(item.ratePerM3 || 0),
        transportCharge: Number(item.transportCharge || 0),
        pumpCharge: Number(item.pumpCharge || 0),
        waitingCharge: Number(item.waitingCharge || 0),
      });
      setItem({ gradeId: '', ratePerM3: '', transportCharge: '', pumpCharge: '', waitingCharge: '' });
    });
  }

  async function convert() {
    const lines = ((rc?.items as Row[]) ?? [])
      .map((it) => ({ gradeId: it.gradeId, gradeLabel: it.gradeLabel, quantityM3: Number(qty[String(it.id)] || 0) }))
      .filter((l) => l.quantityM3 > 0);
    if (!lines.length) {
      setError('Enter a quantity for at least one grade');
      return;
    }
    await run(async () => {
      const od = await orderDraftsApi.fromRateContract(id, { lines });
      setMsg(`Order draft ${String(od.orderNo)} created`);
    });
  }

  if (!rc) return <p style={{ color: 'var(--muted)' }}>Loading…</p>;
  const items = (rc.items as Row[]) ?? [];
  const status = String(rc.approvalStatus);
  const locked = status === 'approved';

  return (
    <div>
      <button style={{ ...ghostButton, marginBottom: 12 }} onClick={() => router.push('/app/sales/rate-contracts')}>← Rate Contracts</button>
      <h1 style={{ fontSize: 22, marginTop: 0 }}>
        {String(rc.rateContractNo)} <span style={{ fontSize: 13, color: 'var(--muted)' }}>{status}</span>
      </h1>
      {error && <p style={{ color: '#ff8080', fontSize: 13 }}>{error}</p>}
      {msg && <p style={{ color: '#6ee7a8', fontSize: 13 }}>{msg}</p>}

      <section style={{ ...card, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {status === 'draft' && <button style={button} onClick={() => run(() => rateContractsApi.submit(id), 'Submitted')}>Submit</button>}
        {status === 'rejected' && <button style={button} onClick={() => run(() => rateContractsApi.submit(id), 'Re-submitted')}>Re-submit</button>}
        {status === 'submitted' && <button style={button} onClick={() => run(() => rateContractsApi.approve(id), 'Approved')}>Approve</button>}
        {status === 'submitted' && <button style={ghostButton} onClick={() => run(() => rateContractsApi.reject(id, 'Not accepted'), 'Rejected')}>Reject</button>}
      </section>

      <section style={card}>
        <h3 style={{ marginTop: 0, fontSize: 15 }}>Grade-wise agreed rates</h3>
        <table style={table}>
          <thead>
            <tr>
              <th style={th}>Grade</th>
              <th style={th}>Rate/m³</th>
              <th style={th}>Transport</th>
              <th style={th}>Pump</th>
              <th style={th}>Waiting</th>
              {locked && <th style={th}>Order qty m³</th>}
              <th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id}>
                <td style={td}>{String(it.gradeLabel ?? '')}</td>
                <td style={td}>{money(it.ratePerM3)}</td>
                <td style={td}>{money(it.transportCharge)}</td>
                <td style={td}>{money(it.pumpCharge)}</td>
                <td style={td}>{money(it.waitingCharge)}</td>
                {locked && (
                  <td style={td}>
                    <input type="number" step="any" style={{ ...input, width: 90 }} value={qty[String(it.id)] ?? ''} onChange={(e) => setQty({ ...qty, [String(it.id)]: e.target.value })} />
                  </td>
                )}
                <td style={td}>
                  {!locked && <button style={ghostButton} onClick={() => run(() => rateContractsApi.deleteItem(id, String(it.id)))}>Remove</button>}
                </td>
              </tr>
            ))}
            {!items.length && <tr><td style={td} colSpan={locked ? 7 : 6}>No items yet.</td></tr>}
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
            <Num label="Rate/m³" v={item.ratePerM3} on={(v) => setItem({ ...item, ratePerM3: v })} />
            <Num label="Transport" v={item.transportCharge} on={(v) => setItem({ ...item, transportCharge: v })} />
            <Num label="Pump" v={item.pumpCharge} on={(v) => setItem({ ...item, pumpCharge: v })} />
            <Num label="Waiting" v={item.waitingCharge} on={(v) => setItem({ ...item, waitingCharge: v })} />
            <button style={button}>Add rate</button>
          </form>
        )}
      </section>

      {locked && (
        <section style={card}>
          <h3 style={{ marginTop: 0, fontSize: 15 }}>Convert to order draft</h3>
          <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 0 }}>
            Enter order quantities per grade above, then create a draft order (handoff to operations).
          </p>
          <button style={button} onClick={convert}>Convert → Order draft</button>
        </section>
      )}
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
