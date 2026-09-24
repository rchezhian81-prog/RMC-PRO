'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, FolderTree, Plus, Receipt, RefreshCw, Tags, X } from 'lucide-react';
import { expensesApi, type Row } from '../../../../lib/api';
import { getAccess } from '../../../../lib/session';
import { Card } from '../../../../components/ui/Card';
import { Badge, StatusBadge } from '../../../../components/ui/Badge';
import { Button } from '../../../../components/ui/Button';
import { Form } from '../../../../components/ui/Form';
import { Field, Input, Select } from '../../../../components/ui/Field';
import { ErrorState, EmptyState, TableSkeleton } from '../../../../components/ui/States';
import { useConfirm } from '../../../../components/ui/ConfirmDialog';

/**
 * Expense heads — the names spend is booked under, in groups.
 *
 * A status strip (active / inactive) with live counts doubles as the
 * filter for the heads; groups sit in a compact card above with their
 * heads counted. Each head is one row: name and code, its group, where
 * its money usually goes (a truck, a plant, a site, general), the status,
 * and Edit / Deactivate / Reactivate; editing opens in place. The add
 * forms open on demand. Same layout in both skins; every colour reads the
 * semantic tokens.
 */

const COST: Array<{ value: string; label: string; hint: string }> = [
  { value: 'general', label: 'General', hint: 'Overhead: not tied to a plant, truck or site' },
  { value: 'plant', label: 'A plant', hint: 'Power, water, plant labour' },
  { value: 'vehicle', label: 'A truck or pump', hint: 'Diesel, bata, tolls, repairs' },
  { value: 'site', label: 'A site', hint: 'Spent at a customer\'s site' },
];
const costLabel = (v: unknown) => COST.find((c) => c.value === String(v ?? 'general'))?.label ?? String(v ?? 'General');
type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';
const STATUSES: Array<{ key: string; label: string; tone: Tone; hint: string }> = [
  { key: 'active', label: 'Active', tone: 'success', hint: 'Offered on a new voucher line' },
  { key: 'inactive', label: 'Inactive', tone: 'neutral', hint: 'Hidden from new vouchers; old ones keep it' },
];

