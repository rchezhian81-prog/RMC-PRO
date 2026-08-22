'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  LayoutDashboard, Building2, Factory, Users, ShieldCheck, Hash, Settings, MapPin, Package,
  Store, Truck, IdCard, Layers, UserPlus, FileText, FileSignature, FilePlus, ClipboardList,
  Lock, FlaskConical, CalendarRange, ListOrdered, Ticket, Boxes, BarChart3, Receipt, PackagePlus,
  Scale, SlidersHorizontal, TrendingDown, ReceiptText, Wallet, Clock, MonitorSmartphone, LogOut, Menu, X,
  Ruler, ArrowLeftRight,
  Sparkles, UserCog, ScrollText, ShoppingCart, Wrench, Fuel, Coins, ListTree, Upload, PenLine, Navigation,
  ChevronDown, PanelLeft,
} from 'lucide-react';
import { aiApi, api } from '../../lib/api';
import { clearSession, getAccess, getSession, updateAccess } from '../../lib/session';
import { isUiV2 } from '../../lib/ui-flag';
import { Logo } from '../../components/ui/Logo';
import { ConfirmProvider } from '../../components/ui/ConfirmDialog';
import { ThemeToggle } from '../../components/ui/ThemeToggle';
import { Button } from '../../components/ui/Button';
import { OfflineBanner } from '../../components/OfflineBanner';

const IS = 18;

interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
  /**
   * Permission key required to see this item. Set it ONLY where the API
   * actually enforces that key — a hidden link the user could in fact open is
   * as misleading as a visible one that 403s. Modules whose read endpoints are
   * open to any tenant user are intentionally left ungated.
   */
  perm?: string;
  /**
   * Subscription module this screen belongs to, matching the `@RequireModule`
   * on the controller behind it. Left out when the company's plan does not
   * include it — the API would refuse every request the screen makes.
   */
  module?: string;
  /** Hidden while the AI features are switched off, so there are no dead ends. */
  ai?: boolean;
}

const GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: 'Overview',
    items: [
      { href: '/app/dashboard', label: 'Dashboard', icon: <LayoutDashboard size={IS} /> },
      { href: '/app/assistant', label: 'Assistant', icon: <Sparkles size={IS} />, ai: true },
      // Ungated on purpose: everyone must be able to change their own password.
      { href: '/app/account', label: 'My Account', icon: <UserCog size={IS} /> },
    ],
  },
  {
    title: 'Setup',
    items: [
      { href: '/app/company', label: 'Company', icon: <Building2 size={IS} />, perm: 'settings.manage' },
      { href: '/app/entity/plants', label: 'Plants', icon: <Factory size={IS} />, perm: 'masters.view', module: 'masters' },
      { href: '/app/users', label: 'Users', icon: <Users size={IS} />, perm: 'users.manage' },
      { href: '/app/roles', label: 'Roles', icon: <ShieldCheck size={IS} />, perm: 'roles.manage' },
      { href: '/app/entity/number-series', label: 'Number Series', icon: <Hash size={IS} />, perm: 'number_series.manage', module: 'masters' },
      { href: '/app/numbering', label: 'Numbering', icon: <ListOrdered size={IS} />, perm: 'sync.manage', module: 'offline_sync' },
      { href: '/app/imports', label: 'Bulk Import', icon: <Upload size={IS} />, perm: 'imports.view' },
      { href: '/app/settings', label: 'Settings', icon: <Settings size={IS} />, perm: 'settings.manage' },
    ],
  },
  {
    title: 'Masters',
    items: [
      { href: '/app/entity/customers', label: 'Customers', icon: <Building2 size={IS} />, perm: 'masters.view', module: 'masters' },
      { href: '/app/entity/sites', label: 'Sites / Projects', icon: <MapPin size={IS} />, perm: 'masters.view', module: 'masters' },
      { href: '/app/entity/materials', label: 'Materials', icon: <Package size={IS} />, perm: 'masters.view', module: 'masters' },
      { href: '/app/entity/uoms', label: 'Units (UOM)', icon: <Ruler size={IS} />, perm: 'masters.view', module: 'masters' },
      { href: '/app/entity/uom-conversions', label: 'Unit Conversions', icon: <ArrowLeftRight size={IS} />, perm: 'masters.view', module: 'masters' },
      { href: '/app/entity/suppliers', label: 'Suppliers', icon: <Store size={IS} />, perm: 'masters.view', module: 'masters' },
      { href: '/app/entity/vehicles', label: 'Vehicles', icon: <Truck size={IS} />, perm: 'masters.view', module: 'masters' },
      { href: '/app/entity/drivers', label: 'Drivers', icon: <IdCard size={IS} />, perm: 'masters.view', module: 'masters' },
      { href: '/app/entity/transporters', label: 'Transporters', icon: <Truck size={IS} />, perm: 'masters.view', module: 'masters' },
      { href: '/app/entity/concrete-grades', label: 'Grades', icon: <Layers size={IS} />, perm: 'masters.view', module: 'masters' },
    ],
  },
  {
    title: 'Sales',
    items: [
      { href: '/app/sales/leads', label: 'Leads', icon: <UserPlus size={IS} />, perm: 'leads.view', module: 'sales' },
      { href: '/app/sales/quotations', label: 'Quotations', icon: <FileText size={IS} />, perm: 'quotations.view', module: 'sales' },
      { href: '/app/sales/rate-contracts', label: 'Rate Contracts', icon: <FileSignature size={IS} />, perm: 'rate_contracts.view', module: 'sales' },
      { href: '/app/sales/order-drafts', label: 'Order Drafts', icon: <FilePlus size={IS} />, perm: 'orders.view', module: 'sales' },
      { href: '/app/sales/import-po', label: 'Import PO (AI)', icon: <Sparkles size={IS} />, perm: 'orders.create', ai: true, module: 'sales' },
    ],
  },
  {
    title: 'Orders',
    items: [
      { href: '/app/orders', label: 'Orders', icon: <ClipboardList size={IS} />, perm: 'orders.view', module: 'orders' },
      { href: '/app/credit-holds', label: 'Credit Holds', icon: <Lock size={IS} />, perm: 'credit_hold.approve', module: 'orders' },
    ],
  },
  {
    title: 'Production',
    items: [
      { href: '/app/production/mix-designs', label: 'Mix Designs', icon: <FlaskConical size={IS} />, module: 'production' },
      { href: '/app/production/plans', label: 'Production Plans', icon: <CalendarRange size={IS} />, module: 'production' },
      { href: '/app/production/batch-queue', label: 'Batch Queue', icon: <ListOrdered size={IS} />, module: 'production' },
      { href: '/app/production/batch-tickets', label: 'Batch Tickets', icon: <Ticket size={IS} />, module: 'production' },
      { href: '/app/production/stock', label: 'Stock', icon: <Boxes size={IS} />, module: 'inventory' },
      { href: '/app/production/reports', label: 'Prod. Reports', icon: <BarChart3 size={IS} />, module: 'production' },
    ],
  },
  {
    title: 'Quality (QC)',
    items: [
      { href: '/app/qc/slump', label: 'Slump Tests', icon: <FlaskConical size={IS} />, perm: 'qc.view', module: 'qc' },
      { href: '/app/qc/cubes', label: 'Cube Sets', icon: <ClipboardList size={IS} />, perm: 'qc.view', module: 'qc' },
    ],
  },
  {
    title: 'Dispatch',
    items: [
      { href: '/app/dispatch/board', label: 'Dispatch Board', icon: <Truck size={IS} />, module: 'dispatch' },
      { href: '/app/dispatch/tracking', label: 'Live Tracking', icon: <Navigation size={IS} />, perm: 'gps.view', module: 'gps' },
      { href: '/app/dispatch/challans', label: 'Delivery Challans', icon: <Receipt size={IS} />, module: 'dispatch' },
    ],
  },
  {
    title: 'Inventory',
    items: [
      { href: '/app/inventory/inward', label: 'Material Inward', icon: <PackagePlus size={IS} />, module: 'inventory' },
      { href: '/app/inventory/weighbridge', label: 'Weighbridge', icon: <Scale size={IS} />, module: 'weighbridge' },
      { href: '/app/inventory/adjustments', label: 'Stock Adjustments', icon: <SlidersHorizontal size={IS} />, module: 'inventory' },
      { href: '/app/inventory/negative-stock', label: 'Negative Stock', icon: <TrendingDown size={IS} />, module: 'inventory' },
      { href: '/app/inventory/reports', label: 'Inventory Reports', icon: <BarChart3 size={IS} />, module: 'inventory' },
    ],
  },
  {
    title: 'Purchase',
    items: [
      { href: '/app/purchase/orders', label: 'Purchase Orders', icon: <ShoppingCart size={IS} />, perm: 'purchase.view', module: 'purchase' },
      { href: '/app/purchase/bills', label: 'Vendor Bills', icon: <FileText size={IS} />, perm: 'purchase.view', module: 'purchase' },
    ],
  },
  {
    title: 'Fleet',
    items: [
      { href: '/app/fleet/maintenance', label: 'Maintenance', icon: <Wrench size={IS} />, perm: 'fleet.view', module: 'fleet' },
      { href: '/app/fleet/fuel', label: 'Fuel Log', icon: <Fuel size={IS} />, perm: 'fleet.view', module: 'fleet' },
    ],
  },
  {
    title: 'Expenses',
    items: [
      { href: '/app/expenses/vouchers', label: 'Expense Vouchers', icon: <Coins size={IS} />, perm: 'expenses.view', module: 'expenses' },
      { href: '/app/expenses/heads', label: 'Expense Heads', icon: <ListTree size={IS} />, perm: 'expenses.view', module: 'expenses' },
    ],
  },
  {
    title: 'Billing',
    items: [
      { href: '/app/billing/invoices', label: 'Invoices', icon: <ReceiptText size={IS} />, module: 'billing' },
      { href: '/app/billing/receipts', label: 'Receipts', icon: <Wallet size={IS} />, module: 'billing' },
      { href: '/app/billing/outstanding', label: 'Outstanding', icon: <Clock size={IS} />, module: 'billing' },
      { href: '/app/billing/reports', label: 'Billing Reports', icon: <BarChart3 size={IS} />, module: 'billing' },
    ],
  },
  {
    title: 'Control',
    items: [
      { href: '/app/reports', label: 'Reports Center', icon: <BarChart3 size={IS} />, module: 'reports' },
      { href: '/app/audit', label: 'Audit Trail', icon: <ScrollText size={IS} />, perm: 'audit_logs.view' },
      { href: '/app/corrections', label: 'Corrections', icon: <PenLine size={IS} />, perm: 'document_corrections.manage' },
      { href: '/app/devices', label: 'Devices & Sync', icon: <MonitorSmartphone size={IS} />, perm: 'sync.manage', module: 'offline_sync' },
    ],
  },
];

