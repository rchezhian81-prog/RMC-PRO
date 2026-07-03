'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api, type PlanRow, type TenantModuleRow } from '../../../../lib/api';
import { button, card, ghostButton, input, table, td, th } from '../../../../lib/ui';

export default function TenantDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [name, setName] = useState('');
  const [planCode, setPlanCode] = useState<string | null>(null);
  const [modules, setModules] = useState<TenantModuleRow[]>([]);
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [planId, setPlanId] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    const [t, mods, pl] = await Promise.all([api.tenant(id), api.tenantModules(id), api.plans()]);
    setName(t.name);
    setPlanCode(t.planCode ?? null);
    setModules(mods);
    setPlans(pl);
  }
  useEffect(() => {
    reload().catch((e) => setError(String(e)));
  }, [id]);

  async function assign() {
    if (!planId) return;
    setError(null);
    try {
      await api.assignPlan(id, planId);
      setPlanId('');
      await reload();
    } catch (e) {
      setError(String(e));
    }
  }

  async function toggle(key: string, next: boolean) {
    setError(null);
    try {
      const updated = await api.setTenantModule(id, key, next);
      setModules(updated);
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div>
      <Link href="/admin/tenants" style={{ color: 'var(--muted)', fontSize: 13 }}>
        ← Tenants
      </Link>
      <h1 style={{ fontSize: 22, margin: '8px 0 4px' }}>{name}</h1>
      <p style={{ color: 'var(--muted)', fontSize: 14, marginTop: 0 }}>
        Current plan: {planCode ?? '— none —'}
      </p>
      {error && <p style={{ color: '#ff8080', fontSize: 13 }}>{error}</p>}

      <section style={card}>
        <h3 style={{ marginTop: 0, fontSize: 15 }}>Assign / change plan</h3>
        <div style={{ display: 'flex', gap: 10 }}>
          <select style={{ ...input, width: 220 }} value={planId} onChange={(e) => setPlanId(e.target.value)}>
            <option value="">— select plan —</option>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button style={button} onClick={assign}>
            Apply plan
          </button>
        </div>
        <p style={{ color: 'var(--muted)', fontSize: 12 }}>
          Applying a plan resets the tenant&apos;s modules to that plan&apos;s modules.
        </p>
      </section>

      <section style={card}>
        <h3 style={{ marginTop: 0, fontSize: 15 }}>Modules</h3>
        <table style={table}>
          <thead>
            <tr>
              <th style={th}>Module</th>
              <th style={th}>Phase</th>
              <th style={th}>Status</th>
              <th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {modules.map((m) => (
              <tr key={m.moduleKey}>
                <td style={td}>{m.name}</td>
                <td style={td}>P{m.phase}</td>
                <td style={{ ...td, color: m.isEnabled ? '#6ee7a8' : 'var(--muted)' }}>
                  {m.isEnabled ? 'Enabled' : 'Disabled'}
                </td>
                <td style={td}>
                  <button style={ghostButton} onClick={() => toggle(m.moduleKey, !m.isEnabled)}>
                    {m.isEnabled ? 'Disable' : 'Enable'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
