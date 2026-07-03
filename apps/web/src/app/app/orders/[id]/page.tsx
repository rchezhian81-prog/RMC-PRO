'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ordersApi, type Row } from '../../../../lib/api';
import { button, card, ghostButton, table, td, th } from '../../../../lib/ui';

const money = (v: unknown) => Number(v ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });
const statusColor: Record<string, string> = {
  draft: '#8aa0c6', confirmed: '#6ee7a8', credit_hold: '#e0b341', cancelled: '#ff8080',
};

export default function OrderDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [o, setO] = useState<Row | null>(null);
  const [credit, setCredit] = useState<Row | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const order = await ordersApi.get(id);
    setO(order);
    if (order.orderStatus === 'draft') {
      setCredit(await ordersApi.creditCheck(id).catch(() => null));
    } else {
      setCredit(null);
    }
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

  if (!o) return <p style={{ color: 'var(--muted)' }}>Loading…</p>;
  const items = (o.items as Row[]) ?? [];
  const history = (o.history as Row[]) ?? [];
  const holds = (o.creditHolds as Row[]) ?? [];
  const status = String(o.orderStatus);

  return (
    <div>
      <button style={{ ...ghostButton, marginBottom: 12 }} onClick={() => router.push('/app/orders')}>← Orders</button>
      <h1 style={{ fontSize: 22, marginTop: 0 }}>
        {String(o.orderNo)}{' '}
        <span style={{ fontSize: 13, color: statusColor[status] ?? 'var(--muted)' }}>
          {status} · credit {String(o.creditStatus)}
        </span>
      </h1>
      {error && <p style={{ color: '#ff8080', fontSize: 13 }}>{error}</p>}
      {msg && <p style={{ color: '#6ee7a8', fontSize: 13 }}>{msg}</p>}

      {/* Credit assessment (draft only) */}
      {credit && (
        <section style={card}>
          <h3 style={{ marginTop: 0, fontSize: 15 }}>Credit check at booking</h3>
          {credit.enforced ? (
            <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', fontSize: 13.5 }}>
              <Stat label="Credit limit" val={money(credit.creditLimit)} />
              <Stat label="Outstanding" val={money(credit.outstandingBefore)} />
              <Stat label="This order" val={money(credit.requestedAmount)} />
              <Stat label="Exposure after" val={money(credit.exposureAfter)} />
              <Stat
                label="Result"
                val={credit.withinLimit ? 'Within limit' : 'Exceeds limit'}
                color={credit.withinLimit ? '#6ee7a8' : '#e0b341'}
              />
            </div>
          ) : (
            <p style={{ color: 'var(--muted)', fontSize: 13, margin: 0 }}>
              No credit limit configured for this customer — credit control not enforced.
            </p>
          )}
        </section>
      )}

      {/* Actions */}
      <section style={{ ...card, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {status === 'draft' && (
          <button style={button} onClick={() => run(() => ordersApi.confirm(id), 'Order processed')}>
            Confirm order
          </button>
        )}
        {status !== 'cancelled' && (
          <button style={ghostButton} onClick={() => run(async () => {
            const reason = window.prompt('Cancel reason', '');
            if (reason !== null) await ordersApi.cancel(id, reason);
          }, 'Order cancelled')}>Cancel order</button>
        )}
        {status === 'credit_hold' && (
          <span style={{ alignSelf: 'center', color: '#e0b341', fontSize: 13 }}>
            Awaiting credit approval — see Credit Holds.
          </span>
        )}
      </section>

      {/* Lines */}
      <section style={card}>
        <h3 style={{ marginTop: 0, fontSize: 15 }}>Lines</h3>
        <table style={table}>
          <thead>
            <tr>
              <th style={th}>Grade</th><th style={th}>Qty m³</th><th style={th}>Rate/m³</th>
              <th style={th}>Transport</th><th style={th}>Pump</th><th style={th}>Waiting</th><th style={th}>Line</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id}>
                <td style={td}>{String(it.gradeLabel ?? '')}</td>
                <td style={td}>{money(it.quantityM3)}</td>
                <td style={td}>{money(it.ratePerM3)}</td>
                <td style={td}>{money(it.transportCharge)}</td>
                <td style={td}>{money(it.pumpCharge)}</td>
                <td style={td}>{money(it.waitingCharge)}</td>
                <td style={td}>{String(it.lineStatus ?? '')}</td>
              </tr>
            ))}
            {!items.length && <tr><td style={td} colSpan={7}>No lines.</td></tr>}
          </tbody>
        </table>
        <p style={{ textAlign: 'right', margin: '10px 4px 0', fontWeight: 600 }}>
          Estimated value: ₹{money(o.estimatedOrderValue)}
        </p>
      </section>

      {/* Credit holds */}
      {holds.length > 0 && (
        <section style={card}>
          <h3 style={{ marginTop: 0, fontSize: 15 }}>Credit holds</h3>
          <table style={table}>
            <thead><tr><th style={th}>Requested</th><th style={th}>Limit</th><th style={th}>Exposure</th><th style={th}>Status</th><th style={th}>Note</th></tr></thead>
            <tbody>
              {holds.map((h) => (
                <tr key={h.id}>
                  <td style={td}>{money(h.requestedAmount)}</td>
                  <td style={td}>{money(h.creditLimit)}</td>
                  <td style={td}>{money(h.exposureAfter)}</td>
                  <td style={td}>{String(h.status)}</td>
                  <td style={td}>{String(h.decisionNote ?? '—')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* Status history */}
      <section style={card}>
        <h3 style={{ marginTop: 0, fontSize: 15 }}>Status history</h3>
        <table style={table}>
          <thead><tr><th style={th}>When</th><th style={th}>Action</th><th style={th}>From → To</th><th style={th}>Note</th></tr></thead>
          <tbody>
            {history.map((h) => (
              <tr key={h.id}>
                <td style={td}>{String(h.createdAt ?? '').slice(0, 19).replace('T', ' ')}</td>
                <td style={td}>{String(h.action)}</td>
                <td style={td}>{String(h.fromStatus ?? '—')} → {String(h.toStatus)}</td>
                <td style={td}>{String(h.note ?? '—')}</td>
              </tr>
            ))}
            {!history.length && <tr><td style={td} colSpan={4}>No history.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function Stat({ label, val, color }: { label: string; val: string; color?: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 600, color: color ?? 'var(--text)' }}>{val}</div>
    </div>
  );
}
