'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  LayoutDashboard, Building2, Factory, Users, ShieldCheck, Hash, Settings, MapPin, Package,
  Store, Truck, IdCard, Layers, UserPlus, FileText, FileSignature, FilePlus, ClipboardList,
  Lock, FlaskConical, CalendarRange, ListOrdered, Ticket, Boxes, BarChart3, Receipt, PackagePlus,
  Scale, SlidersHorizontal, TrendingDown, ReceiptText, Wallet, Clock, MonitorSmartphone, LogOut, Menu, X,
} from 'lucide-react';
import { clearSession, getSession } from '../../lib/session';
import { Logo } from '../../components/ui/Logo';
import { ThemeToggle } from '../../components/ui/ThemeToggle';
import { Button } from '../../components/ui/Button';

const IS = 18;
const GROUPS: { title: string; items: { href: string; label: string; icon: ReactNode }[] }[] = [
  { title: 'Overview', items: [{ href: '/app/dashboard', label: 'Dashboard', icon: <LayoutDashboard size={IS} /> }] },
  {
    title: 'Setup',
    items: [
      { href: '/app/company', label: 'Company', icon: <Building2 size={IS} /> },
      { href: '/app/entity/plants', label: 'Plants', icon: <Factory size={IS} /> },
      { href: '/app/users', label: 'Users', icon: <Users size={IS} /> },
      { href: '/app/roles', label: 'Roles', icon: <ShieldCheck size={IS} /> },
      { href: '/app/entity/number-series', label: 'Number Series', icon: <Hash size={IS} /> },
      { href: '/app/settings', label: 'Settings', icon: <Settings size={IS} /> },
    ],
  },
  {
    title: 'Masters',
    items: [
      { href: '/app/entity/customers', label: 'Customers', icon: <Building2 size={IS} /> },
      { href: '/app/entity/sites', label: 'Sites / Projects', icon: <MapPin size={IS} /> },
      { href: '/app/entity/materials', label: 'Materials', icon: <Package size={IS} /> },
      { href: '/app/entity/suppliers', label: 'Suppliers', icon: <Store size={IS} /> },
      { href: '/app/entity/vehicles', label: 'Vehicles', icon: <Truck size={IS} /> },
      { href: '/app/entity/drivers', label: 'Drivers', icon: <IdCard size={IS} /> },
      { href: '/app/entity/concrete-grades', label: 'Grades', icon: <Layers size={IS} /> },
    ],
  },
  {
    title: 'Sales',
    items: [
      { href: '/app/sales/leads', label: 'Leads', icon: <UserPlus size={IS} /> },
      { href: '/app/sales/quotations', label: 'Quotations', icon: <FileText size={IS} /> },
      { href: '/app/sales/rate-contracts', label: 'Rate Contracts', icon: <FileSignature size={IS} /> },
      { href: '/app/sales/order-drafts', label: 'Order Drafts', icon: <FilePlus size={IS} /> },
    ],
  },
  {
    title: 'Orders',
    items: [
      { href: '/app/orders', label: 'Orders', icon: <ClipboardList size={IS} /> },
      { href: '/app/credit-holds', label: 'Credit Holds', icon: <Lock size={IS} /> },
    ],
  },
  {
    title: 'Production',
    items: [
      { href: '/app/production/mix-designs', label: 'Mix Designs', icon: <FlaskConical size={IS} /> },
      { href: '/app/production/plans', label: 'Production Plans', icon: <CalendarRange size={IS} /> },
      { href: '/app/production/batch-queue', label: 'Batch Queue', icon: <ListOrdered size={IS} /> },
      { href: '/app/production/batch-tickets', label: 'Batch Tickets', icon: <Ticket size={IS} /> },
      { href: '/app/production/stock', label: 'Stock', icon: <Boxes size={IS} /> },
      { href: '/app/production/reports', label: 'Prod. Reports', icon: <BarChart3 size={IS} /> },
    ],
  },
  {
    title: 'Dispatch',
    items: [
      { href: '/app/dispatch/board', label: 'Dispatch Board', icon: <Truck size={IS} /> },
      { href: '/app/dispatch/challans', label: 'Delivery Challans', icon: <Receipt size={IS} /> },
    ],
  },
  {
    title: 'Inventory',
    items: [
      { href: '/app/inventory/inward', label: 'Material Inward', icon: <PackagePlus size={IS} /> },
      { href: '/app/inventory/weighbridge', label: 'Weighbridge', icon: <Scale size={IS} /> },
      { href: '/app/inventory/adjustments', label: 'Stock Adjustments', icon: <SlidersHorizontal size={IS} /> },
      { href: '/app/inventory/negative-stock', label: 'Negative Stock', icon: <TrendingDown size={IS} /> },
      { href: '/app/inventory/reports', label: 'Inventory Reports', icon: <BarChart3 size={IS} /> },
    ],
  },
  {
    title: 'Billing',
    items: [
      { href: '/app/billing/invoices', label: 'Invoices', icon: <ReceiptText size={IS} /> },
      { href: '/app/billing/receipts', label: 'Receipts', icon: <Wallet size={IS} /> },
      { href: '/app/billing/outstanding', label: 'Outstanding', icon: <Clock size={IS} /> },
      { href: '/app/billing/reports', label: 'Billing Reports', icon: <BarChart3 size={IS} /> },
    ],
  },
  {
    title: 'Control',
    items: [
      { href: '/app/reports', label: 'Reports Center', icon: <BarChart3 size={IS} /> },
      { href: '/app/devices', label: 'Devices & Sync', icon: <MonitorSmartphone size={IS} /> },
    ],
  },
];

