'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { api, type PlanRow, type TenantRow } from '../../../lib/api';
import { button, card, input, table, td, th } from '../../../lib/ui';

export default function TenantsPage() {
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [planId, setPlanId] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    const [t, p] = await Promise.all([api.tenants(), api.plans()]);
    setTenants(t);
    setPlans(p);
  }
  useEffect(() => {
    reload().catch((e) => setError(String(e)));
  }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.createTenant({
        tenantCode: code,
        tenantName: name,
        planId: planId || undefined,
      });
      setCode('');
      setName('');
      setPlanId('');
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  }

  return (
    <div>
      <h1 style={{ fontSize: 22, marginTop: 0 }}>Tenants</h1>

      <section style={card}>
        <h3 style={{ marginTop: 0, fontSize: 15 }}>New Tenant</h3>
        <form onSubmit={create} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'end' }}>
          <div>
            <label style={{ fontSize: 12, color: 'var(--muted)' }}>Code</label>
            <input style={{ ...input, width: 140 }} value={code} onChange={(e) => setCode(e.target.value)} required />
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--muted)' }}>Company name</label>
            <input style={{ ...input, width: 220 }} value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--muted)' }}>Plan (optional)</label>
            <select style={{ ...input, width: 180 }} value={planId} onChange={(e) => setPlanId(e.target.value)}>
              <option value="">— none —</option>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <button style={button}>Create</button>
        </form>
        {error && <p style={{ color: '#ff8080', fontSize: 13 }}>{error}</p>}
      </section>

      <section style={card}>
        <table style={table}>
          <thead>
            <tr>
              <th style={th}>Code</th>
              <th style={th}>Company</th>
              <th style={th}>Status</th>
              <th style={th}>Plan</th>
              <th style={th}>Modules</th>
              <th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {tenants.map((t) => (
              <tr key={t.id}>
                <td style={td}>{t.code}</td>
                <td style={td}>{t.name}</td>
                <td style={td}>{t.status}</td>
                <td style={td}>{t.planCode ?? '—'}</td>
                <td style={td}>{t.enabledModules}</td>
                <td style={td}>
                  <Link href={`/admin/tenants/${t.id}`} style={{ color: 'var(--brand)' }}>
                    Manage →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
