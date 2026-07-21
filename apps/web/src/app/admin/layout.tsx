'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Building2, Package, LogOut } from 'lucide-react';
import { clearSession, getSession } from '../../lib/session';
import { Logo } from '../../components/ui/Logo';
import { ThemeToggle } from '../../components/ui/ThemeToggle';
import { Button } from '../../components/ui/Button';

const NAV = [
  { href: '/admin/tenants', label: 'Tenants', icon: <Building2 size={18} /> },
  { href: '/admin/plans', label: 'Plans', icon: <Package size={18} /> },
];

export default function AdminLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const s = getSession();
    if (!s || s.userType !== 'super_admin') router.replace('/login');
    else setReady(true);
  }, [router]);

  if (!ready) return null;

  const title = NAV.find((n) => pathname.startsWith(n.href))?.label ?? 'Super Admin';

  return (
    <div className="mn-shell">
      <aside className="mn-sidebar">
        <div style={{ padding: '18px 16px 12px' }}>
          <Logo size="sm" />
          <div style={{ fontSize: 11, color: 'var(--mn-subtle)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600, marginTop: 8 }}>
            Super Admin
          </div>
        </div>
        <nav style={{ display: 'grid', gap: 2, padding: '4px 12px', alignContent: 'start' }}>
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={`mn-nav ${pathname.startsWith(n.href) ? 'mn-nav-active' : ''}`}>
              {n.icon}
              {n.label}
            </Link>
          ))}
        </nav>
      </aside>

      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <header className="mn-topbar">
          <div style={{ fontFamily: 'var(--mn-font-display)', fontWeight: 600, fontSize: 16 }}>{title}</div>
          <div style={{ flex: 1 }} />
          <ThemeToggle />
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
