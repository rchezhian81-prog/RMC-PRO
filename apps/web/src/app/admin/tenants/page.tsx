'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { api, type PlanRow, type TenantRow } from '../../../lib/api';
import { Card } from '../../../components/ui/Card';
import { Table, Th, Td } from '../../../components/ui/Table';
import { StatusBadge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Field, Input } from '../../../components/ui/Field';
import { ErrorState, EmptyState } from '../../../components/ui/States';

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
      await api.createTenant({ tenantCode: code, tenantName: name, planId: planId || undefined });
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
      <h1 style={{ fontSize: 24, marginTop: 0, marginBottom: 16 }}>Tenants</h1>

      <div style={{ marginBottom: 18 }}>
        <Card title="New tenant">
          <form onSubmit={create} style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end' }}>
            <div style={{ minWidth: 140 }}>
              <Field label="Code" required>
                <Input value={code} onChange={(e) => setCode(e.target.value)} required />
              </Field>
            </div>
            <div style={{ minWidth: 220 }}>
              <Field label="Company name" required>
                <Input value={name} onChange={(e) => setName(e.target.value)} required />
              </Field>
            </div>
            <div style={{ minWidth: 180 }}>
              <Field label="Plan (optional)">
                <select className="mn-input" value={planId} onChange={(e) => setPlanId(e.target.value)}>
                  <option value="">— none —</option>
                  {plans.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </Field>
            </div>
            <div style={{ marginBottom: 14 }}>
              <Button type="submit">Create</Button>
            </div>
          </form>
          {error && <div style={{ marginTop: 4 }}><ErrorState message={error} /></div>}
        </Card>
      </div>

      <Card title="Tenants" padded={false}>
        {tenants.length ? (
          <Table>
            <thead>
              <tr>
                <Th>Code</Th>
                <Th>Company</Th>
                <Th>Status</Th>
                <Th>Plan</Th>
                <Th numeric>Modules</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {tenants.map((t) => (
                <tr key={t.id}>
                  <Td style={{ fontWeight: 600 }}>{t.code}</Td>
                  <Td>{t.name}</Td>
                  <Td><StatusBadge status={t.status} /></Td>
                  <Td>{t.planCode ?? '—'}</Td>
                  <Td numeric>{t.enabledModules}</Td>
                  <Td style={{ textAlign: 'right' }}>
                    <Link href={`/admin/tenants/${t.id}`}>
                      <Button variant="secondary" size="sm">Manage</Button>
                    </Link>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="No tenants yet" description="Create your first tenant above." />
        )}
      </Card>
    </div>
  );
}
