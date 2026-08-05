'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { api, type PlanRow, type TenantModuleRow, type TenantUserRow } from '../../../../lib/api';
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
  const [users, setUsers] = useState<TenantUserRow[]>([]);
  const [uName, setUName] = useState('');
  const [uEmail, setUEmail] = useState('');
  const [uPassword, setUPassword] = useState('');
  const [creating, setCreating] = useState(false);
  const [userMsg, setUserMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    const [t, mods, pl, us] = await Promise.all([
      api.tenant(id),
      api.tenantModules(id),
      api.plans(),
      api.tenantUsers(id),
    ]);
    setName(t.name);
    setPlanCode(t.planCode ?? null);
    setModules(mods);
    setPlans(pl);
    setUsers(us);
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

  async function createUser() {
    if (uName.trim().length < 2 || !uEmail.includes('@') || uPassword.length < 8) {
      setError('Enter a name, a valid email, and a password of at least 8 characters.');
      return;
    }
    setError(null);
    setUserMsg(null);
    setCreating(true);
    try {
      await api.createTenantUser(id, { name: uName.trim(), email: uEmail.trim(), password: uPassword });
      setUserMsg(`User ${uEmail.trim()} created — share the login with them securely.`);
      setUName('');
      setUEmail('');
      setUPassword('');
      await reload();
    } catch (e) {
      setError(String(e));
    } finally {
      setCreating(false);
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

      <Card title="Users">
        {users.length > 0 ? (
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Email</Th>
                <Th>Type</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <Td style={{ fontWeight: 600 }}>{u.name}</Td>
                  <Td>{u.email}</Td>
                  <Td>{u.userType}</Td>
                  <Td>
                    {u.status === 'active' ? (
                      <Badge tone="success">Active</Badge>
                    ) : (
                      <Badge tone="neutral">{u.status}</Badge>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <p style={{ color: 'var(--mn-muted)', fontSize: 13, margin: '0 0 4px' }}>
            No users yet. Create the first login for this plant below — they get the Company
            Owner role (full access) and can add the rest of the team from inside the portal.
          </p>
        )}

        <div style={{ display: 'grid', gap: 12, maxWidth: 440, marginTop: 16 }}>
          <Field label="Full name">
            <input className="mn-input" value={uName} onChange={(e) => setUName(e.target.value)} placeholder="e.g. Plant Manager" />
          </Field>
          <Field label="Email (their login)">
            <input className="mn-input" type="email" value={uEmail} onChange={(e) => setUEmail(e.target.value)} placeholder="name@company.com" />
          </Field>
          <Field label="Temporary password (≥ 8 characters)">
            <input className="mn-input" value={uPassword} onChange={(e) => setUPassword(e.target.value)} placeholder="share this with them, then have them change it" />
          </Field>
          <div>
            <Button onClick={createUser} loading={creating}>Create user</Button>
          </div>
          {userMsg && <p style={{ color: 'var(--mn-success)', fontSize: 13, margin: 0 }}>{userMsg}</p>}
        </div>
      </Card>
    </div>
  );
}
