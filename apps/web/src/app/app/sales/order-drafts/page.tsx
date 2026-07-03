'use client';

import { useEffect, useState } from 'react';
import { orderDraftsApi, type Row } from '../../../../lib/api';
import { card, ghostButton, table, td, th } from '../../../../lib/ui';

const money = (v: unknown) => Number(v ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });

export default function OrderDraftsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [sel, setSel] = useState<Row | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    orderDraftsApi.list().then(setRows).catch((e) => setError(String(e)));
  }, []);

  async function open(id: string) {
    setError(null);
    setSel(await orderDraftsApi.get(id));
  }

  const items = (sel?.items as Row[]) ?? [];

  return (
    <div>
      <h1 style={{ fontSize: 22, marginTop: 0 }}>Order Drafts</h1>
      <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 0 }}>
        Draft orders created from approved quotations / rate contracts. This is the sales → operations
        handoff only — confirmation, credit check, scheduling, dispatch and billing come in later sprints.
      </p>
      {error && <p style={{ color: '#ff8080', fontSize: 13 }}>{error}</p>}

      <section style={card}>
        <table style={table}>
          <thead>
            <tr>
              <th style={th}>Order No</th>
              <th style={th}>Source</th>
              <th style={th}>Order date</th>
              <th style={th}>Credit</th>
              <th style={th}>Status</th>
              <th style={th}>Est. value</th>
              <th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td style={td}>{String(r.orderNo ?? '')}</td>
                <td style={td}>{String(r.pricingSource ?? '—')}</td>
                <td style={td}>{String(r.orderDate ?? '—')}</td>
                <td style={td}>{String(r.creditStatus ?? '')}</td>
                <td style={td}><span style={{ color: '#e0b341', fontWeight: 600 }}>{String(r.orderStatus)}</span></td>
                <td style={td}>{money(r.estimatedOrderValue)}</td>
                <td style={td}><button style={ghostButton} onClick={() => open(String(r.id))}>Lines</button></td>
              </tr>
            ))}
            {!rows.length && <tr><td style={td} colSpan={7}>No order drafts yet.</td></tr>}
          </tbody>
        </table>
      </section>

      {sel && (
        <section style={card}>
          <h3 style={{ marginTop: 0, fontSize: 15 }}>{String(sel.orderNo)} — lines</h3>
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>Grade</th>
                <th style={th}>Qty m³</th>
                <th style={th}>Rate/m³</th>
                <th style={th}>Transport</th>
                <th style={th}>Pump</th>
                <th style={th}>Waiting</th>
                <th style={th}>Line status</th>
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
        </section>
      )}
    </div>
  );
}
