'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { reportsCatalogApi } from '../../../lib/api';
import { card, ghostButton } from '../../../lib/ui';

// Map report keys to the in-app report pages where a UI exists.
const PAGE: Record<string, string> = {
  'production-summary': '/app/production/reports',
  variance: '/app/production/reports',
  'material-consumption': '/app/production/reports',
  'low-stock': '/app/inventory/reports',
  'negative-stock': '/app/inventory/reports',
  valuation: '/app/inventory/reports',
  movement: '/app/inventory/reports',
  outstanding: '/app/billing/outstanding',
  'sales-register': '/app/billing/reports',
  'gst-summary': '/app/billing/reports',
  'receipts-register': '/app/billing/reports',
  'tally-export': '/app/billing/reports',
  funnel: '/app/dashboard',
};

interface Group { module: string; reports: { key: string; name: string; path: string }[] }

export default function ReportsCenterPage() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    reportsCatalogApi.catalog().then((d) => setGroups(d.groups)).catch((e) => setError(String(e)));
  }, []);

  return (
    <div>
      <h1 style={{ fontSize: 22, marginTop: 0 }}>Reports Center</h1>
      <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 0 }}>Phase-1 cross-module reports.</p>
      {error && <p style={{ color: '#ff8080', fontSize: 13 }}>{error}</p>}

      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        {groups.map((g) => (
          <section key={g.module} style={{ ...card, minWidth: 260, flex: '1 1 260px' }}>
            <h3 style={{ marginTop: 0, fontSize: 15 }}>{g.module}</h3>
            <div style={{ display: 'grid', gap: 6 }}>
              {g.reports.map((r) => {
                const page = PAGE[r.key];
                return (
                  <div key={r.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 13.5 }}>{r.name}</span>
                    {page ? (
                      <Link href={page} style={{ ...ghostButton, textDecoration: 'none' }}>Open</Link>
                    ) : (
                      <code style={{ fontSize: 11, color: 'var(--muted)' }}>{r.path}</code>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