function currentLabel(pathname: string): string {
  // Exact match wins; otherwise the longest nav href that prefixes the path
  // (so detail routes like /app/billing/invoices/:id map to "Invoices").
  let best = '';
  let label = 'Dashboard';
  for (const g of GROUPS)
    for (const it of g.items) {
      if (pathname === it.href) return it.label;
      if (pathname.startsWith(it.href + '/') && it.href.length > best.length) {
        best = it.href;
        label = it.label;
      }
    }
  return label;
}

export default function AppLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [email, setEmail] = useState<string | null>(null);
  const [open, setOpen] = useState(false); // mobile drawer
  const [aiEnabled, setAiEnabled] = useState(false);
  // Bumped when the stored access changes, so the menu re-renders against it.
  const [accessVersion, setAccessVersion] = useState(0);
  // Collapsed/expanded state per nav module group (accordion).
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  // Whole-rail collapse to an icon strip (desktop); persisted per browser.
  const [railCollapsed, setRailCollapsed] = useState(false);
  useEffect(() => {
    try {
      setRailCollapsed(localStorage.getItem('mn-rail-collapsed') === '1');
    } catch {
      /* storage blocked — default expanded */
    }
  }, []);
  const toggleRail = () =>
    setRailCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem('mn-rail-collapsed', next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });

  useEffect(() => {
    const s = getSession();
    if (!s?.token) router.replace('/login');
    else if (s.userType === 'super_admin') router.replace('/admin/tenants');
    else setEmail(s.email);
  }, [router]);

  // Re-read roles, permissions and subscription modules from the server. A plan
  // upgrade or a role change otherwise stays invisible until the next sign-in,
  // which for a plant that works one long shift can be the next day.
  useEffect(() => {
    if (!email) return;
    api
      .me()
      .then((r) => {
        updateAccess({ permissions: r.permissions, roles: r.roles, modules: r.modules });
        setAccessVersion((v) => v + 1);
      })
      .catch(() => {
        // Offline or a blocked account — keep the menu we already had rather
        // than emptying it. A request the server refuses still says so.
      });
  }, [email]);

  // Ask once whether AI is switched on. Failure means "off" — the AI links stay
  // hidden rather than leading to a screen that cannot work.
  useEffect(() => {
    if (!email) return;
    aiApi
      .status()
      .then((r) => setAiEnabled(Boolean(r.enabled)))
      .catch(() => setAiEnabled(false));
  }, [email]);

  useEffect(() => {
    setOpen(false); // close drawer on navigation
  }, [pathname]);

  if (!email) return null;

  // Show only what this user can actually reach. The company owner and super
  // admin bypass permission checks, matching the server.
  void accessVersion; // recomputed whenever the stored access is refreshed
  const access = getAccess();
  const groups = GROUPS.map((g) => ({
    ...g,
    items: g.items.filter(
      (it) =>
        (!it.perm || access.has(it.perm)) &&
        // The owner bypasses permissions but not the subscription: a module
        // outside the plan is refused for them too.
        (!it.module || access.hasModule(it.module)) &&
        (!it.ai || aiEnabled),
    ),
  })).filter((g) => g.items.length > 0);

  // Collapsible module groups — only the section you're in is open by default,
  // so the (long) nav stays compact; an explicit toggle overrides that default.
  let activeGroupTitle = groups[0]?.title;
  for (const g of groups) {
    if (g.items.some((it) => pathname === it.href || pathname.startsWith(it.href + '/'))) {
      activeGroupTitle = g.title;
      break;
    }
  }
  const groupOpen = (title: string) => openGroups[title] ?? title === activeGroupTitle;
  const toggleGroup = (title: string) =>
    setOpenGroups((s) => ({ ...s, [title]: !(s[title] ?? title === activeGroupTitle) }));

  return (
    <ConfirmProvider>
    <div className={`mn-shell${railCollapsed ? ' mn-rail-collapsed' : ''}`}>
      <a href="#main" className="mn-skip">Skip to content</a>
      <div className={`mn-scrim ${open ? 'mn-open' : ''}`} onClick={() => setOpen(false)} aria-hidden />

      <aside className={`mn-sidebar ${open ? 'mn-open' : ''}`}>
        <div className="mn-rail-head" style={{ padding: '18px 16px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          {/* On V2 the sidebar is a deep-violet rail, so the logo uses its on-dark tone. */}
          <span className="mn-rail-brand"><Logo size="sm" onDark={isUiV2()} /></span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="mn-iconbtn mn-rail-toggle" onClick={toggleRail} aria-label={railCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={railCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
              <PanelLeft size={17} />
            </button>
            <button className="mn-iconbtn mn-hamburger" onClick={() => setOpen(false)} aria-label="Close menu">
              <X size={18} />
            </button>
          </div>
        </div>
        <div style={{ overflowY: 'auto', padding: '4px 12px 16px', flex: 1 }}>
          {groups.map((g) => {
            const gopen = groupOpen(g.title);
            return (
              <div key={g.title} style={{ marginBottom: 6 }}>
                <button
                  type="button"
                  className="mn-navgroup"
                  aria-expanded={gopen}
                  onClick={() => toggleGroup(g.title)}
                >
                  <span>{g.title}</span>
                  <ChevronDown size={14} className="mn-navgroup-chev" aria-hidden />
                </button>
                {(gopen || railCollapsed) && (
                  <nav aria-label={g.title} style={{ display: 'grid', gap: 2 }}>
                    {g.items.map((n) => {
                      const active = pathname === n.href || pathname.startsWith(n.href + '/');
                      return (
                        <Link
                          key={n.href}
                          href={n.href}
                          // Sidebar hovers were firing speculative RSC prefetches that
                          // intermittently 503'd under load. Real navigations never used
                          // them; disable prefetch on these low-value links.
                          prefetch={false}
                          aria-current={active ? 'page' : undefined}
                          title={n.label}
                          className={`mn-nav ${active ? 'mn-nav-active' : ''}`}
                        >
                          {n.icon}
                          <span className="mn-nav-label">{n.label}</span>
                        </Link>
                      );
                    })}
                  </nav>
                )}
              </div>
            );
          })}
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
          <span className="mn-topbar-email" style={{ fontSize: 13, color: 'var(--mn-muted)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {email}
          </span>
          <Button
            variant="ghost"
            size="sm"
            icon={<LogOut size={16} />}
            onClick={async () => {
              // Ask the server to clear the httpOnly refresh cookie; then drop
              // the local session no matter what (a network hiccup must not trap
              // the user in a session they asked to end).
              try {
                await api.logout();
              } catch {
                /* best effort */
              }
              clearSession();
              router.replace('/login');
            }}
          >
            Logout
          </Button>
        </header>
        <main id="main" className="mn-main" tabIndex={-1} style={{ maxWidth: isUiV2() ? 1760 : 1120, width: '100%', minWidth: 0 }}>
          {children}
        </main>
      </div>
      <OfflineBanner />
    </div>
    </ConfirmProvider>
  );
}
