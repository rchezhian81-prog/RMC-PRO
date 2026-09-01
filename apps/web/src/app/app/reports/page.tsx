'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { reportsCatalogApi } from '../../../lib/api';
import { Card } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { ErrorState } from '../../../components/ui/States';

// Map report keys to the in-app report pages where a UI exists.
const PAGE: Record<string, string> = {
  'production-summary': '/app/production/reports',
  variance: '/app/production/reports',
  'material-consumption': '/app/production/reports',
  'material-reconciliation': '/app/production/reports',
  'low-stock': '/app/inventory/reports',
  'negative-stock': '/app/inventory/reports',
  valuation: '/app/inventory/reports',
  movement: '/app/inventory/reports',
  outstanding: '/app/billing/outstanding',
  'sales-register': '/app/billing/reports',
  'gst-summary': '/app/billing/reports',
  'grade-margin': '/app/billing/reports',
  'receipts-register': '/app/billing/reports',
  'tally-export': '/app/billing/reports',
  funnel: '/app/dashboard',
  'driver-productivity': '/app/dispatch/fleet-utilization',
  'fleet-running-cost': '/app/fleet/reports',
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
      <h1 style={{ fontSize: 24, marginTop: 0, marginBottom: 4 }}>Reports Center</h1>
      <p style={{ color: 'var(--mn-muted)', fontSize: 13, margin: '0 0 18px' }}>Phase-1 cross-module reports.</p>
      {error && <div style={{ marginBottom: 14 }}><ErrorState message={error} /></div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16, alignItems: 'start' }}>
        {groups.map((g) => (
          <Card key={g.module} title={g.module}>
            <div style={{ display: 'grid', gap: 8 }}>
              {g.reports.map((r) => {
                const page = PAGE[r.key];
                return (
                  <div key={r.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 13.5 }}>{r.name}</span>
                    {page ? (
                      <Link href={page}>
                        <Button variant="secondary" size="sm">Open</Button>
                      </Link>
                    ) : (
                      <code style={{ fontSize: 11, color: 'var(--mn-subtle)' }}>{r.path}</code>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