export default function ExpenseHeadsPage() {
  const { confirm } = useConfirm();
  const [groups, setGroups] = useState<Row[]>([]);
  const [heads, setHeads] = useState<Row[]>([]);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showGroupForm, setShowGroupForm] = useState(false);
  const [showHeadForm, setShowHeadForm] = useState(false);
  const [gCode, setGCode] = useState('');
  const [gName, setGName] = useState('');
  const [hCode, setHCode] = useState('');
  const [hName, setHName] = useState('');
  const [hGroup, setHGroup] = useState('');
  const [hCost, setHCost] = useState('general');
  const canManage = getAccess().has('expenses.manage');
  // One row at a time is open for editing, for a group or for a head.
  const [editGroup, setEditGroup] = useState<{ id: string; groupName: string } | null>(null);
  const [editHead, setEditHead] = useState<{ id: string; headName: string; groupId: string; defaultCostType: string } | null>(null);

  const reload = useCallback(async () => {
    const [g, h] = await Promise.all([expensesApi.groups(), expensesApi.heads()]);
    setGroups(g);
    setHeads(h);
  }, []);

  useEffect(() => {
    setLoaded(false);
    reload()
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoaded(true));
  }, [reload]);

  async function refresh() {
    setRefreshing(true);
    try {
      await reload();
      setError(null);
    } finally {
      setRefreshing(false);
    }
  }

  async function act(fn: () => Promise<unknown>, okMsg: string) {
    setError(null);
    setMsg(null);
    setBusy(true);
    try {
      await fn();
      await reload();
      setMsg(okMsg);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function createGroup(e: React.FormEvent) {
    e.preventDefault();
    if (!gCode.trim() || !gName.trim()) { setError('A group needs a code and a name.'); return; }
    if (await act(() => expensesApi.createGroup({ groupCode: gCode.trim(), groupName: gName.trim() }), `Group "${gName.trim()}" added.`)) {
      setGCode('');
      setGName('');
      setShowGroupForm(false);
    }
  }
  async function createHead(e: React.FormEvent) {
    e.preventDefault();
    if (!hCode.trim() || !hName.trim()) { setError('A head needs a code and a name.'); return; }
    if (await act(() => expensesApi.createHead({ headCode: hCode.trim(), headName: hName.trim(), groupId: hGroup || undefined, defaultCostType: hCost }), `Head "${hName.trim()}" added; it is offered on the next voucher.`)) {
      setHCode('');
      setHName('');
      setHGroup('');
      setHCost('general');
      setShowHeadForm(false);
    }
  }
  async function saveGroup() {
    if (!editGroup) return;
    if (!editGroup.groupName.trim()) { setError('The group needs a name.'); return; }
    if (await act(() => expensesApi.updateGroup(editGroup.id, { groupName: editGroup.groupName.trim() }), `Group "${editGroup.groupName.trim()}" saved.`)) setEditGroup(null);
  }
  async function saveHead() {
    if (!editHead) return;
    if (!editHead.headName.trim()) { setError('The head needs a name.'); return; }
    if (await act(() => expensesApi.updateHead(editHead.id, { headName: editHead.headName.trim(), groupId: editHead.groupId || null, defaultCostType: editHead.defaultCostType }), `Head "${editHead.headName.trim()}" saved.`)) setEditHead(null);
  }
  /** Deactivate keeps the history: vouchers already posted still name the head; new ones cannot pick it. */
  async function toggleGroup(g: Row) {
    const off = String(g.status) === 'active';
    if (off && !(await confirm({ title: `Deactivate ${String(g.groupName)}`, message: 'The group is hidden when adding heads; nothing is deleted and you can reactivate it here.', confirmLabel: 'Deactivate' }))) return;
    await act(() => expensesApi.updateGroup(String(g.id), { status: off ? 'inactive' : 'active' }), `Group "${String(g.groupName)}" ${off ? 'deactivated' : 'reactivated'}.`);
  }
  async function toggleHead(h: Row) {
    const off = String(h.status) === 'active';
    if (off && !(await confirm({ title: `Deactivate ${String(h.headName)}`, message: 'New vouchers cannot pick it; the ones already booked keep it. You can reactivate it here.', confirmLabel: 'Deactivate' }))) return;
    await act(() => expensesApi.updateHead(String(h.id), { status: off ? 'inactive' : 'active' }), `Head "${String(h.headName)}" ${off ? 'deactivated' : 'reactivated'}.`);
  }

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const h of heads) m.set(String(h.status ?? 'active'), (m.get(String(h.status ?? 'active')) ?? 0) + 1);
    return m;
  }, [heads]);
  const shown = useMemo(() => {
    const list = filter ? heads.filter((h) => String(h.status ?? 'active') === filter) : heads;
    return [...list].sort((a, b) => String(a.groupLabel ?? '\uffff').localeCompare(String(b.groupLabel ?? '\uffff')) || String(a.headName).localeCompare(String(b.headName)));
  }, [heads, filter]);
  const headsInGroup = (gid: string) => heads.filter((h) => String(h.groupId ?? '') === gid).length;
  const activeGroups = groups.filter((g) => String(g.status) === 'active');

  return (
    <div className="mn-ord mn-eh">
      <header className="mn-board-head">
        <div className="mn-board-title">
          <h1>Expense heads</h1>
          <p>The names spend is booked under (Driver bata, Diesel, Electricity, Sundries), sorted into groups (Fleet running, Plant running). Each head says where its money usually goes, so a voucher line lands on the right truck or plant with one pick.</p>
        </div>
        <div className="mn-board-tools">
          <span className="mn-board-live mn-ord-sum" aria-live="polite">
            <Tags size={14} aria-hidden />
            {loaded ? `${counts.get('active') ?? 0} active ${(counts.get('active') ?? 0) === 1 ? 'head' : 'heads'} in ${activeGroups.length} ${activeGroups.length === 1 ? 'group' : 'groups'}` : 'Loading…'}
          </span>
          {canManage && !showHeadForm && <Button icon={<Plus size={14} />} onClick={() => { setShowHeadForm(true); setMsg(null); }}>New head</Button>}
          <Link href="/app/expenses/vouchers" className="mn-ord-link">
            <Button variant="ghost" size="sm" icon={<Receipt size={14} />}>Vouchers</Button>
          </Link>
          <Button variant="ghost" size="sm" icon={<RefreshCw size={14} />} onClick={refresh} loading={refreshing}>
            Refresh
          </Button>
        </div>
      </header>

      {error && <ErrorState message={error} />}
      {msg && <div className="mn-ord-note mn-ord-note--ok" role="status"><CheckCircle2 size={16} aria-hidden /><span>{msg}</span></div>}

      {showHeadForm && canManage && (
        <Card
          title={<span className="mn-board-card-title"><Plus size={16} aria-hidden /> New expense head</span>}
          actions={<Button variant="ghost" size="sm" icon={<X size={14} />} onClick={() => setShowHeadForm(false)}>Close</Button>}
        >
          <Form onSubmit={createHead} className="mn-eh-form">
            <Field label="Code" required help="Short and unique, e.g. DIESEL.">
              <Input value={hCode} onChange={(e) => setHCode(e.target.value.toUpperCase())} required />
            </Field>
            <Field label="Name" required>
              <Input value={hName} placeholder="e.g. Driver bata" onChange={(e) => setHName(e.target.value)} required />
            </Field>
            <Field label="Group" help={activeGroups.length ? 'Optional; keeps the reports tidy.' : 'No groups yet; add one below or leave it.'}>
              <Select value={hGroup} onChange={(e) => setHGroup(e.target.value)}>
                <option value="">No group</option>
                {groups.filter((g) => String(g.status) === 'active').map((g) => <option key={String(g.id)} value={String(g.id)}>{String(g.groupName)}</option>)}
              </Select>
            </Field>
            <Field label="Usually charged to" help="A voucher line under this head starts on this; it can still be changed per line.">
              <Select value={hCost} onChange={(e) => setHCost(e.target.value)}>
                {COST.map((t) => <option key={t.value} value={t.value} title={t.hint}>{t.label}</option>)}
              </Select>
            </Field>
            <div className="mn-eh-form-submit">
              <Button type="submit" loading={busy} icon={<Tags size={14} />}>Add head</Button>
              <Button type="button" variant="secondary" onClick={() => setShowHeadForm(false)}>Cancel</Button>
            </div>
          </Form>
        </Card>
      )}

      <Card
        title={<span className="mn-board-card-title"><FolderTree size={16} aria-hidden /> Groups <span className="mn-board-card-count">{groups.length}</span></span>}
        actions={canManage && !showGroupForm ? <Button variant="ghost" size="sm" icon={<Plus size={14} />} onClick={() => { setShowGroupForm(true); setMsg(null); }}>New group</Button> : null}
        padded={false}
      >
        {showGroupForm && canManage && (
          <Form onSubmit={createGroup} className="mn-eh-group-form">
            <Field label="Code" required><Input value={gCode} onChange={(e) => setGCode(e.target.value.toUpperCase())} required placeholder="FLEET" /></Field>
            <Field label="Group name" required><Input value={gName} placeholder="e.g. Fleet running" onChange={(e) => setGName(e.target.value)} required /></Field>
            <div className="mn-eh-form-submit">
              <Button type="submit" size="sm" loading={busy}>Add group</Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setShowGroupForm(false)}>Cancel</Button>
            </div>
          </Form>
        )}
        {!loaded ? (
          <div className="mn-ord-skel"><TableSkeleton cols={3} /></div>
        ) : groups.length ? (
          <div className="mn-eh-groups">
            {groups.map((g) => {
              const editing = editGroup?.id === String(g.id);
              const gid = String(g.id);
              const inactive = String(g.status) !== 'active';
              return (
                <div key={gid} className={`mn-eh-group${inactive ? ' is-void' : ''}`}>
                  <div className="mn-eh-group-name">
                    {editing ? (
                      <Input value={editGroup!.groupName} onChange={(e) => setEditGroup({ ...editGroup!, groupName: e.target.value })} aria-label="Group name" />
                    ) : (
                      <>
                        <span className="mn-ord-cust">{String(g.groupName)}</span>
                        <span className="mn-ord-meta">{String(g.groupCode)} · {headsInGroup(gid)} {headsInGroup(gid) === 1 ? 'head' : 'heads'}</span>
                      </>
                    )}
                  </div>
                  <StatusBadge status={String(g.status ?? 'active')} />
                  {canManage && (
                    <div className="mn-eh-acts">
                      {editing ? (
                        <>
                          <Button size="sm" onClick={saveGroup} loading={busy}>Save</Button>
                          <Button variant="ghost" size="sm" onClick={() => setEditGroup(null)}>Cancel</Button>
                        </>
                      ) : (
                        <>
                          <Button variant="ghost" size="sm" onClick={() => setEditGroup({ id: gid, groupName: String(g.groupName) })}>Edit</Button>
                          <Button variant={inactive ? 'secondary' : 'ghost'} size="sm" onClick={() => toggleGroup(g)}>{!inactive ? 'Deactivate' : 'Reactivate'}</Button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState title="No groups yet" description="Groups are optional. Fleet running, Plant running and Office are a common start." action={canManage ? <Button variant="secondary" size="sm" icon={<Plus size={14} />} onClick={() => setShowGroupForm(true)}>New group</Button> : undefined} />
        )}
      </Card>

      {/* Status strip — counts per status; press one to filter, press again for all. */}
      <div className="mn-board-strip" role="group" aria-label="Filter heads by status">
        {STATUSES.map((s) => {
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

      <Card
        title={<span className="mn-board-card-title"><Tags size={16} aria-hidden /> Heads <span className="mn-board-card-count">{shown.length}</span></span>}
        actions={<span className="mn-ord-how">Grouped, then by name. Edit opens the row in place.</span>}
        padded={false}
      >
        {!loaded ? (
          <div className="mn-ord-skel"><TableSkeleton cols={4} /></div>
        ) : shown.length ? (
          <div className="mn-ord-list" role="list">
            <div className="mn-ord-cols mn-eh-cols" aria-hidden>
              <span>Head</span>
              <span>Group</span>
              <span>Usually charged to</span>
              <span>Status</span>
              <span />
            </div>
            {shown.map((h) => {
              const hid = String(h.id);
              const editing = editHead?.id === hid;
              const inactive = String(h.status ?? 'active') !== 'active';
              return (
                <div key={hid} className={`mn-ord-row mn-eh-row${inactive ? ' is-void' : ''}${editing ? ' is-on' : ''}`} data-tone={inactive ? 'neutral' : 'success'} role="listitem">
                  <div className="mn-ord-who">
                    {editing ? (
                      <Input value={editHead!.headName} onChange={(e) => setEditHead({ ...editHead!, headName: e.target.value })} aria-label="Head name" />
                    ) : (
                      <>
                        <span className="mn-ord-cust">{String(h.headName)}</span>
                        <span className="mn-ord-meta">{String(h.headCode)}</span>
                      </>
                    )}
                  </div>
                  <div className="mn-eh-cell">
                    {editing ? (
                      <Select value={editHead!.groupId} onChange={(e) => setEditHead({ ...editHead!, groupId: e.target.value })} aria-label="Group">
                        <option value="">No group</option>
                        {groups.filter((g) => String(g.status) === 'active' || String(g.id) === editHead!.groupId).map((g) => <option key={String(g.id)} value={String(g.id)}>{String(g.groupName)}</option>)}
                      </Select>
                    ) : (
                      h.groupLabel ? <Badge tone="info">{String(h.groupLabel)}</Badge> : <span className="mn-ord-meta">No group</span>
                    )}
                  </div>
                  <div className="mn-eh-cell">
                    {editing ? (
                      <Select value={editHead!.defaultCostType} onChange={(e) => setEditHead({ ...editHead!, defaultCostType: e.target.value })} aria-label="Usually charged to">
                        {COST.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </Select>
                    ) : (
                      <><span>{costLabel(h.defaultCostType)}</span><span className="mn-ord-meta">{COST.find((c) => c.value === String(h.defaultCostType ?? 'general'))?.hint ?? ''}</span></>
                    )}
                  </div>
                  <div className="mn-ord-status"><StatusBadge status={String(h.status ?? 'active')} /></div>
                  <div className="mn-ord-act mn-eh-acts">
                    {canManage && (editing ? (
                      <>
                        <Button size="sm" onClick={saveHead} loading={busy}>Save</Button>
                        <Button variant="ghost" size="sm" onClick={() => setEditHead(null)}>Cancel</Button>
                      </>
                    ) : (
                      <>
                        <Button variant="ghost" size="sm" onClick={() => setEditHead({ id: hid, headName: String(h.headName), groupId: String(h.groupId ?? ''), defaultCostType: String(h.defaultCostType ?? 'general') })}>Edit</Button>
                        <Button variant={inactive ? 'secondary' : 'ghost'} size="sm" onClick={() => toggleHead(h)}>{!inactive ? 'Deactivate' : 'Reactivate'}</Button>
                      </>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState
            title={filter ? `No ${filter} heads` : 'No expense heads yet'}
            description={filter ? 'Press the chip again to see every head.' : canManage ? 'Add the heads you book money under: Driver bata, Diesel, Electricity, Repairs, Sundries. Each one can say where its money usually goes.' : 'Nothing to show.'}
            action={filter ? <Button variant="secondary" size="sm" onClick={() => setFilter('')}>Show all heads</Button> : canManage ? <Button size="sm" icon={<Plus size={14} />} onClick={() => setShowHeadForm(true)}>New head</Button> : undefined}
          />
        )}
      </Card>
    </div>
  );
}
