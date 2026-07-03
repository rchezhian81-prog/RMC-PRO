'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { batchTicketsApi, type Row } from '../../../../../lib/api';
import { button, card, ghostButton, input, table, td, th } from '../../../../../lib/ui';

const fmt = (v: unknown) => Number(v ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 3 });

export default function BatchTicketDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [t, setT] = useState<Row | null>(null);
  const [actuals, setActuals] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const ticket = await batchTicketsApi.get(id);
    setT(ticket);
    const mats = (ticket.materials as Row[]) ?? [];
    setActuals(Object.fromEntries(mats.map((m) => [String(m.id), String(m.actualQuantity ?? '')])));
  }, [id]);

  useEffect(() => { load().catch((e) => setError(String(e))); }, [load]);

  async function run(fn: () => Promise<unknown>, okMsg?: string) {
    setError(null); setMsg(null);
    try { await fn(); await load(); if (okMsg) setMsg(okMsg); } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
  }

  async function saveActuals() {
    const mats = (t?.materials as Row[]) ?? [];
    await run(() => batchTicketsApi.updateActuals(id, mats.map((m) => ({ id: m.id, actualQuantity: Number(actuals[String(m.id)] || 0) }))), 'Actuals saved');
  }

  async function confirm(override = false) {
    setError(null); setMsg(null);
    try {
      await batchTicketsApi.confirm(id, override);
      await load();
      setMsg('Batch confirmed — inventory reduced.');
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed';
      if (/tolerance/i.test(message) && !override) {
        if (window.confirm(`${message}\n\nConfirm anyway with variance override?`)) return confirm(true);
        setError(message);
      } else {
        setError(message);
      }
    }
  }

  if (!t) return <p style={{ color: 'var(--muted)' }}>Loading…</p>;
  const mats = (t.materials as Row[]) ?? [];
  const status = String(t.status);
  const draft = status === 'draft';

  return (
    <div>
      <button style={{ ...ghostButton, marginBottom: 12 }} onClick={() => router.push('/app/production/batch-tickets')}>← Batch Tickets</button>
      <h1 style={{ fontSize: 22, marginTop: 0 }}>
        {String(t.batchTicketNo)} <span style={{ fontSize: 13, color: 'var(--muted)' }}>{String(t.gradeLabel ?? '')} · {fmt(t.batchQuantityM3)} m³ · {status}</span>
      </h1>
      {t.varianceExceeded ? <p style={{ color: '#e0b341', fontSize: 13 }}>⚠ Variance exceeded tolerance (override recorded).</p> : null}
      {error && <p style={{ color: '#ff8080', fontSize: 13 }}>{error}</p>}
      {msg && <p style={{ color: '#6ee7a8', fontSize: 13 }}>{msg}</p>}

      <section style={card}>
        <h3 style={{ marginTop: 0, fontSize: 15 }}>Material — target vs actual</h3>
        <table style={table}>
          <thead><tr><th style={th}>Material</th><th style={th}>Target</th><th style={th}>Actual</th><th style={th}>UOM</th><th style={th}>Variance %</th><th style={th}>Tol %</th><th style={th}>In tol?</th></tr></thead>
          <tbody>
            {mats.map((m) => (
              <tr key={m.id}>
                <td style={td}>{String(m.materialLabel ?? '')}</td>
                <td style={td}>{fmt(m.targetQuantity)}</td>
                <td style={td}>
                  {draft ? (
                    <input type="number" step="any" style={{ ...input, width: 100 }} value={actuals[String(m.id)] ?? ''} onChange={(e) => setActuals({ ...actuals, [String(m.id)]: e.target.value })} />
                  ) : fmt(m.actualQuantity)}
                </td>
                <td style={td}>{String(m.uom ?? '')}</td>
                <td style={td}>{String(m.variancePercentage)}%</td>
                <td style={td}>{String(m.tolerancePercentage)}%</td>
                <td style={td}>{m.withinTolerance ? <span style={{ color: '#6ee7a8' }}>yes</span> : <span style={{ color: '#e0b341', fontWeight: 600 }}>no</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {draft && (
          <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
            <button style={ghostButton} onClick={saveActuals}>Save actuals</button>
            <button style={button} onClick={() => confirm(false)}>Confirm batch</button>
            <button style={ghostButton} onClick={() => run(() => batchTicketsApi.cancel(id), 'Ticket cancelled')}>Cancel</button>
          </div>
        )}
      </section>
    </div>
  );
}
