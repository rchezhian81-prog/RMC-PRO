'use client';

import { useEffect, useState } from 'react';
import { inventoryReportsApi, type Row } from '../../../../lib/api';
import { card, table, td, th } from '../../../../lib/ui';

const money = (v: unknown) => Number(v ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 3 });

export default function InventoryReportsPage() {
  const [low, setLow] = useState<Row[]>([]);
  const [negative, setNegative] = useState<Row[]>([]);
  const [valuation, setValuation] = useState<{ rows: Row[]; total: number } | null>(null);
  const [movement, setMovement] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [l, n, v, mv] = await Promise.all([
        inventoryReportsApi.lowStock(), inventoryReportsApi.negativeStock(),
        inventoryReportsApi.valuation(), inventoryReportsApi.movement(),
      ]);
      setLow(l); setNegative(n); setValuation(v); setMovement(mv);
    })().catch((e) => setError(String(e)));
  }, []);

  return (
    <div>
      <h1 style={{ fontSize: 22, marginTop: 0 }}>Inventory Reports</h1>
      {error && <p style={{ color: '#ff8080', fontSize: 13 }}>{error}</p>}

      <section style={card}>
        <h3 style={{ marginTop: 0, fontSize: 15 }}>Negative stock</h3>
        <table style={table}>
          <thead><tr><th style={th}>Material</th><th style={th}>Current qty</th><th style={th}>UOM</th></tr></thead>
          <tbody>
            {negative.map((r) => (
              <tr key={r.id}><td style={td}>{String(r.materialLabel ?? '')}</td><td style={{ ...td, color: '#ff8080', fontWeight: 600 }}>{money(r.currentQuantity)}</td><td style={td}>{String(r.uom ?? '')}</td></tr>
            ))}
            {!negative.length && <tr><td style={td} colSpan={3}>No negative balances.</td></tr>}
          </tbody>
        </table>
      </section>

      <section style={card}>
        <h3 style={{ marginTop: 0, fontSize: 15 }}>Low stock (at / below reorder level)</h3>
        <table style={table}>
          <thead><tr><th style={th}>Material</th><th style={th}>Current qty</th><th style={th}>Reorder level</th><th style={th}>UOM</th></tr></thead>
          <tbody>
            {low.map((r, i) => (
              <tr key={i}><td style={td}>{String(r.material)}</td><td style={{ ...td, color: '#e0b341' }}>{money(r.currentQuantity)}</td><td style={td}>{money(r.reorderLevel)}</td><td style={td}>{String(r.uom ?? '')}</td></tr>
            ))}
            {!low.length && <tr><td style={td} colSpan={4}>No low-stock materials.</td></tr>}
          </tbody>
        </table>
      </section>

      <section style={card}>
        <h3 style={{ marginTop: 0, fontSize: 15 }}>Stock valuation{valuation ? ` — total ₹${money(valuation.total)}` : ''}</h3>
        <table style={table}>
          <thead><tr><th style={th}>Material</th><th style={th}>Qty</th><th style={th}>Rate</th><th style={th}>Value</th></tr></thead>
          <tbody>
            {(valuation?.rows ?? []).map((r, i) => (
              <tr key={i}><td style={td}>{String(r.material)}</td><td style={td}>{money(r.currentQuantity)}</td><td style={td}>{money(r.standardRate)}</td><td style={td}>{money(r.value)}</td></tr>
            ))}
            {!valuation?.rows?.length && <tr><td style={td} colSpan={4}>No stock.</td></tr>}
          </tbody>
        </table>
      </section>

      <section style={card}>
        <h3 style={{ marginTop: 0, fontSize: 15 }}>Movement (total in / out)</h3>
        <table style={table}>
          <thead><tr><th style={th}>Material</th><th style={th}>Total in</th><th style={th}>Total out</th></tr></thead>
          <tbody>
            {movement.map((r, i) => (
              <tr key={i}><td style={td}>{String(r.material)}</td><td style={td}>{money(r.totalIn)}</td><td style={td}>{money(r.totalOut)}</td></tr>
            ))}
            {!movement.length && <tr><td style={td} colSpan={3}>No movement yet.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}
