'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { rolesApi, type Row } from '../../../lib/api';
import { Card } from '../../../components/ui/Card';
import { Table, Th, Td } from '../../../components/ui/Table';
import { Button } from '../../../components/ui/Button';
import { Form } from '../../../components/ui/Form';
import { Field, Input } from '../../../components/ui/Field';
import { ErrorState, EmptyState, TableSkeleton } from '../../../components/ui/States';
import { useConfirm } from '../../../components/ui/ConfirmDialog';

export default function RolesPage() {
  const { confirm } = useConfirm();
  const [roles, setRoles] = useState<Row[]>([]);
  const [catalog, setCatalog] = useState<Row[]>([]);
  const [selRole, setSelRole] = useState<Row | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [form, setForm] = useState({ roleKey: '', roleName: '' });
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function reload() {
    const [r, c] = await Promise.all([rolesApi.list(true), rolesApi.catalog()]);
    setRoles(r);
    setCatalog(c);
  }
  useEffect(() => {
    reload()
      .catch((e) => setError(String(e)))
      .finally(() => setLoaded(true));
  }, []);

  async function selectRole(role: Row) {
    setSelRole(role);
    setMsg(null);
    setChecked(new Set(await rolesApi.getPerms(String(role.id))));
  }
  function toggle(id: string) {
    setChecked((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  async function savePerms() {
    if (!selRole) return;
    setError(null);
    try {
      await rolesApi.setPerms(String(selRole.id), [...checked]);
      setMsg('Permissions saved.');
    } catch (e) {
      setError(String(e));
    }
  }
  async function createRole(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await rolesApi.create(form);
      setForm({ roleKey: '', roleName: '' });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  }

  function startRename(r: Row) {
    setEditingRoleId(String(r.id));
    setEditName(String(r.roleName ?? ''));
    setError(null);
  }
  async function saveRename() {
    if (!editingRoleId) return;
    setError(null);
    try {
      await rolesApi.update(editingRoleId, { roleName: editName });
      setEditingRoleId(null);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  /**
   * A custom role is deleted; a standard one is archived (it leaves every list
   * and nobody can be given it, and Restore brings it back). The two core roles
   * cannot be removed at all — the server refuses, and the buttons are not shown.
   */
  async function deleteRole(r: Row) {
    const system = Boolean(r.isSystemRole);
    if (
      !(await confirm({
        title: system ? 'Archive role' : 'Delete role',
        message: system
          ? `Archive "${String(r.roleName)}"? It disappears from the role lists and nobody can be given it. You can restore it here later.`
          : `Delete role "${String(r.roleName)}"? This cannot be undone.`,
        confirmLabel: system ? 'Archive' : 'Delete',
        danger: true,
      }))
    ) {
      return;
    }
    setError(null);
    setMsg(null);
    try {
      const out = await rolesApi.remove(String(r.id));
      if (selRole && selRole.id === r.id) setSelRole(null);
      await reload();
      setMsg(out.archived ? `Role "${String(r.roleName)}" archived.` : `Role "${String(r.roleName)}" deleted.`);
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
      setMsg(`Role "${String(r.roleName)}" restored.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  const CORE = new Set(['company_owner', 'company_admin']);
  const active = roles.filter((r) => !r.archivedAt);
  const archived = roles.filter((r) => Boolean(r.archivedAt));

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <h1 style={{ fontSize: 24, margin: 0 }}>Roles &amp; Permissions</h1>
      <p style={{ color: 'var(--mn-muted)', fontSize: 13, margin: '-8px 0 0' }}>
        Every role can be renamed and its permissions changed. A standard role you do not use can be archived and restored later; a role you created can be deleted. Company Owner and Company Admin always stay.
      </p>
      {error && <ErrorState message={error} />}
      {msg && <div style={{ color: 'var(--mn-success)', fontSize: 13 }}>{msg}</div>}

      <div className="mn-crud">
        <div className="mn-crud-aside">
      <Card title="New role">
        <Form onSubmit={createRole} style={{ display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 180 }}>
            <Field label="Role key" required>
              <Input value={form.roleKey} onChange={(e) => setForm({ ...form, roleKey: e.target.value })} required />
            </Field>
          </div>
          <div style={{ minWidth: 220 }}>
            <Field label="Role name" required>
              <Input value={form.roleName} onChange={(e) => setForm({ ...form, roleName: e.target.value })} required />
            </Field>
          </div>
          <div style={{ marginBottom: 14 }}>
            <Button type="submit">Create</Button>
          </div>
        </Form>
      </Card>
        </div>
        <div className="mn-crud-main">
      <Card title="Roles" padded={false}>
        {!loaded ? (
          <TableSkeleton cols={4} />
        ) : active.length ? (
          <Table>
            <thead>
              <tr>
                <Th>Role</Th>
                <Th>Key</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {active.map((r) => {
                const isEditing = editingRoleId === String(r.id);
                const system = Boolean(r.isSystemRole);
                const core = CORE.has(String(r.roleKey));
                return (
                  <tr key={r.id}>
                    <Td style={{ fontWeight: 600 }}>
                      {isEditing ? (
                        <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
                      ) : (
                        <>
                          {String(r.roleName ?? '')}
                          {system && (
                            <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--mn-muted)' }}>
                              system
                            </span>
                          )}
                        </>
                      )}
                    </Td>
                    <Td>{String(r.roleKey ?? '')}</Td>
                    <Td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: 6 }}>
                        {isEditing ? (
                          <>
                            <Button size="sm" onClick={saveRename}>Save</Button>
                            <Button variant="secondary" size="sm" onClick={() => setEditingRoleId(null)}>
                              Cancel
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button variant="secondary" size="sm" onClick={() => selectRole(r)}>
                              Permissions
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => startRename(r)}>
                              Rename
                            </Button>
                            {!core && (
                              <Button variant="danger" size="sm" onClick={() => deleteRole(r)}>
                                {system ? 'Archive' : 'Delete'}
                              </Button>
                            )}
                          </>
                        )}
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="No roles yet" />
        )}
      </Card>
      {archived.length > 0 && (
        <Card title={`Archived roles (${archived.length})`} padded={false}>
          <Table>
            <thead>
              <tr><Th>Role</Th><Th>Key</Th><Th>Archived</Th><Th /></tr>
            </thead>
            <tbody>
              {archived.map((r) => (
                <tr key={String(r.id)}>
                  <Td style={{ fontWeight: 600, color: 'var(--mn-muted)' }}>{String(r.roleName ?? '')}</Td>
                  <Td>{String(r.roleKey ?? '')}</Td>
                  <Td>{String(r.archivedAt ?? '').slice(0, 10)}</Td>
                  <Td style={{ textAlign: 'right' }}>
                    <Button variant="secondary" size="sm" onClick={() => restoreRole(r)}>Restore</Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
        </div>
      </div>

      {selRole && (
        <Card
          title={`Permissions — ${String(selRole.roleName)}`}
          actions={msg ? <span style={{ color: 'var(--mn-success)', fontSize: 12 }}>{msg}</span> : undefined}
        >
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
            {catalog.map((p) => {
              const id = String(p.id);
              const on = checked.has(id);
              return (
                <label
                  key={id}
                  style={{
                    display: 'flex',
                    gap: 6,
                    alignItems: 'center',
                    fontSize: 12.5,
                    border: `1px solid ${on ? 'var(--mn-primary)' : 'var(--mn-border)'}`,
                    background: on ? 'var(--mn-purple-50)' : 'var(--mn-surface)',
                    color: on ? 'var(--mn-primary)' : 'var(--mn-text)',
                    borderRadius: 'var(--mn-radius-pill)',
                    padding: '5px 11px',
                    cursor: 'pointer',
                  }}
                >
                  <input type="checkbox" checked={on} onChange={() => toggle(id)} />
                  {String(p.permissionKey)}
                </label>
              );
            })}
          </div>
          <Button onClick={savePerms}>Save permissions</Button>
        </Card>
      )}
    </div>
  );
}
