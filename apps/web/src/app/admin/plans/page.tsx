'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { api, type ModuleRow, type PlanRow } from '../../../lib/api';
import { Card } from '../../../components/ui/Card';
import { Table, Th, Td } from '../../../components/ui/Table';
import { Button } from '../../../components/ui/Button';
import { Form } from '../../../components/ui/Form';
import { Field, Input } from '../../../components/ui/Field';
import { ErrorState, EmptyState } from '../../../components/ui/States';

export default function PlansPage() {
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [catalog, setCatalog] = useState<ModuleRow[]>([]);
  const [editId, setEditId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [price, setPrice] = useState('0');
  const [yearly, setYearly] = useState('');
  const [maxPlants, setMaxPlants] = useState('');
  const [maxUsers, setMaxUsers] = useState('');
  const [active, setActive] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  function resetForm() {
    setEditId(null);
    setCode('');
    setName('');
    setPrice('0');
    setYearly('');
    setMaxPlants('');
    setMaxUsers('');
    setActive(true);
    setSelected(new Set());
  }

  async function startEdit(id: string) {
    setError(null);
    try {
      const p = await api.getPlan(id);
      setEditId(p.id);
      setCode(p.code);
      setName(p.name);
      setPrice(String(p.monthlyPrice ?? 0));
      setYearly(p.yearlyPrice ? String(p.yearlyPrice) : '');
      setMaxPlants(String(p.maxPlants ?? ''));
      setMaxUsers(String(p.maxUsers ?? ''));
      setActive(p.isActive);
      setSelected(new Set(p.modules));
      if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      setError(String(e));
    }
  }

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

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      // Caps are optional: send only when filled so the server keeps its own
      // defaults (plants→1, users→5) rather than us forcing a value.
      const caps = {
        ...(yearly.trim() ? { yearlyPrice: Number(yearly) || 0 } : {}),
        ...(maxPlants.trim() ? { maxPlants: Number(maxPlants) } : {}),
        ...(maxUsers.trim() ? { maxUsers: Number(maxUsers) } : {}),
      };
      if (editId) {
        // Code is the plan's immutable key, so it is not sent on edit.
        await api.updatePlan(editId, { planName: name, monthlyPrice: Number(price) || 0, isActive: active, ...caps });
        await api.setPlanModules(editId, [...selected]);
      } else {
        const plan = await api.createPlan({ planCode: code, planName: name, monthlyPrice: Number(price) || 0, ...caps });
        if (selected.size) await api.setPlanModules(plan.id, [...selected]);
      }
      resetForm();
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  }

  return (
    <div>
      <h1 style={{ fontSize: 24, marginTop: 0, marginBottom: 16 }}>Subscription Plans</h1>

      <div className="mn-crud mn-crud--wide">
        <div className="mn-crud-aside">
        <Card title={editId ? `Edit plan — ${code}` : 'New plan'}>
          <Form onSubmit={submit}>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end' }}>
              <div style={{ minWidth: 140 }}>
                <Field label="Code" required help={editId ? 'Code is fixed once created' : undefined}>
                  <Input value={code} onChange={(e) => setCode(e.target.value)} required disabled={!!editId} />
                </Field>
              </div>
              <div style={{ minWidth: 200 }}>
                <Field label="Name" required>
                  <Input value={name} onChange={(e) => setName(e.target.value)} required />
                </Field>
              </div>
              <div style={{ minWidth: 120 }}>
                <Field label="Monthly ₹">
                  <Input type="number" value={price} onChange={(e) => setPrice(e.target.value)} />
                </Field>
              </div>
              <div style={{ minWidth: 120 }}>
                <Field label="Yearly ₹">
                  <Input type="number" value={yearly} onChange={(e) => setYearly(e.target.value)} placeholder="0" />
                </Field>
              </div>
              <div style={{ minWidth: 110 }}>
                <Field label="Max plants" help="Blank = 1">
                  <Input type="number" min={1} value={maxPlants} onChange={(e) => setMaxPlants(e.target.value)} placeholder="1" />
                </Field>
              </div>
              <div style={{ minWidth: 110 }}>
                <Field label="Max users" help="Blank = 5">
                  <Input type="number" min={1} value={maxUsers} onChange={(e) => setMaxUsers(e.target.value)} placeholder="5" />
                </Field>
              </div>
              {editId && (
                <div style={{ minWidth: 110 }}>
                  <Field label="Active">
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, height: 38, cursor: 'pointer' }}>
                      <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} style={{ width: 16, height: 16, accentColor: 'var(--mn-primary)' }} />
                      <span style={{ fontSize: 13, color: 'var(--mn-muted)' }}>{active ? 'Yes' : 'No'}</span>
                    </label>
                  </Field>
                </div>
              )}
            </div>
            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--mn-muted)', margin: '4px 0 8px' }}>Included modules</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
              {catalog.map((m) => {
                const on = selected.has(m.moduleKey);
                return (
                  <label
                    key={m.moduleKey}
                    style={{
                      display: 'flex',
                      gap: 6,
                      alignItems: 'center',
                      fontSize: 13,
                      padding: '5px 11px',
                      border: `1px solid ${on ? 'var(--mn-primary)' : 'var(--mn-border)'}`,
                      background: on ? 'var(--mn-purple-50)' : 'var(--mn-surface)',
                      color: on ? 'var(--mn-primary)' : 'var(--mn-text)',
                      borderRadius: 'var(--mn-radius-pill)',
                      cursor: 'pointer',
                    }}
                  >
                    <input type="checkbox" checked={on} onChange={() => toggleModule(m.moduleKey)} />
                    {m.name} <span style={{ opacity: 0.7 }}>P{m.phase}</span>
                  </label>
                );
              })}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button type="submit">{editId ? 'Save changes' : 'Create plan'}</Button>
              {editId && (
                <Button type="button" variant="secondary" onClick={resetForm}>Cancel</Button>
              )}
            </div>
          </Form>
          {error && <div style={{ marginTop: 12 }}><ErrorState message={error} /></div>}
        </Card>
        </div>
        <div className="mn-crud-main">
      <Card title="Plans" padded={false}>
        {plans.length ? (
          <Table>
            <thead>
              <tr>
                <Th>Code</Th>
                <Th>Name</Th>
                <Th numeric>Monthly ₹</Th>
                <Th numeric>Plants</Th>
                <Th numeric>Users</Th>
                <Th numeric>Modules</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {plans.map((p) => (
                <tr key={p.id} style={editId === p.id ? { background: 'var(--mn-purple-50)' } : undefined}>
                  <Td style={{ fontWeight: 600 }}>{p.code}</Td>
                  <Td>{p.name}</Td>
                  <Td numeric>{p.monthlyPrice}</Td>
                  <Td numeric>{p.maxPlants}</Td>
                  <Td numeric>{p.maxUsers}</Td>
                  <Td numeric>{p.moduleCount}</Td>
                  <Td style={{ textAlign: 'right' }}>
                    <Button variant="ghost" size="sm" onClick={() => startEdit(p.id)}>Edit</Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="No plans yet" description="Create your first subscription plan above." />
        )}
      </Card>
        </div>
      </div>
    </div>
  );
}
