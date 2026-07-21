'use client';

import { useEffect, useState, type ReactNode } from 'react';
import {
  ClipboardList, Lock, Ticket, Truck, PackageCheck, ReceiptText, Clock, Wallet, TrendingDown,
  AlertTriangle, MonitorSmartphone, ChevronRight,
} from 'lucide-react';
import { dashboardApi, type Row } from '../../../lib/api';
import { Card } from '../../../components/ui/Card';
import { StatCard } from '../../../components/ui/StatCard';
import { Loading, ErrorState } from '../../../components/ui/States';
import type { Tone } from '../../../components/ui/Badge';

const money = (v: unknown) => '₹' + Number(v ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });
const n = (v: unknown) => Number(v ?? 0).toLocaleString('en-IN');
const pos = (v: unknown) => Number(v ?? 0) > 0;

export default function DashboardPage() {
  const [s, setS] = useState<Row | null>(null);
  const [funnel, setFunnel] = useState<Row | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([dashboardApi.summary(), dashboardApi.funnel()])
      .then(([sum, f]) => {
        setS(sum);
        setFunnel(f);
      })
      .catch((e) => setError(String(e)));
  }, []);

  if (error) return <ErrorState message={error} />;
  if (!s) return <Loading label="Loading dashboard…" />;

  const orders = s.orders as Row,
    dispatch = s.dispatch as Row,
    billing = s.billing as Row,
    inventory = s.inventory as Row,
    production = s.production as Row;

  const tiles: { label: string; value: ReactNode; icon: ReactNode; tone: Tone; href: string }[] = [
    { label: 'Confirmed orders', value: n(orders.confirmed), icon: <ClipboardList size={16} />, tone: 'success', href: '/app/orders' },
    { label: 'Credit holds pending', value: n(s.creditHoldsPending), icon: <Lock size={16} />, tone: pos(s.creditHoldsPending) ? 'warning' : 'neutral', href: '/app/credit-holds' },
    { label: 'Batch tickets', value: n(production.batchTicketsConfirmed), icon: <Ticket size={16} />, tone: 'info', href: '/app/production/batch-tickets' },
    { label: 'Dispatches active', value: n(dispatch.active), icon: <Truck size={16} />, tone: 'info', href: '/app/dispatch/board' },
    { label: 'Delivered (uninvoiced)', value: n(dispatch.uninvoiced), icon: <PackageCheck size={16} />, tone: pos(dispatch.uninvoiced) ? 'info' : 'neutral', href: '/app/billing/invoices' },
    { label: 'Invoices issued', value: n(billing.invoicesIssued), icon: <ReceiptText size={16} />, tone: 'neutral', href: '/app/billing/invoices' },
    { label: 'Outstanding', value: money(billing.outstandingTotal), icon: <Clock size={16} />, tone: pos(billing.outstandingTotal) ? 'warning' : 'neutral', href: '/app/billing/outstanding' },
    { label: 'Receipts total', value: money(billing.receiptsTotal), icon: <Wallet size={16} />, tone: 'success', href: '/app/billing/receipts' },
    { label: 'Low stock', value: n(inventory.lowStock), icon: <TrendingDown size={16} />, tone: pos(inventory.lowStock) ? 'warning' : 'neutral', href: '/app/inventory/reports' },
    { label: 'Negative stock', value: n(inventory.negativeStock), icon: <AlertTriangle size={16} />, tone: pos(inventory.negativeStock) ? 'danger' : 'neutral', href: '/app/inventory/negative-stock' },
    { label: 'Devices', value: n(s.devices), icon: <MonitorSmartphone size={16} />, tone: 'neutral', href: '/app/devices' },
  ];

  const funnelSteps: [string, unknown][] = funnel
    ? [
        ['Leads', funnel.leads],
        ['Quotations', funnel.quotations],
        ['Confirmed', funnel.ordersConfirmed],
        ['Batch tickets', funnel.batchTickets],
        ['Dispatches', funnel.dispatches],
        ['Delivered', funnel.challansDelivered],
        ['Invoiced', funnel.invoicesIssued],
      ]
    : [];

  return (
    <div>
      <h1 style={{ fontSize: 24, marginTop: 0, marginBottom: 4 }}>Dashboard</h1>
      <p style={{ margin: '0 0 22px', color: 'var(--mn-muted)', fontSize: 14 }}>
        Live operations overview — Mix Nova RMC Software
      </p>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))',
          gap: 14,
          marginBottom: 22,
        }}
      >
        {tiles.map((t) => (
          <StatCard key={t.label} label={t.label} value={t.value} icon={t.icon} tone={t.tone} href={t.href} />
        ))}
      </div>

      <Card title="Order-to-cash funnel">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {funnelSteps.map(([label, val], i) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div
                style={{
                  background: 'var(--mn-surface-2)',
                  border: '1px solid var(--mn-border)',
                  borderRadius: 'var(--mn-radius-md)',
                  padding: '10px 16px',
                  textAlign: 'center',
                  minWidth: 96,
                }}
              >
                <div style={{ fontFamily: 'var(--mn-font-display)', fontSize: 20, fontWeight: 700 }}>{n(val)}</div>
                <div style={{ fontSize: 11, color: 'var(--mn-muted)', marginTop: 2 }}>{label}</div>
              </div>
              {i < funnelSteps.length - 1 && <ChevronRight size={16} color="var(--mn-subtle)" />}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
