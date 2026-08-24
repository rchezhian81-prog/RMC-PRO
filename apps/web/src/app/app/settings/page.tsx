'use client';

import { useEffect, useState } from 'react';
import { settings, type SettingRow } from '../../../lib/api';
import { Card } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Field';
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
    </div>
  );
}
