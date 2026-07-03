'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { clearSession, getSession } from '../../lib/session';
import { ghostButton } from '../../lib/ui';

const NAV = [
  { href: '/admin/tenants', label: 'Tenants' },
  { href: '/admin/plans', label: 'Plans' },
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

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', minHeight: '100vh' }}>
      <aside style={{ background: '#0e1626', borderRight: '1px solid #26314b', padding: 18 }}>
        <div style={{ fontWeight: 700, marginBottom: 18 }}>🏗️ RMC Super Admin</div>
        <nav style={{ display: 'grid', gap: 6 }}>
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              style={{
                padding: '8px 10px',
                borderRadius: 8,
                textDecoration: 'none',
                color: pathname.startsWith(n.href) ? '#1a1205' : 'var(--text)',
                background: pathname.startsWith(n.href) ? 'var(--brand)' : 'transparent',
                fontSize: 14,
              }}
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <button
          style={{ ...ghostButton, marginTop: 24, width: '100%' }}
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
