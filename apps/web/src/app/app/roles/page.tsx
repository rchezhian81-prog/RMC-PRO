'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Archive, ArchiveRestore, CheckCircle2, Plus, RefreshCw, Save, ShieldCheck, Trash2, Users, X } from 'lucide-react';
import { formatDate } from '../../../lib/format-date';
import { rolesApi, type Row } from '../../../lib/api';
import { Card } from '../../../components/ui/Card';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Form } from '../../../components/ui/Form';
import { Field, Input } from '../../../components/ui/Field';
import { ErrorState, EmptyState, TableSkeleton } from '../../../components/ui/States';
import { useConfirm } from '../../../components/ui/ConfirmDialog';

/**
 * Roles and permissions — what each kind of person may do.
 *
 * A strip (in use / unused / archived) with live counts doubles as the
 * filter, a pill counts the roles and the people in them, and each role is
 * one row: name with standard or custom; the people who hold it; how many
 * permissions it carries; Edit / Archive or Delete / Restore. Editing opens
 * a worksheet with the permissions grouped by the part of the app they
 * unlock, each group with a toggle-all, and a running count. The new-role
 * form opens on demand. Same layout in both skins; every colour reads the
 * semantic tokens.
 */

const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v)) || 0;
const CORE = new Set(['company_owner', 'company_admin']);
type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';
const STATES: Array<{ key: string; label: string; tone: Tone; hint: string }> = [
  { key: 'in_use', label: 'In use', tone: 'success', hint: 'At least one active person holds it' },
  { key: 'unused', label: 'Unused', tone: 'neutral', hint: 'Nobody holds it yet' },
  { key: 'archived', label: 'Archived', tone: 'warning', hint: 'Hidden from the lists; can be restored' },
];
const stateOf = (r: Row) => (r.archivedAt ? 'archived' : num(r.userCount) > 0 ? 'in_use' : 'unused');
/** The part of the app a permission unlocks, in the words of the menu. */
const MODULE_LABELS: Record<string, string> = {
  customers: 'Customers', sites: 'Sites', suppliers: 'Suppliers', masters: 'Masters', quotations: 'Quotations', rate_contracts: 'Rate contracts',
  orders: 'Orders', credit_hold: 'Credit holds', dispatch: 'Dispatch', delivery_challans: 'Delivery challans', batch_tickets: 'Batch tickets', batching: 'Batching',
  production: 'Production', mix_designs: 'Mix designs', inventory: 'Inventory', stock: 'Stock', qc: 'Quality', invoices: 'Invoices', receipts: 'Receipts',
  billing: 'Billing', credit_notes: 'Credit notes', purchase: 'Purchase', expenses: 'Expenses', fleet: 'Fleet', reports: 'Reports', users: 'Users', roles: 'Roles',
  settings: 'Settings', number_series: 'Number series', imports: 'Bulk import', audit_logs: 'Audit trail', document_corrections: 'Corrections', sync: 'Devices and sync',
  whatsapp: 'WhatsApp', agents: 'Agents', ai: 'Assistant', approvals: 'Approvals', gps: 'GPS tracking', weighbridge: 'Weighbridge', compliance: 'GST filing',
};
const moduleLabel = (m: unknown) => MODULE_LABELS[String(m ?? '')] ?? String(m ?? 'Other').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
/** "customers.view" → "view" */
const actionOf = (k: string) => k.split('.').slice(1).join('.').replace(/_/g, ' ');

