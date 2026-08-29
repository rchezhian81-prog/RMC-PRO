'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { settings, gstCredentialsApi, type SettingRow, type GstCredentialStatus } from '../../../lib/api';
import { Card } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { Field, Input } from '../../../components/ui/Field';
import { Form } from '../../../components/ui/Form';
import { Table, Th, Td } from '../../../components/ui/Table';
import { useConfirm } from '../../../components/ui/ConfirmDialog';
import { ErrorState, Loading } from '../../../components/ui/States';

export default function SettingsPage() {
  const [rows, setRows] = useState<SettingRow[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  async function reload() {
    const list = await settings.list();
    setRows(list);
    setDraft(Object.fromEntries(list.map((r) => [r.key, r.value])));
  }
  useEffect(() => {
    reload()
      .catch((e) => setError(String(e)))
      .finally(() => setLoaded(true));
  }, []);

  async function save(key: string) {
    setError(null);
    setSavedKey(null);
    try {
      await settings.set(key, draft[key] ?? '');
      setSavedKey(key);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (!loaded) return <Loading label="Loading settings…" />;

  return (
    <div style={{ display: 'grid', gap: 18, maxWidth: 760 }}>
      <div>
        <h1 style={{ fontSize: 24, margin: '0 0 4px' }}>Tenant Settings</h1>
        <p style={{ color: 'var(--mn-muted)', fontSize: 13, margin: 0 }}>
          Configuration for this company. Each setting is typed and validated.
        </p>
      </div>
      {error && <ErrorState message={error} />}

      <Card title="Settings">
        <div style={{ display: 'grid', gap: 18 }}>
          {rows.map((r) => {
            const v = draft[r.key] ?? '';
            const dirty = v !== r.value;
            return (
              <div key={r.key} style={{ display: 'grid', gap: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <label style={{ fontSize: 14, fontWeight: 600 }}>{r.label}</label>
                  <span style={{ fontSize: 11, color: 'var(--mn-subtle)', fontFamily: 'var(--mn-font-mono, monospace)' }}>{r.key}</span>
                </div>
                <p style={{ margin: 0, fontSize: 12, color: 'var(--mn-muted)' }}>{r.description}</p>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  {r.type === 'boolean' ? (
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, height: 38, cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={v === 'true'}
                        onChange={(e) => setDraft((p) => ({ ...p, [r.key]: String(e.target.checked) }))}
                        style={{ width: 16, height: 16, accentColor: 'var(--mn-primary)' }}
                      />
                      <span style={{ fontSize: 13, color: 'var(--mn-muted)' }}>{v === 'true' ? 'On' : 'Off'}</span>
                    </label>
                  ) : r.type === 'enum' ? (
                    <select
                      className="mn-input"
                      style={{ maxWidth: 280 }}
                      value={v}
                      onChange={(e) => setDraft((p) => ({ ...p, [r.key]: e.target.value }))}
                    >
                      {(r.options ?? []).map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  ) : (
                    <Input
                      type={r.type === 'number' ? 'number' : 'text'}
                      style={{ maxWidth: 280 }}
                      value={v}
                      onChange={(e) => setDraft((p) => ({ ...p, [r.key]: e.target.value }))}
                    />
                  )}
                  <Button variant="secondary" size="sm" onClick={() => save(r.key)} disabled={!dirty}>Save</Button>
                  {savedKey === r.key && !dirty && (
                    <span style={{ fontSize: 12, color: 'var(--mn-success)' }}>Saved</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <GstCredentialsCard />
    </div>
  );
}

/**
 * Manage the tenant's GST-portal logins (per GSTIN) so live e-invoice / e-way
 * filing can authenticate. The server returns REDACTED status only — passwords
 * are encrypted and never come back. Hidden when the billing module is off or
 * the user lacks settings.manage (the list call 403s).
 */
function GstCredentialsCard() {
  const { confirm } = useConfirm();
  const [creds, setCreds] = useState<GstCredentialStatus[]>([]);
  const [form, setForm] = useState({ gstin: '', username: '', password: '' });
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  async function reload() {
    try {
      setCreds(await gstCredentialsApi.list());
    } catch {
      setUnavailable(true);
    }
  }
  useEffect(() => {
    reload();
  }, []);

  async function run(fn: () => Promise<unknown>, okMsg?: string) {
    setErr(null);
    setMsg(null);
    try {
      await fn();
      await reload();
      if (okMsg) setMsg(okMsg);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed');
    }
  }

  async function add(e: FormEvent) {
    e.preventDefault();
    await run(async () => {
      await gstCredentialsApi.set(form.gstin.trim().toUpperCase(), form.username.trim(), form.password);
      setForm({ gstin: '', username: '', password: '' });
    }, 'Credentials saved');
  }

  const testLabel = (c: GstCredentialStatus) =>
    c.lastTestSuccess === true ? 'Connected' : c.lastTestSuccess === false ? 'Failed' : 'Not tested';

  if (unavailable) return null;

  return (
    <Card title="GST portal credentials">
      <p style={{ color: 'var(--mn-muted)', fontSize: 12.5, margin: '0 0 12px', maxWidth: 700 }}>
        Your GSTIN portal login, used to file e-invoices (IRN) and e-way bills live. The password is encrypted and never shown again — re-enter it to change.
      </p>
      {err && <div style={{ marginBottom: 12 }}><ErrorState message={err} /></div>}
      {msg && (
        <p style={{ color: 'var(--mn-success)', background: 'var(--mn-success-tint)', border: '1px solid var(--mn-success)', borderRadius: 'var(--mn-radius-md)', padding: '8px 12px', fontSize: 13, margin: '0 0 12px' }}>{msg}</p>
      )}

      <Table>
        <thead>
          <tr>
            <Th>GSTIN</Th>
            <Th>Connection</Th>
            <Th>Last test</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {creds.map((c) => (
            <tr key={c.gstin}>
              <Td style={{ fontWeight: 600 }}>{c.gstin}</Td>
              <Td style={{ color: c.lastTestSuccess === false ? 'var(--mn-danger)' : c.lastTestSuccess === true ? 'var(--mn-success)' : 'var(--mn-muted)' }}>
                {testLabel(c)}
                {c.lastTestMessage ? <span style={{ color: 'var(--mn-muted)', fontSize: 11, display: 'block' }}>{c.lastTestMessage}</span> : null}
              </Td>
              <Td style={{ color: 'var(--mn-muted)', fontSize: 12 }}>{c.lastTestedAt ? String(c.lastTestedAt).slice(0, 16).replace('T', ' ') : '—'}</Td>
              <Td style={{ textAlign: 'right' }}>
                <span style={{ display: 'inline-flex', gap: 6 }}>
                  <Button variant="secondary" size="sm" onClick={() => run(() => gstCredentialsApi.test(c.gstin), 'Connection tested')}>Test</Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      run(async () => {
                        if (!(await confirm({ title: 'Remove credentials', message: `Delete the stored portal login for ${c.gstin}?`, confirmLabel: 'Remove', danger: true }))) return;
                        await gstCredentialsApi.remove(c.gstin);
                      }, 'Credentials removed')
                    }
                  >
                    Remove
                  </Button>
                </span>
              </Td>
            </tr>
          ))}
          {!creds.length && (
            <tr><Td colSpan={4} style={{ color: 'var(--mn-muted)' }}>No GST credentials configured yet.</Td></tr>
          )}
        </tbody>
      </Table>

      <Form onSubmit={add} style={{ display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap', marginTop: 14 }}>
        <div style={{ minWidth: 190 }}>
          <Field label="GSTIN" required>
            <Input value={form.gstin} onChange={(e) => setForm({ ...form, gstin: e.target.value })} placeholder="33ABCDE1234F1Z5" required />
          </Field>
        </div>
        <div style={{ minWidth: 160 }}>
          <Field label="Portal username" required>
            <Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required />
          </Field>
        </div>
        <div style={{ minWidth: 160 }}>
          <Field label="Portal password" required>
            <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
          </Field>
        </div>
        <div style={{ marginBottom: 14 }}>
          <Button type="submit" variant="secondary">Save credentials</Button>
        </div>
      </Form>
    </Card>
  );
}
