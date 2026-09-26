'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Building2, Download, RefreshCw, Users, KeyRound, Package, ShieldOff, AlertTriangle, UserPlus, Save, ToggleLeft, Factory, Layers } from 'lucide-react';
import { TENANT_USABLE_STATUSES, PASSWORD_MIN_LENGTH, passwordProblems } from '@rmc/shared';
import { api, type PlanRow, type PlanUsage, type TenantModuleRow, type TenantUserRow } from '../../../../lib/api';
import { Card } from '../../../../components/ui/Card';
import { Badge, StatusBadge } from '../../../../components/ui/Badge';
import { StatCard } from '../../../../components/ui/StatCard';
import { Button } from '../../../../components/ui/Button';
import { Form } from '../../../../components/ui/Form';
import { Field, Input, Select } from '../../../../components/ui/Field';
import { PasswordInput } from '../../../../components/ui/PasswordInput';
import { ErrorState, EmptyState } from '../../../../components/ui/States';
import { useConfirm } from '../../../../components/ui/ConfirmDialog';
import { todayLocal } from '../../../../lib/report-range';
import { formatDate, formatDateTime } from '../../../../lib/format-date';

/**
 * One company, on the document-detail bones: the header names it with its
 * status and the facts support needs first (code, plan, since when, seats
 * and plants in use); notes flag what is wrong (blocked, no plan, no login,
 * seats full); five tiles; then the subscription and plan, the modules as
 * switches, and the people with a new-password and off/on lever on each.
 * The side column holds the company's name and legal name, and offboarding.
 */
const STATUS_OPTIONS = [
  { value: 'trial', label: 'Trial — full access, not paying yet' },
  { value: 'active', label: 'Active — paying, full access' },
  { value: 'grace', label: 'Grace — payment overdue, still working' },
  { value: 'suspended', label: 'Suspended — blocked, can be restored' },
  { value: 'cancelled', label: 'Cancelled — blocked, subscription ended' },
];
const usable = (status: string) => TENANT_USABLE_STATUSES.includes(status as never);
const describe = (u: { used: number; limit: number | null }, noun: string) =>
  u.limit === null ? `${u.used} ${noun}${u.used === 1 ? '' : 's'}` : `${u.used} of ${u.limit} ${noun}${u.limit === 1 ? '' : 's'}`;
const roleLabel = (r: string | null) => (r ? r.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : 'No role');

