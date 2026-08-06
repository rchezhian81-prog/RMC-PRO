'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { TENANT_USABLE_STATUSES } from '@rmc/shared';
import { api, type PlanRow, type TenantModuleRow, type TenantUserRow } from '../../../../lib/api';
import { Card } from '../../../../components/ui/Card';
import { Table, Th, Td } from '../../../../components/ui/Table';
import { Badge, StatusBadge } from '../../../../components/ui/Badge';
import { Button } from '../../../../components/ui/Button';
import { Field } from '../../../../components/ui/Field';
import { ErrorState } from '../../../../components/ui/States';

/** Every status the platform can set, worded as an outcome rather than a flag. */
const STATUS_OPTIONS = [
  { value: 'trial', label: 'Trial — full access, not paying yet' },
  { value: 'active', label: 'Active — paying, full access' },
  { value: 'grace', label: 'Grace — payment overdue, still working' },
  { value: 'suspended', label: 'Suspended — blocked, can be restored' },
  { value: 'cancelled', label: 'Cancelled — blocked, subscription ended' },
];

export default function TenantDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [name, setName] = useState('');
  const [status, setStatus] = useState('');
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
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    const [t, mods, pl, us] = await Promise.all([
      api.tenant(id),
      api.tenantModules(id),
      api.plans(),
      api.tenantUsers(id),
    ]);
    setName(t.name);
    setStatus(t.status);
    setPlanCode(t.planCode ?? null);
    setModules(mods);
    setPlans(pl);
    setUsers(us);
  }
  useEffect(() => {
    reload().catch((e) => setError(String(e)));
  }, [id]);

  /**
   * Change what the company is allowed to do. Suspending is the one action here
   * that stops a plant mid-shift, so it is confirmed rather than applied on the
   * first click.
   */
  async function changeStatus(next: string) {
    if (next === status) return;
    if (!TENANT_USABLE_STATUSES.includes(next as never)) {
      const ok = confirm(
        `Set ${name} to "${next}"?\n\nEveryone at this company is signed out immediately and cannot sign in again until you restore it.`,
      );
      if (!ok) return;
    }
    setError(null);
    setStatusMsg(null);
    try {
      await api.updateTenant(id, { status: next });
      setStatus(next);
      setStatusMsg(
        TENANT_USABLE_STATUSES.includes(next as never)
          ? `${name} can use Mix Nova again.`
          : `${name} is now ${next}. Their sessions stop working within a minute.`,
      );
    } catch (e) {
      setError(String(e));
    }
  }

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
        <h1 style={{ fontSize: 24, margin: '0 0 4px', display: 'flex', alignItems: 'center', gap: 10 }}>
          {name}
          {status && <StatusBadge status={status} />}
        </h1>
        <p style={{ color: 'var(--mn-muted)', fontSize: 14, margin: 0 }}>Current plan: {planCode ?? '— none —'}</p>
      </div>
      {error && <ErrorState message={error} />}

      <Card title="Subscription status">
        <div style={{ display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 220 }}>
            <Field label="Status">
              <select className="mn-input" value={status} onChange={(e) => changeStatus(e.target.value)}>
                {STATUS_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </Field>
          </div>
        </div>
        <p style={{ color: 'var(--mn-muted)', fontSize: 12, margin: 0 }}>
          Trial, Active and Grace can all use the system — a late payment does not strand a plant
          mid-pour. Suspended and Cancelled block every user of this company, including their
          company owner.
        </p>
        {statusMsg && <p style={{ color: 'var(--mn-success)', fontSize: 13, margin: '10px 0 0' }}>{statusMsg}</p>}
      </Card>

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
