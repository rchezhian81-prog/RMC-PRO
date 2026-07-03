'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { dashboardApi, type Row } from '../../../lib/api';
import { card } from '../../../lib/ui';

const money = (v: unknown) => '₹' + Number(v ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });
const n = (v: unknown) => Number(v ?? 0).toLocaleString('en-IN');

function Tile({ label, value, href, accent }: { label: string; value: string; href?: string; accent?: string }) {
  const body = (
    <div style={{ ...card, margin: 0, minWidth: 150 }}>
      <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: accent ?? 'var(--text)' }}>{value}</div>
    </div>
  );
  return href ? <Link href={href} style={{ textDecoration: 'none' }}>{body}</Link> : body;
}

export default function DashboardPage() {
  const [s, setS] = useState<Row | null>(null);
  const [funnel, setFunnel] = useState<Row | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([dashboardApi.summary(), dashboardApi.funnel()])
      .then(([sum, f]) => { setS(sum); setFunnel(f); })
      .catch((e) => setError(String(e)));
  }, []);

  if (error) return <p style={{ color: '#ff8080', fontSize: 13 }}>{error}</p>;
  if (!s) return <p style={{ color: 'var(--muted)' }}>Loading…</p>;
  const orders = s.orders as Row, dispatch = s.dispatch as Row, billing = s.billing as Row, inventory = s.inventory as Row, production = s.production as Row;
  const funnelSteps = funnel ? [
    ['Leads', funnel.leads], ['Quotations', funnel.quotations], ['Confirmed orders', funnel.ordersConfirmed],
    ['Batch tickets', funnel.batchTickets], ['Dispatches', funnel.dispatches], ['Delivered', funnel.challansDelivered], ['Invoiced', funnel.invoicesIssued],
  ] : [];

  return (
    <div>
      <h1 style={{ fontSize: 22, marginTop: 0 }}>Dashboard</h1>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
        <Tile label="Confirmed orders" value={n(orders.confirmed)} href="/app/orders" accent="#6ee7a8" />
        <Tile label="Credit holds pending" value={n(s.creditHoldsPending)} href="/app/credit-holds" accent={Number(s.creditHoldsPending) > 0 ? '#e0b341' : undefined} />
        <Tile label="Batch tickets" value={n(production.batchTicketsConfirmed)} href="/app/production/batch-tickets" />
        <Tile label="Dispatches active" value={n(dispatch.active)} href="/app/dispatch/board" />
        <Tile label="Delivered (uninvoiced)" value={n(dispatch.uninvoiced)} href="/app/billing/invoices" accent={Number(dispatch.uninvoiced) > 0 ? '#8ab4ff' : undefined} />
        <Tile label="Invoices issued" value={n(billing.invoicesIssued)} href="/app/billing/invoices" />
        <Tile label="Outstanding" value={money(billing.outstandingTotal)} href="/app/billing/outstanding" accent={Number(billing.outstandingTotal) > 0 ? '#e0b341' : undefined} />
        <Tile label="Receipts total" value={money(billing.receiptsTotal)} href="/app/billing/receipts" />
        <Tile label="Low stock" value={n(inventory.lowStock)} href="/app/inventory/reports" accent={Number(inventory.lowStock) > 0 ? '#e0b341' : undefined} />
        <Tile label="Negative stock" value={n(inventory.negativeStock)} href="/app/inventory/negative-stock" accent={Number(inventory.negativeStock) > 0 ? '#ff8080' : undefined} />
        <Tile label="Devices" value={n(s.devices)} href="/app/devices" />
      </div>

      <section style={card}>
        <h3 style={{ marginTop: 0, fontSize: 15 }}>Order-to-cash funnel</h3>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'stretch' }}>
          {funnelSteps.map(([label, val], i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ background: '#0e1626', border: '1px solid #26314b', borderRadius: 8, padding: '10px 14px', textAlign: 'center', minWidth: 92 }}>
                <div style={{ fontSize: 20, fontWeight: 700 }}>{n(val)}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>{String(label)}</div>
              </div>
              {i < funnelSteps.length - 1 && <span style={{ color: 'var(--muted)' }}>→</span>}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