function currentLabel(pathname: string): string {
  for (const g of GROUPS) for (const it of g.items) if (pathname === it.href) return it.label;
  if (pathname.startsWith('/app/orders')) return 'Orders';
  return 'Dashboard';
}

export default function AppLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [email, setEmail] = useState<string | null>(null);
  const [open, setOpen] = useState(false); // mobile drawer

  useEffect(() => {
    const s = getSession();
    if (!s?.token) router.replace('/login');
    else if (s.userType === 'super_admin') router.replace('/admin/tenants');
    else setEmail(s.email);
  }, [router]);

  useEffect(() => {
    setOpen(false); // close drawer on navigation
  }, [pathname]);

  if (!email) return null;

  return (
    <div className="mn-shell">
      <div className={`mn-scrim ${open ? 'mn-open' : ''}`} onClick={() => setOpen(false)} />

      <aside className={`mn-sidebar ${open ? 'mn-open' : ''}`}>
        <div style={{ padding: '18px 16px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Logo size="sm" />
          <button className="mn-iconbtn mn-hamburger" onClick={() => setOpen(false)} aria-label="Close menu">
            <X size={18} />
          </button>
        </div>
        <div style={{ overflowY: 'auto', padding: '4px 12px 16px', flex: 1 }}>
          {GROUPS.map((g) => (
            <div key={g.title} style={{ marginBottom: 14 }}>
              <div
                style={{
                  fontSize: 11,
                  color: 'var(--mn-subtle)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  fontWeight: 600,
                  margin: '4px 8px 6px',
                }}
              >
                {g.title}
              </div>
              <nav style={{ display: 'grid', gap: 2 }}>
                {g.items.map((n) => (
                  <Link key={n.href} href={n.href} className={`mn-nav ${pathname === n.href ? 'mn-nav-active' : ''}`}>
                    {n.icon}
                    {n.label}
                  </Link>
                ))}
              </nav>
            </div>
          ))}
        </div>
      </aside>

      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <header className="mn-topbar">
          <button className="mn-iconbtn mn-hamburger" onClick={() => setOpen(true)} aria-label="Open menu">
            <Menu size={18} />
          </button>
          <div style={{ fontFamily: 'var(--mn-font-display)', fontWeight: 600, fontSize: 16 }}>
            {currentLabel(pathname)}
          </div>
          <div style={{ flex: 1 }} />
          <ThemeToggle />
          <span style={{ fontSize: 13, color: 'var(--mn-muted)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {email}
          </span>
          <Button
            variant="ghost"
            size="sm"
            icon={<LogOut size={16} />}
            onClick={() => {
              clearSession();
              router.replace('/login');
            }}
          >
            Logout
          </Button>
        </header>
        <main style={{ padding: 28, maxWidth: 1120, width: '100%' }}>{children}</main>
      </div>
    </div>
  );
}
