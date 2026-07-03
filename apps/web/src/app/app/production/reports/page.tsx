'use client';

import { useEffect, useState } from 'react';
import { productionReportsApi, type Row } from '../../../../lib/api';
import { card, table, td, th } from '../../../../lib/ui';

const fmt = (v: unknown) => Number(v ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 3 });

export default function ProductionReportsPage() {
  const [byGrade, setByGrade] = useState<Row[]>([]);
  const [totals, setTotals] = useState<Row | null>(null);
  const [variance, setVariance] = useState<Row[]>([]);
  const [consumption, setConsumption] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [s, v, c] = await Promise.all([
        productionReportsApi.summary(),
        productionReportsApi.variance(),
        productionReportsApi.consumption(),
      ]);
      setByGrade(s.byGrade as Row[]);
      setTotals(s.totals as Row);
      setVariance(v);
      setConsumption(c);
    })().catch((e) => setError(String(e)));
  }, []);

  return (
    <div>
      <h1 style={{ fontSize: 22, marginTop: 0 }}>Production Reports</h1>
      {error && <p style={{ color: '#ff8080', fontSize: 13 }}>{error}</p>}

      <section style={card}>
        <h3 style={{ marginTop: 0, fontSize: 15 }}>
          Production summary{totals ? ` — ${fmt(totals.batches)} batches · ${fmt(totals.producedM3)} m³` : ''}
        </h3>
        <table style={table}>
          <thead><tr><th style={th}>Grade</th><th style={th}>Batches</th><th style={th}>Produced m³</th><th style={th}>Variance batches</th></tr></thead>
          <tbody>
            {byGrade.map((g, i) => (
              <tr key={i}>
                <td style={td}>{String(g.grade)}</td>
                <td style={td}>{fmt(g.batches)}</td>
                <td style={td}>{fmt(g.producedM3)}</td>
                <td style={td}>{fmt(g.varianceBatches)}</td>
              </tr>
            ))}
            {!byGrade.length && <tr><td style={td} colSpan={4}>No production yet.</td></tr>}
          </tbody>
        </table>
      </section>

      <section style={card}>
        <h3 style={{ marginTop: 0, fontSize: 15 }}>Material consumption</h3>
        <table style={table}>
          <thead><tr><th style={th}>Material</th><th style={th}>Consumed</th></tr></thead>
          <tbody>
            {consumption.map((c, i) => (
              <tr key={i}><td style={td}>{String(c.material)}</td><td style={td}>{fmt(c.consumed)}</td></tr>
            ))}
            {!consumption.length && <tr><td style={td} colSpan={2}>No consumption yet.</td></tr>}
          </tbody>
        </table>
      </section>

      <section style={card}>
        <h3 style={{ marginTop: 0, fontSize: 15 }}>Variance report (tolerance breaches)</h3>
        {variance.length ? variance.map((v, i) => (
          <div key={i} style={{ marginBottom: 12 }}>
            <div style={{ fontWeight: 600, fontSize: 13.5 }}>{String(v.batchTicketNo)} · {String(v.gradeLabel ?? '')} · {fmt(v.batchQuantityM3)} m³</div>
            <table style={table}>
              <thead><tr><th style={th}>Material</th><th style={th}>Target</th><th style={th}>Actual</th><th style={th}>Variance %</th><th style={th}>Tol %</th></tr></thead>
              <tbody>
                {((v.breaches as Row[]) ?? []).map((b, j) => (
                  <tr key={j}>
                    <td style={td}>{String(b.material)}</td>
                    <td style={td}>{fmt(b.target)}</td>
                    <td style={td}>{fmt(b.actual)}</td>
                    <td style={{ ...td, color: '#e0b341', fontWeight: 600 }}>{String(b.variancePercentage)}%</td>
                    <td style={td}>{String(b.tolerancePercentage)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )) : <p style={{ color: 'var(--muted)', fontSize: 13, margin: 0 }}>No tolerance breaches.</p>}
      </section>
    </div>
  );
}