export default function RolesPage() {
  const { confirm } = useConfirm();
  const [roles, setRoles] = useState<Row[]>([]);
  const [catalog, setCatalog] = useState<Row[]>([]);
  const [selRole, setSelRole] = useState<Row | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [savedPerms, setSavedPerms] = useState<Set<string>>(new Set());
  const [form, setForm] = useState({ roleKey: '', roleName: '' });
  const [showForm, setShowForm] = useState(false);
  const [editName, setEditName] = useState('');
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [r, c] = await Promise.all([rolesApi.list(true), rolesApi.catalog()]);
    setRoles(r);
    setCatalog(c);
  }, []);
  useEffect(() => {
    setLoaded(false);
    reload()
      .catch((e) => setError(String(e)))
      .finally(() => setLoaded(true));
  }, [reload]);

  async function refresh() {
    setRefreshing(true);
    try {
      await reload();
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setRefreshing(false);
    }
  }

  /** Open a role for editing: its name and its permissions, saved together. */
  async function selectRole(role: Row) {
    setSelRole(role);
    setEditName(String(role.roleName ?? ''));
    setMsg(null);
    setError(null);
    const perms = new Set(await rolesApi.getPerms(String(role.id)));
    setChecked(perms);
    setSavedPerms(perms);
  }
  function toggle(id: string) {
    setChecked((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  function toggleGroup(ids: string[], on: boolean) {
    setChecked((prev) => {
      const n = new Set(prev);
      for (const id of ids) { if (on) n.add(id); else n.delete(id); }
      return n;
    });
  }
  async function saveRole() {
    if (!selRole) return;
    setError(null);
    const name = editName.trim();
    if (!name) { setError('The role needs a name.'); return; }
    setBusy(true);
    try {
      if (name !== String(selRole.roleName ?? '')) await rolesApi.update(String(selRole.id), { roleName: name });
      await rolesApi.setPerms(String(selRole.id), [...checked]);
      await reload();
      setSelRole(null);
      setMsg(`${name} saved with ${checked.size} ${checked.size === 1 ? 'permission' : 'permissions'}. People with the role see the change on their next sign-in.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function createRole(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setMsg(null);
    setBusy(true);
    try {
      const created = await rolesApi.create({ roleKey: form.roleKey.trim().toLowerCase().replace(/\s+/g, '_'), roleName: form.roleName.trim() });
      setForm({ roleKey: '', roleName: '' });
      setShowForm(false);
      await reload();
      setMsg(`${String(created.roleName)} created with no permissions yet; tick what it may do below.`);
      await selectRole(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  async function deleteRole(r: Row) {
    const system = Boolean(r.isSystemRole);
    const holders = num(r.userCount);
    if (!(await confirm({
      title: system ? `Archive ${String(r.roleName)}` : `Delete ${String(r.roleName)}`,
      message: system
        ? `The role disappears from the lists and nobody new can be given it${holders ? `; the ${holders} ${holders === 1 ? 'person' : 'people'} holding it keep it until you move them` : ''}. You can restore it here later.`
        : `The role is removed for good${holders ? `; move the ${holders} ${holders === 1 ? 'person' : 'people'} holding it to another role first` : ''}. This cannot be undone.`,
      confirmLabel: system ? 'Archive' : 'Delete',
      danger: true,
    }))) return;
    setError(null);
    setMsg(null);
    try {
      const out = await rolesApi.remove(String(r.id));
      if (selRole && selRole.id === r.id) setSelRole(null);
      await reload();
      setMsg(out.archived ? `${String(r.roleName)} archived.` : `${String(r.roleName)} deleted.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  async function restoreRole(r: Row) {
    setError(null);
    setMsg(null);
    try {
      await rolesApi.restore(String(r.id));
      await reload();
      setMsg(`${String(r.roleName)} restored; it can be given again.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const counts = useMemo(() => {
    const c = new Map<string, number>();
    for (const r of roles) c.set(stateOf(r), (c.get(stateOf(r)) ?? 0) + 1);
    return c;
  }, [roles]);
  const shown = useMemo(() => {
    const list = filter ? roles.filter((r) => stateOf(r) === filter) : roles;
    const order: Record<string, number> = { in_use: 0, unused: 1, archived: 2 };
    return [...list].sort((a, b) => (order[stateOf(a)] ?? 9) - (order[stateOf(b)] ?? 9) || num(b.userCount) - num(a.userCount) || String(a.roleName).localeCompare(String(b.roleName)));
  }, [roles, filter]);
  const people = roles.reduce((t, r) => t + num(r.userCount), 0);
  const groups = useMemo(() => {
    const g = new Map<string, Row[]>();
    for (const p of catalog) {
      if (String(p.permissionKey).startsWith('platform.')) continue;
      const k = String(p.moduleKey ?? String(p.permissionKey).split('.')[0]);
      g.set(k, [...(g.get(k) ?? []), p]);
    }
    return [...g.entries()].sort((a, b) => moduleLabel(a[0]).localeCompare(moduleLabel(b[0])));
  }, [catalog]);
  const dirty = selRole ? editName.trim() !== String(selRole.roleName ?? '') || checked.size !== savedPerms.size || [...checked].some((id) => !savedPerms.has(id)) : false;

  return (
    <div className="mn-ord mn-ro">
      <header className="mn-board-head">
        <div className="mn-board-title">
          <h1>Roles and permissions</h1>
          <p>A role is a job in the plant, and its permissions are the screens and actions that job needs. Give a person a role under Users and they get exactly that much. The standard roles cover the usual jobs; add your own for anything else. Company Owner and Company Admin always stay.</p>
        </div>
        <div className="mn-board-tools">
          <span className="mn-board-live mn-ord-sum" aria-live="polite">
            <ShieldCheck size={14} aria-hidden />
            {loaded ? `${roles.filter((r) => !r.archivedAt).length} roles · ${people} ${people === 1 ? 'person' : 'people'} in them` : 'Loading…'}
          </span>
          {!showForm && <Button icon={<Plus size={14} />} onClick={() => { setShowForm(true); setMsg(null); }}>New role</Button>}
          <Link href="/app/users" prefetch={false} className="mn-ord-link">
            <Button variant="ghost" size="sm" icon={<Users size={14} />}>Users</Button>
          </Link>
          <Button variant="ghost" size="sm" icon={<RefreshCw size={14} />} onClick={refresh} loading={refreshing}>
            Refresh
          </Button>
        </div>
      </header>

      <div className="mn-board-strip" role="group" aria-label="Filter roles">
        {STATES.map((s) => {
          const c = counts.get(s.key) ?? 0;
          const on = filter === s.key;
          return (
            <button key={s.key} type="button" className={`mn-board-chip${on ? ' is-on' : ''}${c === 0 ? ' is-empty' : ''}`} data-tone={s.tone} aria-pressed={on} title={s.hint} onClick={() => setFilter(on ? '' : s.key)}>
              <span className="mn-board-chip-n">{c}</span>
              <span className="mn-board-chip-l">{s.label}</span>
            </button>
          );
        })}
        {filter && <button type="button" className="mn-board-chip mn-board-chip-clear" onClick={() => setFilter('')}>Show all</button>}
      </div>

      {error && <ErrorState message={error} />}
      {msg && <div className="mn-ord-note mn-ord-note--ok" role="status"><CheckCircle2 size={16} aria-hidden /><span>{msg}</span></div>}

      {showForm && (
        <Card
          title={<span className="mn-board-card-title"><Plus size={16} aria-hidden /> New role</span>}
          actions={<Button variant="ghost" size="sm" icon={<X size={14} />} onClick={() => setShowForm(false)}>Close</Button>}
        >
          <Form onSubmit={createRole} className="mn-ro-form">
            <Field label="Name" required help="As people will read it under Users.">
              <Input value={form.roleName} placeholder="e.g. Site Supervisor" onChange={(e) => setForm({ ...form, roleName: e.target.value, roleKey: form.roleKey || e.target.value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') })} required autoFocus />
            </Field>
            <Field label="Key" required help="A short code; letters, numbers and underscores. Fixed once created.">
              <Input value={form.roleKey} placeholder="site_supervisor" onChange={(e) => setForm({ ...form, roleKey: e.target.value })} required />
            </Field>
            <div className="mn-ro-form-submit">
              <Button type="submit" loading={busy} icon={<ShieldCheck size={14} />}>Create the role</Button>
              <Button type="button" variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
              <span className="mn-ord-how">It starts with no permissions; the worksheet opens so you can tick what it may do.</span>
            </div>
          </Form>
        </Card>
      )}

      {selRole && (
        <Card
          title={<span className="mn-board-card-title"><ShieldCheck size={16} aria-hidden /> {String(selRole.roleName)} <span className="mn-board-card-count">{checked.size}</span></span>}
          actions={<div className="mn-ro-ws-actions"><Button size="sm" icon={<Save size={14} />} onClick={saveRole} loading={busy} disabled={!dirty}>Save</Button><Button variant="ghost" size="sm" icon={<X size={14} />} onClick={() => setSelRole(null)}>Close</Button></div>}
        >
          <div className="mn-ro-ws">
            <div className="mn-ro-ws-head">
              <Field label="Role name" required>
                <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
              </Field>
              <p className="mn-ord-how mn-ro-ws-hint">Key <code>{String(selRole.roleKey)}</code>, fixed. {num(selRole.userCount) ? `${num(selRole.userCount)} ${num(selRole.userCount) === 1 ? 'person holds' : 'people hold'} this role; they see the change on their next sign-in.` : 'Nobody holds this role yet.'} Tick what the job needs and press Save.</p>
            </div>
            <div className="mn-ro-groups">
              {groups.map(([mod, perms]) => {
                const ids = perms.map((p) => String(p.id));
                const on = ids.filter((id) => checked.has(id)).length;
                return (
                  <div key={mod} className={`mn-ro-group${on === ids.length ? ' is-all' : on ? ' is-some' : ''}`}>
                    <div className="mn-ro-group-head">
                      <span className="mn-ro-group-title">{moduleLabel(mod)}</span>
                      <span className="mn-ord-meta">{on} of {ids.length}</span>
                      <button type="button" className="mn-ro-group-all" onClick={() => toggleGroup(ids, on !== ids.length)}>{on === ids.length ? 'None' : 'All'}</button>
                    </div>
                    <div className="mn-ro-perms">
                      {perms.map((p) => {
                        const id = String(p.id);
                        const isOn = checked.has(id);
                        return (
                          <label key={id} className={`mn-ro-perm${isOn ? ' is-on' : ''}`} title={p.description ? String(p.description) : String(p.permissionKey)}>
                            <input type="checkbox" checked={isOn} onChange={() => toggle(id)} />
                            <span>{actionOf(String(p.permissionKey))}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mn-ro-ws-foot">
              <Button icon={<Save size={14} />} onClick={saveRole} loading={busy} disabled={!dirty}>Save {String(selRole.roleName)}</Button>
              <Button variant="secondary" onClick={() => setSelRole(null)}>Cancel</Button>
              <span className="mn-ord-how">{checked.size} {checked.size === 1 ? 'permission' : 'permissions'} ticked{dirty ? ' · unsaved changes' : ''}.</span>
            </div>
          </div>
        </Card>
      )}

      <Card
        title={<span className="mn-board-card-title"><ShieldCheck size={16} aria-hidden /> Roles <span className="mn-board-card-count">{shown.length}</span></span>}
        actions={<span className="mn-ord-how">In use first. Standard roles archive; roles you made delete.{counts.get('archived') ? ` Archived roles (${counts.get('archived')}) sit at the bottom; Restore brings one back.` : ''}</span>}
        padded={false}
      >
        {!loaded ? (
          <div className="mn-ord-skel"><TableSkeleton cols={5} /></div>
        ) : shown.length ? (
          <div className="mn-ord-list" role="list">
            <div className="mn-ord-cols mn-ord-cols--acts mn-ro-cols" aria-hidden>
              <span>Role</span>
              <span>People</span>
              <span>Permissions</span>
              <span>Kind</span>
              <span />
            </div>
            {shown.map((r) => {
              const system = Boolean(r.isSystemRole);
              const core = CORE.has(String(r.roleKey));
              const archived = Boolean(r.archivedAt);
              const open = selRole?.id === r.id;
              const holders = num(r.userCount);
              const perms = num(r.permissionCount);
              return (
                <div key={String(r.id)} className={`mn-ord-row mn-ord-row--acts mn-ro-row${archived ? ' is-void' : ''}${open ? ' is-open' : ''}`} data-tone={archived ? 'warning' : holders ? 'success' : 'neutral'} role="listitem">
                  <div className="mn-ord-id">
                    <span className="mn-ord-no">{String(r.roleName ?? '')}</span>
                    <span className="mn-ord-meta">{String(r.roleKey ?? '')}{archived ? ` · archived ${formatDate(r.archivedAt)}` : ''}</span>
                  </div>
                  <div className="mn-ro-count">
                    <span>{holders ? `${holders} ${holders === 1 ? 'person' : 'people'}` : 'Nobody yet'}</span>
                  </div>
                  <div className="mn-ro-count">
                    <span>{core && String(r.roleKey) === 'company_owner' ? 'Everything' : `${perms} ${perms === 1 ? 'permission' : 'permissions'}`}</span>
                    <span className="mn-od-linebar mn-ro-bar" aria-hidden><span style={{ width: `${String(r.roleKey) === 'company_owner' ? 100 : catalog.length ? Math.min(100, (perms / Math.max(1, catalog.filter((p) => !String(p.permissionKey).startsWith('platform.')).length)) * 100) : 0}%` }} /></span>
                  </div>
                  <div className="mn-ord-status">{core ? <Badge tone="info">always on</Badge> : system ? <Badge tone="neutral">standard</Badge> : <Badge tone="success">yours</Badge>}</div>
                  <div className="mn-ord-act mn-ro-acts">
                    {archived ? (
                      <Button variant="secondary" size="sm" icon={<ArchiveRestore size={14} />} onClick={() => restoreRole(r)}>Restore</Button>
                    ) : (
                      <>
                        <Button variant={open ? undefined : 'ghost'} size="sm" onClick={() => selectRole(r)}>Edit</Button>
                        {!core && (
                          <Button variant="ghost" size="sm" icon={system ? <Archive size={14} /> : <Trash2 size={14} />} onClick={() => deleteRole(r)}>{system ? 'Archive' : 'Delete'}</Button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState title={filter ? `No ${STATES.find((s) => s.key === filter)?.label.toLowerCase()} roles` : 'No roles yet'} description={filter ? 'Press the chip again to see every role.' : 'Press New role to add one.'} action={filter ? <Button variant="secondary" size="sm" onClick={() => setFilter('')}>Show all</Button> : undefined} />
        )}
      </Card>
    </div>
  );
}
