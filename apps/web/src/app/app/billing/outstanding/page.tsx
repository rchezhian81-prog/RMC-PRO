'use client';

import { useEffect, useState } from 'react';
import { billingReportsApi, type Row } from '../../../../lib/api';
import { card, table, td, th } from '../../../../lib/ui';

const money = (v: unknown) => Number(v ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });

export default function OutstandingPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [totals, setTotals] = useState<Row | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    billingReportsApi.outstanding().then((d) => { setRows(d.rows as Row[]); setTotals(d.totals as Row); }).catch((e) => setError(String(e)));
  }, []);

  return (
    <div>
      <h1 style={{ fontSize: 22, marginTop: 0 }}>Customer Outstanding</h1>
      <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 0 }}>Outstanding on issued invoices, aged by invoice date.</p>
      {error && <p style={{ color: '#ff8080', fontSize: 13 }}>{error}</p>}

      <section style={card}>
        <table style={table}>
          <thead>
            <tr>
              <th style={th}>Customer</th><th style={th}>0–30</th><th style={th}>31–60</th><th style={th}>61–90</th><th style={th}>90+</th><th style={th}>Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td style={td}>{String(r.customerName)}</td>
                <td style={td}>{money(r.b0_30)}</td>
                <td style={td}>{money(r.b31_60)}</td>
                <td style={td}>{money(r.b61_90)}</td>
                <td style={{ ...td, color: Number(r.b90) > 0 ? '#ff8080' : 'var(--text)' }}>{money(r.b90)}</td>
                <td style={{ ...td, fontWeight: 600 }}>{money(r.total)}</td>
              </tr>
            ))}
            {!rows.length && <tr><td style={td} colSpan={6}>No outstanding.</td></tr>}
          </tbody>
          {totals && rows.length > 0 && (
            <tfoot>
              <tr>
                <td style={{ ...td, fontWeight: 700 }}>All customers</td>
                <td style={{ ...td, fontWeight: 700 }}>{money(totals.b0_30)}</td>
                <td style={{ ...td, fontWeight: 700 }}>{money(totals.b31_60)}</td>
                <td style={{ ...td, fontWeight: 700 }}>{money(totals.b61_90)}</td>
                <td style={{ ...td, fontWeight: 700 }}>{money(totals.b90)}</td>
                <td style={{ ...td, fontWeight: 700 }}>{money(totals.total)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </section>
    </div>
  );
}
