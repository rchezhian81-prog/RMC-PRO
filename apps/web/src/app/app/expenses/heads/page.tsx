'use client';

import { useEffect, useState } from 'react';
import { expensesApi, type Row } from '../../../../lib/api';
import { getAccess } from '../../../../lib/session';
import { Card } from '../../../../components/ui/Card';
import { Table, Th, Td } from '../../../../components/ui/Table';
import { Button } from '../../../../components/ui/Button';
import { StatusBadge } from '../../../../components/ui/Badge';
import { Field, Input } from '../../../../components/ui/Field';
import { ErrorState, EmptyState, TableSkeleton } from '../../../../components/ui/States';
import { useConfirm } from '../../../../components/ui/ConfirmDialog';

const COST_TYPES = ['general', 'plant', 'vehicle', 'site'];

export default function ExpenseHeadsPage() {
  const [groups, setGroups] = useState<Row[]>([]);
  const [heads, setHeads] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const [gCode, setGCode] = useState('');
  const [gName, setGName] = useState('');

  const [hCode, setHCode] = useState('');
  const [hName, setHName] = useState('');
  const [hGroup, setHGroup] = useState('');
  const [hCost, setHCost] = useState('general');

  const canManage = getAccess().has('expenses.manage');
  const { confirm } = useConfirm();
  // One row at a time is open for editing, for a group or for a head.
  const [editGroup, setEditGroup] = useState<{ id: string; groupName: string } | null>(null);
  const [editHead, setEditHead] = useState<{ id: string; headName: string; groupId: string; defaultCostType: string } | null>(null);

  async function reload() {
    const [g, h] = await Promise.all([expensesApi.groups(), expensesApi.heads()]);
    setGroups(g); setHeads(h);
  }
  useEffect(() => {
    reload().catch((e) => setError(e instanceof Error ? e.message : String(e))).finally(() => setLoaded(true));
  }, []);

  async function createGroup() {
    setError(null); setMsg(null);
    if (!gCode.trim() || !gName.trim()) { setError('Group code and name are required'); return; }
    setBusy(true);
    try {
      await expensesApi.createGroup({ groupCode: gCode.trim(), groupName: gName.trim() });
      setMsg(`Expense group ${gName} added.`); setGCode(''); setGName(''); await reload();
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(false); }
  }

  async function createHead() {
    setError(null); setMsg(null);
    if (!hCode.trim() || !hName.trim()) { setError('Head code and name are required'); return; }
    setBusy(true);
    try {
      await expensesApi.createHead({ headCode: hCode.trim(), headName: hName.trim(), groupId: hGroup || undefined, defaultCostType: hCost });
      setMsg(`Expense head ${hName} added.`); setHCode(''); setHName(''); setHGroup(''); setHCost('general'); await reload();
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(false); }
  }

  async function act(fn: () => Promise<unknown>, okMsg: string) {
    setError(null); setMsg(null); setBusy(true);
    try { await fn(); await reload(); setMsg(okMsg); } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(false); }
  }
  async function saveGroup() {
    if (!editGroup) return;
    if (!editGroup.groupName.trim()) { setError('Group name is required'); return; }
    await act(() => expensesApi.updateGroup(editGroup.id, { groupName: editGroup.groupName.trim() }), `Group "${editGroup.groupName.trim()}" saved.`);
    setEditGroup(null);
  }
  async function saveHead() {
    if (!editHead) return;
    if (!editHead.headName.trim()) { setError('Head name is required'); return; }
    await act(() => expensesApi.updateHead(editHead.id, { headName: editHead.headName.trim(), groupId: editHead.groupId || null, defaultCostType: editHead.defaultCostType }), `Head "${editHead.headName.trim()}" saved.`);
    setEditHead(null);
  }
  /** Deactivate keeps the history: vouchers already posted still name the head; new ones cannot pick it. */
  async function toggleGroup(g: Row) {
    const off = String(g.status) === 'active';
    if (off && !(await confirm({ title: 'Deactivate group', message: `Deactivate "${String(g.groupName)}"? It is hidden from new heads, not deleted; you can reactivate it here.`, confirmLabel: 'Deactivate', danger: true }))) return;
    await act(() => expensesApi.updateGroup(String(g.id), { status: off ? 'inactive' : 'active' }), `Group "${String(g.groupName)}" ${off ? 'deactivated' : 'reactivated'}.`);
  }
  async function toggleHead(h: Row) {
    const off = String(h.status) === 'active';
    if (off && !(await confirm({ title: 'Deactivate head', message: `Deactivate "${String(h.headName)}"? New vouchers cannot use it; existing vouchers keep it. You can reactivate it here.`, confirmLabel: 'Deactivate', danger: true }))) return;
    await act(() => expensesApi.updateHead(String(h.id), { status: off ? 'inactive' : 'active' }), `Head "${String(h.headName)}" ${off ? 'deactivated' : 'reactivated'}.`);
  }

  return (
    <div>
      <h1 style={{ fontSize: 24, marginTop: 0, marginBottom: 4 }}>Expense Heads</h1>
      <p style={{ color: 'var(--mn-muted)', fontSize: 13, margin: '0 0 16px' }}>Categorise spend: expense groups and the individual heads under them. Edit a name or move a head between groups any time; deactivate what you no longer use (existing vouchers keep it) and reactivate it later.</p>
      {error && <div style={{ marginBottom: 14 }}><ErrorState message={error} /></div>}
      {msg && (
        <p style={{ color: 'var(--mn-success)', background: 'var(--mn-success-tint)', border: '1px solid var(--mn-success)', borderRadius: 'var(--mn-radius-md)', padding: '10px 12px', fontSize: 13 }}>{msg}</p>
      )}

      <div style={{ marginBottom: 18 }}>
        <Card title="Expense groups" padded={false}>
          {canManage && (
            <div style={{ display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap', padding: '14px 16px', borderBottom: '1px solid var(--mn-border)' }}>
              <div style={{ width: 140 }}><Field label="Code" required><Input value={gCode} onChange={(e) => setGCode(e.target.value)} /></Field></div>
              <div style={{ minWidth: 220 }}><Field label="Group name" required><Input value={gName} placeholder="Fuel & Lubricants" onChange={(e) => setGName(e.target.value)} /></Field></div>
              <Button onClick={createGroup} loading={busy}>Add group</Button>
            </div>
          )}
          {!loaded ? (
            <TableSkeleton cols={3} />
          ) : groups.length ? (
            <Table>
              <thead><tr><Th>Code</Th><Th>Group</Th><Th>Status</Th>{canManage && <Th />}</tr></thead>
              <tbody>
                {groups.map((g) => {
                  const editing = editGroup?.id === String(g.id);
                  return (
                    <tr key={String(g.id)}>
                      <Td style={{ fontWeight: 600 }}>{String(g.groupCode)}</Td>
                      <Td>{editing ? <Input value={editGroup!.groupName} onChange={(e) => setEditGroup({ ...editGroup!, groupName: e.target.value })} /> : String(g.groupName)}</Td>
                      <Td><StatusBadge status={String(g.status)} /></Td>
                      {canManage && (
                        <Td style={{ textAlign: 'right' }}>
                          <div style={{ display: 'inline-flex', gap: 6 }}>
                            {editing ? (
                              <>
                                <Button size="sm" onClick={saveGroup} loading={busy}>Save</Button>
                                <Button variant="secondary" size="sm" onClick={() => setEditGroup(null)}>Cancel</Button>
                              </>
                            ) : (
                              <>
                                <Button variant="secondary" size="sm" onClick={() => setEditGroup({ id: String(g.id), groupName: String(g.groupName) })}>Edit</Button>
                                <Button variant={String(g.status) === 'active' ? 'danger' : 'secondary'} size="sm" onClick={() => toggleGroup(g)}>
                                  {String(g.status) === 'active' ? 'Deactivate' : 'Reactivate'}
                                </Button>
                              </>
                            )}
                          </div>
                        </Td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          ) : (
            <EmptyState title="No expense groups yet" description={canManage ? 'Add a category above.' : 'Nothing to show.'} />
          )}
        </Card>
      </div>

      <Card title="Expense heads" padded={false}>
        {canManage && (
          <div style={{ display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap', padding: '14px 16px', borderBottom: '1px solid var(--mn-border)' }}>
            <div style={{ width: 140 }}><Field label="Code" required><Input value={hCode} onChange={(e) => setHCode(e.target.value)} /></Field></div>
            <div style={{ minWidth: 200 }}><Field label="Head name" required><Input value={hName} placeholder="Driver Bata" onChange={(e) => setHName(e.target.value)} /></Field></div>
            <div style={{ minWidth: 180 }}>
              <Field label="Group">
                <select className="mn-input" value={hGroup} onChange={(e) => setHGroup(e.target.value)}>
                  <option value="">— none —</option>
                  {groups.filter((g) => String(g.status) === 'active').map((g) => <option key={String(g.id)} value={String(g.id)}>{String(g.groupName)}</option>)}
                </select>
              </Field>
            </div>
            <div style={{ width: 140 }}>
              <Field label="Default cost">
                <select className="mn-input" value={hCost} onChange={(e) => setHCost(e.target.value)}>
                  {COST_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </Field>
            </div>
            <Button onClick={createHead} loading={busy}>Add head</Button>
          </div>
        )}
        {!loaded ? (
          <TableSkeleton cols={4} />
        ) : heads.length ? (
          <Table>
            <thead><tr><Th>Code</Th><Th>Head</Th><Th>Group</Th><Th>Default cost</Th><Th>Status</Th>{canManage && <Th />}</tr></thead>
            <tbody>
              {heads.map((h) => {
                const editing = editHead?.id === String(h.id);
                return (
                  <tr key={String(h.id)}>
                    <Td style={{ fontWeight: 600 }}>{String(h.headCode)}</Td>
                    <Td>{editing ? <Input value={editHead!.headName} onChange={(e) => setEditHead({ ...editHead!, headName: e.target.value })} /> : String(h.headName)}</Td>
                    <Td>
                      {editing ? (
                        <select className="mn-input" value={editHead!.groupId} onChange={(e) => setEditHead({ ...editHead!, groupId: e.target.value })}>
                          <option value="">— none —</option>
                          {groups.filter((g) => String(g.status) === 'active' || String(g.id) === editHead!.groupId).map((g) => <option key={String(g.id)} value={String(g.id)}>{String(g.groupName)}</option>)}
                        </select>
                      ) : String(h.groupLabel ?? '—')}
                    </Td>
                    <Td>
                      {editing ? (
                        <select className="mn-input" value={editHead!.defaultCostType} onChange={(e) => setEditHead({ ...editHead!, defaultCostType: e.target.value })}>
                          {COST_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                        </select>
                      ) : String(h.defaultCostType ?? 'general')}
                    </Td>
                    <Td><StatusBadge status={String(h.status)} /></Td>
                    {canManage && (
                      <Td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', gap: 6 }}>
                          {editing ? (
                            <>
                              <Button size="sm" onClick={saveHead} loading={busy}>Save</Button>
                              <Button variant="secondary" size="sm" onClick={() => setEditHead(null)}>Cancel</Button>
                            </>
                          ) : (
                            <>
                              <Button variant="secondary" size="sm" onClick={() => setEditHead({ id: String(h.id), headName: String(h.headName), groupId: String(h.groupId ?? ''), defaultCostType: String(h.defaultCostType ?? 'general') })}>Edit</Button>
                              <Button variant={String(h.status) === 'active' ? 'danger' : 'secondary'} size="sm" onClick={() => toggleHead(h)}>
                                {String(h.status) === 'active' ? 'Deactivate' : 'Reactivate'}
                              </Button>
                            </>
                          )}
                        </div>
                      </Td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="No expense heads yet" description={canManage ? 'Add a head above.' : 'Nothing to show.'} />
        )}
      </Card>
    </div>
  );
}
