'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Building2, Plus, RefreshCw, Search, AlertTriangle, ShieldOff } from 'lucide-react';
import { TENANT_USABLE_STATUSES } from '@rmc/shared';
import { api, type PlanRow, type TenantRow } from '../../../lib/api';
import { Card } from '../../../components/ui/Card';
import { StatusBadge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Form } from '../../../components/ui/Form';
import { Field, Input, Select } from '../../../components/ui/Field';
import { ErrorState, EmptyState, TableSkeleton } from '../../../components/ui/States';
import { formatDate, formatDateTime } from '../../../lib/format-date';

/**
 * Companies — every tenant on the platform, on the document-list bones.
 *
 * The header carries how many companies there are and how many can use the
 * app today; the strip filters by subscription status; the notes flag the
 * companies that are blocked and the ones on no plan (so nothing is capped).
 * One row per company: name and code, the plan and modules, who is using it
 * and when they were last in, the status, and Manage. "Add a company" opens
 * the form in a card; the first login is created from the company's page.
 */
const STAGES: { key: string; label: string; tone: 'info' | 'success' | 'warning' | 'danger' | 'neutral'; hint: string }[] = [
  { key: 'trial', label: 'Trial', tone: 'info', hint: 'Full access, not paying yet' },
  { key: 'active', label: 'Active', tone: 'success', hint: 'Paying, full access' },
  { key: 'grace', label: 'Grace', tone: 'warning', hint: 'Payment overdue, still working' },
  { key: 'suspended', label: 'Suspended', tone: 'danger', hint: 'Blocked, can be restored' },
  { key: 'cancelled', label: 'Cancelled', tone: 'neutral', hint: 'Blocked, subscription ended' },
];
const usable = (status: string) => TENANT_USABLE_STATUSES.includes(status as never);