export default function TenantDetailPage() {
  const { confirm, prompt } = useConfirm();
  const { id } = useParams<{ id: string }>();
  const [name, setName] = useState('');
  const [legalName, setLegalName] = useState('');
  const [code, setCode] = useState('');
  const [status, setStatus] = useState('');
  const [planCode, setPlanCode] = useState<string | null>(null);
  const [usage, setUsage] = useState<PlanUsage | null>(null);
  const [modules, setModules] = useState<TenantModuleRow[]>([]);
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [planId, setPlanId] = useState('');
  const [users, setUsers] = useState<TenantUserRow[]>([]);
  const [createdAt, setCreatedAt] = useState<string | null>(null);
  const [showUserForm, setShowUserForm] = useState(false);
  const [uName, setUName] = useState('');
  const [uEmail, setUEmail] = useState('');
  const [uPassword, setUPassword] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState({ name: '', legalName: '' });

  async function reload() {
    const [t, mods, pl, us, all] = await Promise.all([api.tenant(id), api.tenantModules(id), api.plans(), api.tenantUsers(id), api.tenants()]);
    setName(t.name);
    setLegalName((t as { legalName?: string | null }).legalName ?? '');
    setCode(t.code);
    setStatus(t.status);
    setPlanCode(t.planCode ?? null);
    setUsage(t.usage ?? null);
    setModules(mods);
    setPlans(pl);
    setUsers(us);
    setCreatedAt(all.find((x) => x.id === id)?.createdAt ?? null);
    setDetails({ name: t.name, legalName: (t as { legalName?: string | null }).legalName ?? '' });
  }
  useEffect(() => {
    reload().catch((e) => setError(String(e)));
  }, [id]);

  const run = async (key: string, fn: () => Promise<string | void>) => {
    setError(null);
    setNotice(null);
    setBusy(key);
    try {
      const msg = await fn();
      if (msg) setNotice(msg);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  async function changeStatus(next: string) {
    if (next === status) return;
    if (!usable(next)) {
      const ok = await confirm({
        title: `Set ${name} to "${next}"?`,
        message: 'Everyone at this company is signed out within a minute and cannot sign in again until you restore it.',
        confirmLabel: 'Yes, block them',
        danger: true,
      });
      if (!ok) return;
    }
    await run('status', async () => {
      await api.updateTenant(id, { status: next });
      setStatus(next);
      return usable(next) ? `${name} can use Mix Nova again.` : `${name} is now ${next}. Their sessions stop working within a minute.`;
    });
  }

  async function assign() {
    if (!planId) return;
    const plan = plans.find((p) => p.id === planId);
    const ok = await confirm({
      title: `Put ${name} on ${plan?.name ?? 'this plan'}?`,
      message: 'The company\'s modules are reset to the plan\'s modules, and its caps on plants and logins apply from now.',
      confirmLabel: 'Apply the plan',
    });
    if (!ok) return;
    await run('plan', async () => {
      await api.assignPlan(id, planId);
      setPlanId('');
      await reload();
      return `${name} is on ${plan?.name ?? 'the plan'}.`;
    });
  }

  async function toggle(key: string, next: boolean) {
    await run(`mod:${key}`, async () => {
      setModules(await api.setTenantModule(id, key, next));
    });
  }

  async function saveDetails(e: FormEvent) {
    e.preventDefault();
    await run('details', async () => {
      await api.updateTenant(id, { tenantName: details.name.trim(), legalName: details.legalName.trim() });
      setName(details.name.trim());
      setLegalName(details.legalName.trim());
      return 'Company details saved.';
    });
  }

  async function downloadExport() {
    await run('export', async () => {
      const doc = await api.exportTenant(id);
      const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${doc.tenant.code || 'tenant'}-export-${todayLocal()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      return 'The export has been downloaded.';
    });
  }

  const pwProblems = uPassword ? passwordProblems(uPassword) : [];
  async function createUser(e: FormEvent) {
    e.preventDefault();
    if (pwProblems.length) { setError(`The password must ${pwProblems.join(', ')}.`); return; }
    await run('user', async () => {
      await api.createTenantUser(id, { name: uName.trim(), email: uEmail.trim(), password: uPassword });
      setUName('');
      setUEmail('');
      setUPassword('');
      setShowUserForm(false);
      await reload();
      return `${uEmail.trim().toLowerCase()} can sign in as the Company Owner. Give them the password yourself; they choose their own at the first sign-in.`;
    });
  }

  async function resetUserPassword(u: TenantUserRow) {
    const pw = await prompt({
      title: `New password for ${u.name}`,
      message: `At least ${PASSWORD_MIN_LENGTH} characters, with a letter and a number. Every session on this login is signed out, and they choose their own password at the next sign-in.`,
      label: 'New password',
      type: 'password',
      confirmLabel: 'Set password',
    });
    if (pw === null) return;
    const problems = passwordProblems(pw);
    if (problems.length) { setError(`That password must ${problems.join(', ')}. Nothing was changed.`); return; }
    await run(`user:${u.id}`, async () => {
      await api.updateTenantUser(id, u.id, { password: pw });
      await reload();
      return `Password set for ${u.email}. Tell them directly; it is not shown again.`;
    });
  }

  async function setUserStatus(u: TenantUserRow, next: 'active' | 'inactive') {
    if (next === 'inactive') {
      const ok = await confirm({ title: `Deactivate ${u.name}?`, message: 'They are signed out everywhere and cannot sign in until reactivated. Their history stays on record.', confirmLabel: 'Deactivate', danger: true });
      if (!ok) return;
    }
    await run(`user:${u.id}`, async () => {
      await api.updateTenantUser(id, u.id, { status: next });
      await reload();
      return next === 'active' ? `${u.email} can sign in again.` : `${u.email} is deactivated.`;
    });
  }

  const modulesOn = modules.filter((m) => m.isEnabled).length;
  const activeUsers = users.filter((u) => u.status === 'active');
  const owners = users.filter((u) => u.roleKey === 'company_owner');
  const seatsFull = usage?.users.limit !== null && usage !== null && usage.users.used >= (usage.users.limit ?? Infinity);
  const lastIn = useMemo(() => users.map((u) => u.lastLoginAt).filter(Boolean).sort().reverse()[0] ?? null, [users]);
  const detailsDirty = details.name.trim() !== name || details.legalName.trim() !== legalName;

  return (
    <div className="mn-od mn-td">
      <header className="mn-board-head">
        <div className="mn-board-title mn-od-title">
          <Link href="/admin/tenants" prefetch={false} className="mn-od-back"><ArrowLeft size={14} aria-hidden /> Companies</Link>
          <h1>
            {name || 'Company'}
            <span className="mn-od-badges">{status && <StatusBadge status={status} />}{!planCode && <Badge tone="warning">no plan</Badge>}</span>
          </h1>
          <p className="mn-od-facts">
            <span className="mn-od-fact"><Building2 size={13} aria-hidden /> {code || '—'}{legalName ? ` · ${legalName}` : ''}</span>
            <span className="mn-od-fact"><Package size={13} aria-hidden /> {planCode ? `Plan ${planCode}` : 'No plan'}</span>
            {createdAt && <span className="mn-od-fact">Since {formatDate(createdAt)}</span>}
            {usage && <span className="mn-od-fact"><Users size={13} aria-hidden /> {describe(usage.users, 'login')} · {describe(usage.plants, 'plant')}</span>}
          </p>
        </div>
        <div className="mn-board-tools">
          <span className="mn-board-live mn-ord-sum"><Users size={14} aria-hidden /> {activeUsers.length} {activeUsers.length === 1 ? 'login' : 'logins'} · {lastIn ? `last in ${formatDateTime(lastIn)}` : 'nobody has signed in'}</span>
          <Button variant="secondary" size="sm" icon={<Download size={14} />} loading={busy === 'export'} onClick={downloadExport}>Download all data</Button>
          <Button variant="ghost" size="sm" icon={<RefreshCw size={14} />} onClick={() => reload().catch((e) => setError(String(e)))}>Refresh</Button>
        </div>
      </header>

      {(notice || error || (status && !usable(status)) || !planCode || users.length === 0 || seatsFull || owners.length === 0) && (
        <div className="mn-ord-notes">
          {notice && <div className="mn-ord-note mn-ord-note--ok" role="status"><Building2 size={16} aria-hidden /><span>{notice}</span></div>}
          {error && <ErrorState message={error} />}
          {status && !usable(status) && (
            <div className="mn-ord-note mn-ord-note--bad"><ShieldOff size={16} aria-hidden /><span><strong>This company is {status}.</strong> Nobody there can sign in. Set the status to trial, active or grace to let them back in.</span></div>
          )}
          {!planCode && status && (
            <div className="mn-ord-note mn-ord-note--warn"><AlertTriangle size={16} aria-hidden /><span><strong>No plan assigned.</strong> Logins and plants are not capped and every module is open. Pick a plan below.</span></div>
          )}
          {users.length === 0 && status && (
            <div className="mn-ord-note mn-ord-note--warn"><UserPlus size={16} aria-hidden /><span><strong>No login yet.</strong> Create the first one under People; it gets the Company Owner role and adds the rest of the team from inside the app.</span></div>
          )}
          {users.length > 0 && owners.length === 0 && (
            <div className="mn-ord-note mn-ord-note--warn"><AlertTriangle size={16} aria-hidden /><span><strong>Nobody holds the Company Owner role.</strong> Without an owner, nobody at the company can manage its users or settings.</span></div>
          )}
          {seatsFull && (
            <div className="mn-ord-note mn-ord-note--warn"><Users size={16} aria-hidden /><span><strong>Every login seat is in use.</strong> A new login is refused until one is deactivated or the plan allows more.</span></div>
          )}
        </div>
      )}

      <div className="mn-od-kpis mn-qd-kpis">
        <StatCard label="Status" value={status ? status.replace(/^\w/, (c) => c.toUpperCase()) : '—'} tone={!status ? 'neutral' : status === 'active' ? 'success' : status === 'trial' ? 'info' : status === 'grace' ? 'warning' : 'danger'} icon={<ToggleLeft size={16} />} />
        <StatCard label="Plan" value={planCode ?? 'None'} tone={planCode ? 'info' : 'warning'} icon={<Package size={16} />} />
        <StatCard label="Logins" value={usage ? (usage.users.limit === null ? String(usage.users.used) : `${usage.users.used} of ${usage.users.limit}`) : '—'} tone={seatsFull ? 'warning' : 'neutral'} icon={<Users size={16} />} />
        <StatCard label="Plants" value={usage ? (usage.plants.limit === null ? String(usage.plants.used) : `${usage.plants.used} of ${usage.plants.limit}`) : '—'} icon={<Factory size={16} />} />
        <StatCard label="Modules on" value={`${modulesOn} of ${modules.length}`} tone={modulesOn ? 'success' : 'warning'} icon={<Layers size={16} />} />
      </div>

      <div className="mn-od-grid">
        <div className="mn-od-main">
          <Card title={<span className="mn-board-card-title"><Package size={16} aria-hidden /> Subscription</span>}>
            <div className="mn-td-sub">
              <Field label="Status" help="Trial, Active and Grace can all use the app: a late payment does not strand a plant mid-pour. Suspended and Cancelled block everyone at the company, the owner included.">
                <Select value={status} onChange={(e) => changeStatus(e.target.value)} disabled={busy === 'status'}>
                  {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </Select>
              </Field>
              <Field label="Plan" help={planCode ? `On ${planCode} now. Applying a plan resets the modules to that plan's.` : 'Applying a plan sets the modules and the caps.'}>
                <div className="mn-td-plan-row">
                  <Select value={planId} onChange={(e) => setPlanId(e.target.value)}>
                    <option value="">Choose a plan…</option>
                    {plans.filter((p) => p.isActive !== false || p.code === planCode).map((p) => <option key={p.id} value={p.id}>{p.name}{p.code === planCode ? ' (current)' : ''}</option>)}
                  </Select>
                  <Button size="sm" onClick={assign} disabled={!planId} loading={busy === 'plan'}>Apply</Button>
                </div>
              </Field>
            </div>
          </Card>

          <Card
            title={<span className="mn-board-card-title"><Layers size={16} aria-hidden /> Modules <span className="mn-board-card-count">{modulesOn} on</span></span>}
            actions={<span className="mn-ord-how">A module that is off disappears from the company's menu and its API refuses the calls.</span>}
            padded={false}
          >
            <div className="mn-ord-list" role="list">
              {modules.map((m) => (
                <div key={m.moduleKey} className={`mn-ord-row mn-td-mod${m.isEnabled ? '' : ' is-off'}`} data-tone={m.isEnabled ? 'success' : 'neutral'} role="listitem">
                  <div className="mn-ord-id">
                    <span className="mn-ord-no">{m.name}</span>
                    <span className="mn-ord-meta">{m.moduleKey} · phase {m.phase}</span>
                  </div>
                  <label className="mn-se-switch">
                    <input type="checkbox" role="switch" checked={m.isEnabled} disabled={busy === `mod:${m.moduleKey}`} onChange={(e) => toggle(m.moduleKey, e.target.checked)} aria-label={`${m.name} on`} />
                    <span className="mn-se-switch-track" aria-hidden><span className="mn-se-switch-knob" /></span>
                    <span className="mn-se-switch-text">{m.isEnabled ? 'On' : 'Off'}</span>
                  </label>
                </div>
              ))}
            </div>
          </Card>

          <Card
            title={<span className="mn-board-card-title"><Users size={16} aria-hidden /> People <span className="mn-board-card-count">{users.length}</span></span>}
            actions={<Button size="sm" variant="secondary" icon={<UserPlus size={14} />} onClick={() => setShowUserForm((v) => !v)} disabled={seatsFull} aria-expanded={showUserForm}>Add a login</Button>}
            padded={false}
          >
            {showUserForm && (
              <Form onSubmit={createUser} className="mn-td-user-form">
                <Field label="Full name" required><Input value={uName} onChange={(e) => setUName(e.target.value)} placeholder="e.g. Plant Manager" required autoFocus /></Field>
                <Field label="Email (their login)" required><Input type="email" value={uEmail} onChange={(e) => setUEmail(e.target.value)} placeholder="name@company.in" required /></Field>
                <Field label="First password" required help={`At least ${PASSWORD_MIN_LENGTH} characters, with a letter and a number.`} error={uPassword && pwProblems.length ? `Must ${pwProblems.join(', ')}.` : undefined}>
                  <PasswordInput value={uPassword} onChange={(e) => setUPassword(e.target.value)} autoComplete="new-password" required />
                </Field>
                <div className="mn-td-user-submit">
                  <Button type="submit" loading={busy === 'user'} icon={<UserPlus size={14} />}>Create the login</Button>
                  <Button type="button" variant="secondary" onClick={() => setShowUserForm(false)}>Cancel</Button>
                  <span className="mn-ord-how">{users.length ? 'Gets the Company Owner role.' : 'The first login gets the Company Owner role and adds the rest of the team from inside the app.'}</span>
                </div>
              </Form>
            )}
            {users.length ? (
              <div className="mn-ord-list" role="list">
                <div className="mn-ord-cols mn-ord-cols--acts" aria-hidden>
                  <span>Person</span>
                  <span>Role</span>
                  <span>Last signed in</span>
                  <span>Status</span>
                  <span />
                </div>
                {users.map((u) => (
                  <div key={u.id} className={`mn-ord-row mn-ord-row--acts mn-td-user${u.status === 'active' ? '' : ' is-void'}`} data-tone={u.status === 'active' ? 'success' : 'neutral'} role="listitem">
                    <div className="mn-ord-id">
                      <span className="mn-ord-no">{u.name}</span>
                      <span className="mn-ord-meta">{u.email}</span>
                    </div>
                    <div className="mn-ord-who mn-td-role">
                      <span className="mn-ord-cust">{u.roleName ?? roleLabel(u.roleKey)}</span>
                      <span className="mn-ord-meta">{u.mustChangePassword ? 'must choose a password at next sign-in' : `added ${formatDate(u.createdAt)}`}</span>
                    </div>
                    <div className="mn-ord-who mn-td-seen">
                      <span className="mn-ord-cust">{u.lastLoginAt ? formatDateTime(u.lastLoginAt) : 'Never'}</span>
                    </div>
                    <div className="mn-ord-status">{u.status === 'active' ? <Badge tone="success">active</Badge> : <Badge tone="neutral">{u.status}</Badge>}</div>
                    <div className="mn-ord-act mn-td-user-acts">
                      <Button variant="ghost" size="sm" icon={<KeyRound size={14} />} onClick={() => resetUserPassword(u)} loading={busy === `user:${u.id}`}>New password</Button>
                      {u.status === 'active'
                        ? <Button variant="ghost" size="sm" onClick={() => setUserStatus(u, 'inactive')} disabled={busy === `user:${u.id}`}>Deactivate</Button>
                        : <Button variant="secondary" size="sm" onClick={() => setUserStatus(u, 'active')} disabled={busy === `user:${u.id}` || seatsFull}>Reactivate</Button>}
                    </div>
                  </div>
                ))}
              </div>
            ) : !showUserForm ? (
              <EmptyState title="No login yet" description="Press Add a login to create the company owner." />
            ) : null}
          </Card>
        </div>

        <div className="mn-od-side">
          <Card title={<span className="mn-board-card-title"><Building2 size={16} aria-hidden /> Company details</span>}>
            <Form onSubmit={saveDetails} className="mn-td-details">
              <Field label="Company name" required help="What the company sees in its own app.">
                <Input value={details.name} onChange={(e) => setDetails({ ...details, name: e.target.value })} required />
              </Field>
              <Field label="Legal name" help="As on the GST registration, when it differs.">
                <Input value={details.legalName} onChange={(e) => setDetails({ ...details, legalName: e.target.value })} />
              </Field>
              <dl className="mn-od-money mn-od-money--tight">
                <div><dt>Code</dt><dd>{code || '—'}</dd></div>
                <div><dt>Since</dt><dd>{createdAt ? formatDate(createdAt) : '—'}</dd></div>
                <div><dt>Owners</dt><dd>{owners.length ? owners.map((o) => o.email).join(', ') : 'None'}</dd></div>
              </dl>
              <Button type="submit" size="sm" icon={<Save size={14} />} disabled={!detailsDirty} loading={busy === 'details'}>Save details</Button>
            </Form>
          </Card>
          <Card title={<span className="mn-board-card-title"><Download size={16} aria-hidden /> Offboarding</span>}>
            <p className="mn-od-notes">Before a company leaves: download a complete copy of its data as one JSON file (every record, no passwords), set the status to <strong>Cancelled</strong> so every login is blocked, then run <code>offboard-tenant.sh</code> on the server, which backs up, re-exports and removes the company for good. That last step cannot be undone.</p>
            <Button variant="secondary" size="sm" icon={<Download size={14} />} loading={busy === 'export'} onClick={downloadExport}>Download all data (JSON)</Button>
          </Card>
        </div>
      </div>
    </div>
  );
}
