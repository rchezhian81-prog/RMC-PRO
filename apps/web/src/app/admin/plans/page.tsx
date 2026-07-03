'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { api, type ModuleRow, type PlanRow } from '../../../lib/api';
import { button, card, input, table, td, th } from '../../../lib/ui';

export default function PlansPage() {
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [catalog, setCatalog] = useState<ModuleRow[]>([]);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [price, setPrice] = useState('0');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    const [p, c] = await Promise.all([api.plans(), api.modules()]);
    setPlans(p);
    setCatalog(c);
  }
  useEffect(() => {
    reload().catch((e) => setError(String(e)));
  }, []);

  function toggleModule(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const plan = await api.createPlan({
        planCode: code,
        planName: name,
        monthlyPrice: Number(price) || 0,
      });
      if (selected.size) await api.setPlanModules(plan.id, [...selected]);
      setCode('');
      setName('');
      setPrice('0');
      setSelected(new Set());
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  }

  return (
    <div>
      <h1 style={{ fontSize: 22, marginTop: 0 }}>Subscription Plans</h1>

      <section style={card}>
        <h3 style={{ marginTop: 0, fontSize: 15 }}>New Plan</h3>
        <form onSubmit={create}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
            <div>
              <label style={{ fontSize: 12, color: 'var(--muted)' }}>Code</label>
              <input style={{ ...input, width: 140 }} value={code} onChange={(e) => setCode(e.target.value)} required />
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'var(--muted)' }}>Name</label>
              <input style={{ ...input, width: 200 }} value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'var(--muted)' }}>Monthly ₹</label>
              <input style={{ ...input, width: 120 }} type="number" value={price} onChange={(e) => setPrice(e.target.value)} />
            </div>
          </div>
          <label style={{ fontSize: 12, color: 'var(--muted)' }}>Included modules</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '8px 0 14px' }}>
            {catalog.map((m) => (
              <label
                key={m.moduleKey}
                style={{
                  display: 'flex',
                  gap: 6,
                  alignItems: 'center',
                  fontSize: 13,
                  padding: '5px 9px',
                  border: '1px solid #26314b',
                  borderRadius: 8,
                }}
              >
                <input
                  type="checkbox"
                  checked={selected.has(m.moduleKey)}
                  onChange={() => toggleModule(m.moduleKey)}
                />
                {m.name} <span style={{ color: 'var(--muted)' }}>P{m.phase}</span>
              </label>
            ))}
          </div>
          <button style={button}>Create plan</button>
        </form>
        {error && <p style={{ color: '#ff8080', fontSize: 13 }}>{error}</p>}
      </section>

      <section style={card}>
        <table style={table}>
          <thead>
            <tr>
              <th style={th}>Code</th>
              <th style={th}>Name</th>
              <th style={th}>Monthly ₹</th>
              <th style={th}>Plants</th>
              <th style={th}>Users</th>
              <th style={th}>Modules</th>
            </tr>
          </thead>
          <tbody>
            {plans.map((p) => (
              <tr key={p.id}>
                <td style={td}>{p.code}</td>
                <td style={td}>{p.name}</td>
                <td style={td}>{p.monthlyPrice}</td>
                <td style={td}>{p.maxPlants}</td>
                <td style={td}>{p.maxUsers}</td>
                <td style={td}>{p.moduleCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
