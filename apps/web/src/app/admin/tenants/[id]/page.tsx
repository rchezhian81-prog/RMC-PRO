'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { api, type PlanRow, type TenantModuleRow } from '../../../../lib/api';
import { Card } from '../../../../components/ui/Card';
import { Table, Th, Td } from '../../../../components/ui/Table';
import { Badge } from '../../../../components/ui/Badge';
import { Button } from '../../../../components/ui/Button';
import { Field } from '../../../../components/ui/Field';
import { ErrorState } from '../../../../components/ui/States';

export default function TenantDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
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
    <div style={{ display: 'grid', gap: 18 }}>
      <div>
        <Button variant="ghost" size="sm" icon={<ArrowLeft size={16} />} onClick={() => router.push('/admin/tenants')}>
          Tenants
        </Button>
      </div>
      <div>
        <h1 style={{ fontSize: 24, margin: '0 0 4px' }}>{name}</h1>
        <p style={{ color: 'var(--mn-muted)', fontSize: 14, margin: 0 }}>Current plan: {planCode ?? '— none —'}</p>
      </div>
      {error && <ErrorState message={error} />}

      <Card title="Assign / change plan">
        <div style={{ display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 220 }}>
            <Field label="Plan">
              <select className="mn-input" value={planId} onChange={(e) => setPlanId(e.target.value)}>
                <option value="">— select plan —</option>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </Field>
          </div>
          <div style={{ marginBottom: 14 }}>
            <Button onClick={assign}>Apply plan</Button>
          </div>
        </div>
        <p style={{ color: 'var(--mn-muted)', fontSize: 12, margin: 0 }}>
          Applying a plan resets the tenant&apos;s modules to that plan&apos;s modules.
        </p>
      </Card>

      <Card title="Modules" padded={false}>
        <Table>
          <thead>
            <tr>
              <Th>Module</Th>
              <Th>Phase</Th>
              <Th>Status</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {modules.map((m) => (
              <tr key={m.moduleKey}>
                <Td style={{ fontWeight: 600 }}>{m.name}</Td>
                <Td>P{m.phase}</Td>
                <Td>{m.isEnabled ? <Badge tone="success">Enabled</Badge> : <Badge tone="neutral">Disabled</Badge>}</Td>
                <Td style={{ textAlign: 'right' }}>
                  <Button variant="secondary" size="sm" onClick={() => toggle(m.moduleKey, !m.isEnabled)}>
                    {m.isEnabled ? 'Disable' : 'Enable'}
                  </Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
