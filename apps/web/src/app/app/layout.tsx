'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { clearSession, getSession } from '../../lib/session';
import { ghostButton } from '../../lib/ui';
import { Logo } from '../../components/ui/Logo';

const GROUPS = [
  {
    title: 'Overview',
    items: [
      { href: '/app/dashboard', label: 'Dashboard' },
    ],
  },
  {
    title: 'Setup',
    items: [
      { href: '/app/company', label: 'Company' },
      { href: '/app/entity/plants', label: 'Plants' },
      { href: '/app/users', label: 'Users' },
      { href: '/app/roles', label: 'Roles' },
      { href: '/app/entity/number-series', label: 'Number Series' },
      { href: '/app/settings', label: 'Settings' },
    ],
  },
  {
    title: 'Masters',
    items: [
      { href: '/app/entity/customers', label: 'Customers' },
      { href: '/app/entity/sites', label: 'Sites / Projects' },
      { href: '/app/entity/materials', label: 'Materials' },
      { href: '/app/entity/suppliers', label: 'Suppliers' },
      { href: '/app/entity/vehicles', label: 'Vehicles' },
      { href: '/app/entity/drivers', label: 'Drivers' },
      { href: '/app/entity/concrete-grades', label: 'Grades' },
    ],
  },
  {
    title: 'Sales',
    items: [
      { href: '/app/sales/leads', label: 'Leads' },
      { href: '/app/sales/quotations', label: 'Quotations' },
      { href: '/app/sales/rate-contracts', label: 'Rate Contracts' },
      { href: '/app/sales/order-drafts', label: 'Order Drafts' },
    ],
  },
  {
    title: 'Orders',
    items: [
      { href: '/app/orders', label: 'Orders' },
      { href: '/app/credit-holds', label: 'Credit Holds' },
    ],
  },
  {
    title: 'Production',
    items: [
      { href: '/app/production/mix-designs', label: 'Mix Designs' },
      { href: '/app/production/plans', label: 'Production Plans' },
      { href: '/app/production/batch-queue', label: 'Batch Queue' },
      { href: '/app/production/batch-tickets', label: 'Batch Tickets' },
      { href: '/app/production/stock', label: 'Stock' },
      { href: '/app/production/reports', label: 'Prod. Reports' },
    ],
  },
  {
    title: 'Dispatch',
    items: [
      { href: '/app/dispatch/board', label: 'Dispatch Board' },
      { href: '/app/dispatch/challans', label: 'Delivery Challans' },
    ],
  },
  {
    title: 'Inventory',
    items: [
      { href: '/app/inventory/inward', label: 'Material Inward' },
      { href: '/app/inventory/weighbridge', label: 'Weighbridge' },
      { href: '/app/inventory/adjustments', label: 'Stock Adjustments' },
      { href: '/app/inventory/negative-stock', label: 'Negative Stock' },
      { href: '/app/inventory/reports', label: 'Inventory Reports' },
    ],
  },
  {
    title: 'Billing',
    items: [
      { href: '/app/billing/invoices', label: 'Invoices' },
      { href: '/app/billing/receipts', label: 'Receipts' },
      { href: '/app/billing/outstanding', label: 'Outstanding' },
      { href: '/app/billing/reports', label: 'Billing Reports' },
    ],
  },
  {
    title: 'Control',
    items: [
      { href: '/app/reports', label: 'Reports Center' },
      { href: '/app/devices', label: 'Devices & Sync' },
    ],
  },
];

export default function AppLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    const s = getSession();
    if (!s?.token) router.replace('/login');
    else if (s.userType === 'super_admin') router.replace('/admin/tenants');
    else setEmail(s.email);
  }, [router]);

  if (!email) return null;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '230px 1fr', minHeight: '100vh' }}>
      <aside style={{ background: '#0e1626', borderRight: '1px solid #26314b', padding: 18 }}>
        <div style={{ marginBottom: 6 }}>
          <Logo size="sm" onDark />
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 16 }}>{email}</div>
        {GROUPS.map((g) => (
          <div key={g.title} style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 6 }}>
              {g.title}
            </div>
            <nav style={{ display: 'grid', gap: 3 }}>
              {g.items.map((n) => {
                const active = pathname === n.href;
                return (
                  <Link
                    key={n.href}
                    href={n.href}
                    style={{
                      padding: '6px 9px',
                      borderRadius: 7,
                      textDecoration: 'none',
                      fontSize: 13.5,
                      color: active ? 'var(--brand-contrast)' : 'var(--text)',
                      background: active ? 'var(--brand)' : 'transparent',
                    }}
                  >
                    {n.label}
                  </Link>
                );
              })}
            </nav>
          </div>
        ))}
        <button
          style={{ ...ghostButton, width: '100%', marginTop: 8 }}
          onClick={() => {
            clearSession();
            router.replace('/login');
          }}
        >
          Logout
        </button>
      </aside>
      <main style={{ padding: 28, maxWidth: 1000 }}>{children}</main>
    </div>
  );
}
