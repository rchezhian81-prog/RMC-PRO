'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Building2, Package, LogOut, Menu, X, UserCog } from 'lucide-react';
import { api } from '../../lib/api';
import { clearSession, getSession } from '../../lib/session';
import { Logo } from '../../components/ui/Logo';
import { ThemeToggle } from '../../components/ui/ThemeToggle';
import { Button } from '../../components/ui/Button';
import { ConfirmProvider } from '../../components/ui/ConfirmDialog';
import { isUiV2 } from '../../lib/ui-flag';

/**
 * The platform portal's shell: the same rail, top bar and content column as
 * the company workspace, with the three platform screens in the rail and a
 * drawer on the phone. Only a super admin gets in; a company user is sent to
 * their workspace, nobody signed in to the sign-in page, and a password an
 * administrator typed to the account screen first.
 */
const NAV = [
  { href: '/admin/tenants', label: 'Companies', icon: <Building2 size={18} /> },
  { href: '/admin/plans', label: 'Plans', icon: <Package size={18} /> },
  { href: '/admin/account', label: 'My account', icon: <UserCog size={18} /> },
];

export default function AdminLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState('');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const s = getSession();
    if (!s?.token) router.replace('/login');
    else if (s.userType !== 'super_admin') router.replace('/app');
    else if (s.mustChangePassword && !pathname.startsWith('/admin/account')) router.replace('/admin/account?required=1');
    else {
      setEmail(s.email);
      setReady(true);
    }
  }, [router, pathname]);

  // The drawer closes on navigation, so a tap on a link does not leave it open.
  useEffect(() => setOpen(false), [pathname]);

  if (!ready) return null;

  const title = NAV.find((n) => pathname.startsWith(n.href))?.label ?? 'Platform';

  // The workspace mounts the same provider; without it, useConfirm() throws on
  // the first admin screen that asks a question — suspending a company does.
  return (
    <ConfirmProvider>
    <div className="mn-shell mn-admin-shell">
      <a href="#main" className="mn-skip">Skip to content</a>
      <div className={`mn-scrim ${open ? 'mn-open' : ''}`} onClick={() => setOpen(false)} aria-hidden />
      <aside className={`mn-sidebar ${open ? 'mn-open' : ''}`}>
        <div className="mn-rail-head" style={{ padding: '18px 16px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span className="mn-rail-brand"><Logo size="sm" plate /></span>
          <button className="mn-iconbtn mn-hamburger" onClick={() => setOpen(false)} aria-label="Close menu">
            <X size={18} />
          </button>
        </div>
        <div style={{ overflowY: 'auto', padding: '4px 12px 16px', flex: 1 }}>
          <div style={{ marginBottom: 6 }}>
            <span className="mn-navgroup mn-admin-navgroup" aria-hidden><span>Platform</span></span>
            <nav aria-label="Platform" style={{ display: 'grid', gap: 2 }}>
              {NAV.map((n) => {
                const active = pathname.startsWith(n.href);
                return (
                  <Link
                    key={n.href}
                    href={n.href}
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
          </div>
        </div>
      </aside>

      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <header className="mn-topbar">
          <button className="mn-iconbtn mn-hamburger" onClick={() => setOpen(true)} aria-label="Open menu">
            <Menu size={18} />
          </button>
          <div style={{ fontFamily: 'var(--mn-font-display)', fontWeight: 600, fontSize: 16 }}>{title}</div>
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
              // Clear the httpOnly refresh cookie server-side, then drop the
              // local session regardless of the network result.
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
    </div>
    </ConfirmProvider>
  );
}
