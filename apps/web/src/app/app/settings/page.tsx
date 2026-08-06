'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { settings, type Row } from '../../../lib/api';
import { Card } from '../../../components/ui/Card';
import { Table, Th, Td } from '../../../components/ui/Table';
import { Button } from '../../../components/ui/Button';
import { Form } from '../../../components/ui/Form';
import { Field, Input } from '../../../components/ui/Field';
import { ErrorState, EmptyState } from '../../../components/ui/States';

export default function SettingsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [edit, setEdit] = useState<Record<string, string>>({});
  const [newKey, setNewKey] = useState('');
  const [newVal, setNewVal] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    const list = await settings.list();
    setRows(list);
    setEdit(Object.fromEntries(list.map((r) => [String(r.settingKey), String(r.settingValue ?? '')])));
  }
  useEffect(() => {
    reload().catch((e) => setError(String(e)));
  }, []);

  async function save(key: string) {
    setError(null);
    try {
      await settings.set(key, edit[key] ?? '');
      await reload();
    } catch (e) {
      setError(String(e));
    }
  }
  async function add(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await settings.set(newKey, newVal);
      setNewKey('');
      setNewVal('');
      await reload();
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <h1 style={{ fontSize: 24, margin: 0 }}>Tenant Settings</h1>
      {error && <ErrorState message={error} />}

      <Card title="Settings" padded={false}>
        {rows.length ? (
          <Table>
            <thead>
              <tr>
                <Th>Key</Th>
                <Th>Value</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const key = String(r.settingKey);
                return (
                  <tr key={r.id}>
                    <Td style={{ fontWeight: 600 }}>{key}</Td>
                    <Td>
                      <Input style={{ maxWidth: 280 }} value={edit[key] ?? ''} onChange={(e) => setEdit((p) => ({ ...p, [key]: e.target.value }))} />
                    </Td>
                    <Td style={{ textAlign: 'right' }}>
                      <Button variant="secondary" size="sm" onClick={() => save(key)}>Save</Button>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="No settings yet" description="Add a tenant setting below." />
        )}
      </Card>

      <Card title="Add setting">
        <Form onSubmit={add} style={{ display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 200 }}>
            <Field label="Key" required>
              <Input value={newKey} onChange={(e) => setNewKey(e.target.value)} required />
            </Field>
          </div>
          <div style={{ minWidth: 200 }}>
            <Field label="Value">
              <Input value={newVal} onChange={(e) => setNewVal(e.target.value)} />
            </Field>
          </div>
          <div style={{ marginBottom: 14 }}>
            <Button type="submit">Add</Button>
          </div>
        </Form>
      </Card>
    </div>
  );
}
