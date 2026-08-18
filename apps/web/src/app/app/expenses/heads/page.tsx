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

  return (
    <div>
      <h1 style={{ fontSize: 24, marginTop: 0, marginBottom: 4 }}>Expense Heads</h1>
      <p style={{ color: 'var(--mn-muted)', fontSize: 13, margin: '0 0 16px' }}>Categorise spend: expense groups and the individual heads under them.</p>
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
              <thead><tr><Th>Code</Th><Th>Group</Th><Th>Status</Th></tr></thead>
              <tbody>
                {groups.map((g) => (
                  <tr key={String(g.id)}>
                    <Td style={{ fontWeight: 600 }}>{String(g.groupCode)}</Td>
                    <Td>{String(g.groupName)}</Td>
                    <Td><StatusBadge status={String(g.status)} /></Td>
                  </tr>
                ))}
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
                  {groups.map((g) => <option key={String(g.id)} value={String(g.id)}>{String(g.groupName)}</option>)}
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
            <thead><tr><Th>Code</Th><Th>Head</Th><Th>Group</Th><Th>Default cost</Th><Th>Status</Th></tr></thead>
            <tbody>
              {heads.map((h) => (
                <tr key={String(h.id)}>
                  <Td style={{ fontWeight: 600 }}>{String(h.headCode)}</Td>
                  <Td>{String(h.headName)}</Td>
                  <Td>{String(h.groupLabel ?? '—')}</Td>
                  <Td>{String(h.defaultCostType ?? 'general')}</Td>
                  <Td><StatusBadge status={String(h.status)} /></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="No expense heads yet" description={canManage ? 'Add a head above.' : 'Nothing to show.'} />
        )}
      </Card>
    </div>
  );
}
