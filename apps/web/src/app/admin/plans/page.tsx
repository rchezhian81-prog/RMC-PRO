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
      const plan = await api.createPlan({ planCode: code, planName: name, monthlyPrice: Number(price) || 0 });
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
      <h1 style={{ fontSize: 24, marginTop: 0, marginBottom: 16 }}>Subscription Plans</h1>

      <div style={{ marginBottom: 18 }}>
        <Card title="New plan">
          <Form onSubmit={create}>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end' }}>
              <div style={{ minWidth: 140 }}>
                <Field label="Code" required>
                  <Input value={code} onChange={(e) => setCode(e.target.value)} required />
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
            <Button type="submit">Create plan</Button>
          </Form>
          {error && <div style={{ marginTop: 12 }}><ErrorState message={error} /></div>}
        </Card>
      </div>

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
              </tr>
            </thead>
            <tbody>
              {plans.map((p) => (
                <tr key={p.id}>
                  <Td style={{ fontWeight: 600 }}>{p.code}</Td>
                  <Td>{p.name}</Td>
                  <Td numeric>{p.monthlyPrice}</Td>
                  <Td numeric>{p.maxPlants}</Td>
                  <Td numeric>{p.maxUsers}</Td>
                  <Td numeric>{p.moduleCount}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="No plans yet" description="Create your first subscription plan above." />
        )}
      </Card>
    </div>
  );
}