export default function TenantsPage() {
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState('');
  const [q, setQ] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [planId, setPlanId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function reload() {
    const [t, p] = await Promise.all([api.tenants(), api.plans()]);
    setTenants(t);
    setPlans(p);
    setLoaded(true);
  }
  useEffect(() => {
    reload().catch((e) => { setError(String(e)); setLoaded(true); });
  }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const made = await api.createTenant({ tenantCode: code.trim().toLowerCase(), tenantName: name.trim(), planId: planId || undefined });
      setNotice(`${name.trim()} is set up. Open it to create the first login.`);
      setCode('');
      setName('');
      setPlanId('');
      setShowForm(false);
      await reload();
      void made;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the company.');
    } finally {
      setBusy(false);
    }
  }

  const counts = useMemo(() => {
    const c = new Map<string, number>();
    for (const t of tenants) c.set(t.status, (c.get(t.status) ?? 0) + 1);
    return c;
  }, [tenants]);
  const live = tenants.filter((t) => usable(t.status)).length;
  const blocked = tenants.length - live;
  const noPlan = tenants.filter((t) => !t.planCode).length;
  const needle = q.trim().toLowerCase();
  const shown = tenants
    .filter((t) => !filter || t.status === filter)
    .filter((t) => !needle || t.name.toLowerCase().includes(needle) || t.code.toLowerCase().includes(needle));

  return (
    <div className="mn-ord mn-tn">
      <header className="mn-board-head">
        <div className="mn-board-title">
          <h1>Companies</h1>
          <p>Every ready-mix company on the platform. Each one is its own world: its own logins, plants and data, none of it visible to another. Open a company to set its plan, switch modules, create its first login or block it.</p>
        </div>
        <div className="mn-board-tools">
          <span className="mn-board-live mn-ord-sum"><Building2 size={14} aria-hidden /> {tenants.length} {tenants.length === 1 ? 'company' : 'companies'} · {live} using it</span>
          <Button size="sm" icon={<Plus size={14} />} onClick={() => setShowForm((v) => !v)} aria-expanded={showForm}>Add a company</Button>
          <Button variant="ghost" size="sm" icon={<RefreshCw size={14} />} onClick={() => reload().catch((e) => setError(String(e)))}>Refresh</Button>
        </div>
      </header>

      <div className="mn-board-strip" role="group" aria-label="Filter by status">
        {STAGES.map((s) => {
          const n = counts.get(s.key) ?? 0;
          const on = filter === s.key;
          return (
            <button key={s.key} type="button" className={`mn-board-chip${on ? ' is-on' : ''}${n ? '' : ' is-empty'}`} data-tone={s.tone} aria-pressed={on} title={s.hint} onClick={() => setFilter(on ? '' : s.key)}>
              <span className="mn-board-chip-n">{n}</span>
              <span className="mn-board-chip-l">{s.label}</span>
            </button>
          );
        })}
        {filter && <button type="button" className="mn-board-chip mn-board-chip-clear" onClick={() => setFilter('')}>Show all</button>}
        <label className="mn-rp-search mn-tn-search">
          <Search size={15} aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find by name or code" aria-label="Find a company" />
        </label>
      </div>

      {(notice || error || blocked > 0 || noPlan > 0) && (
        <div className="mn-ord-notes">
          {notice && <div className="mn-ord-note mn-ord-note--ok" role="status"><Building2 size={16} aria-hidden /><span>{notice}</span></div>}
          {error && <ErrorState message={error} />}
          {blocked > 0 && (
            <button type="button" className="mn-ord-note mn-ord-note--bad mn-ord-note--btn" onClick={() => setFilter(filter === 'suspended' ? '' : 'suspended')}>
              <ShieldOff size={16} aria-hidden />
              <span><strong>{blocked} {blocked === 1 ? 'company is' : 'companies are'} blocked.</strong> Nobody there can sign in until the status is set back to trial, active or grace.</span>
            </button>
          )}
          {noPlan > 0 && (
            <div className="mn-ord-note mn-ord-note--warn">
              <AlertTriangle size={16} aria-hidden />
              <span><strong>{noPlan} {noPlan === 1 ? 'company has' : 'companies have'} no plan.</strong> Without one, users and plants are not capped and every module is open.</span>
            </div>
          )}
        </div>
      )}

      {showForm && (
        <Card title={<span className="mn-board-card-title"><Plus size={16} aria-hidden /> New company</span>}>
          <Form onSubmit={create} className="mn-tn-form">
            <Field label="Code" required help="Short, lowercase, no spaces; it never changes. e.g. sreconstro">
              <Input value={code} onChange={(e) => setCode(e.target.value)} pattern="[a-z0-9_-]{2,}" autoCapitalize="none" spellCheck={false} required autoFocus />
            </Field>
            <Field label="Company name" required help="As the plant knows itself; it can be changed later.">
              <Input value={name} onChange={(e) => setName(e.target.value)} required />
            </Field>
            <Field label="Plan" help="Sets the modules and the caps. Can be left for later.">
              <Select value={planId} onChange={(e) => setPlanId(e.target.value)}>
                <option value="">No plan yet</option>
                {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </Field>
            <div className="mn-tn-form-submit">
              <Button type="submit" loading={busy} icon={<Plus size={14} />}>Create the company</Button>
              <Button type="button" variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
              <span className="mn-ord-how">It starts as a trial with the standard roles ready; the first login is created from its page.</span>
            </div>
          </Form>
        </Card>
      )}

      <Card
        title={<span className="mn-board-card-title"><Building2 size={16} aria-hidden /> Companies <span className="mn-board-card-count">{shown.length}</span></span>}
        actions={<span className="mn-ord-how">Sorted by code. "Last in" is the latest sign-in by anyone at the company.</span>}
        padded={false}
      >
        {!loaded ? (
          <div className="mn-ord-skel"><TableSkeleton cols={5} /></div>
        ) : shown.length ? (
          <div className="mn-ord-list" role="list">
            <div className="mn-ord-cols mn-ord-cols--acts" aria-hidden>
              <span>Company</span>
              <span>Plan</span>
              <span>People</span>
              <span>Status</span>
              <span />
            </div>
            {shown.map((t) => {
              const stage = STAGES.find((s) => s.key === t.status);
              return (
                <div key={t.id} className={`mn-ord-row mn-ord-row--acts${usable(t.status) ? '' : ' is-void'}`} data-tone={stage?.tone ?? 'neutral'} role="listitem">
                  <div className="mn-ord-id">
                    <Link href={`/admin/tenants/${t.id}`} prefetch={false} className="mn-ord-no">{t.name}</Link>
                    <span className="mn-ord-meta">{t.code}{t.createdAt ? ` · since ${formatDate(t.createdAt)}` : ''}</span>
                  </div>
                  <div className="mn-ord-who mn-tn-plan">
                    <span className="mn-ord-cust">{t.planCode ?? 'No plan'}</span>
                    <span className="mn-ord-meta">{t.enabledModules} {t.enabledModules === 1 ? 'module' : 'modules'} on</span>
                  </div>
                  <div className="mn-ord-who mn-tn-people">
                    <span className="mn-ord-cust">{t.activeUsers ?? 0} {t.activeUsers === 1 ? 'login' : 'logins'}</span>
                    <span className="mn-ord-meta">{t.lastLoginAt ? `last in ${formatDateTime(t.lastLoginAt)}` : 'nobody has signed in'}</span>
                  </div>
                  <div className="mn-ord-status"><StatusBadge status={t.status} /></div>
                  <div className="mn-ord-act">
                    <Link href={`/admin/tenants/${t.id}`} prefetch={false}><Button variant="secondary" size="sm">Manage</Button></Link>
                  </div>
                </div>
              );
            })}
          </div>
        ) : tenants.length ? (
          <EmptyState title="Nothing matches" description="Clear the filter or the search to see every company." />
        ) : (
          <EmptyState title="No companies yet" description="Press Add a company to set up the first one." />
        )}
      </Card>
    </div>
  );
}
