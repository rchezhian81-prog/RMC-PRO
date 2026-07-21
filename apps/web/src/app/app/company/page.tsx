'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { company } from '../../../lib/api';
import { Card } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { Field, Input } from '../../../components/ui/Field';
import { ErrorState } from '../../../components/ui/States';

const FIELDS: Array<[string, string]> = [
  ['companyName', 'Company name'],
  ['gstin', 'GSTIN'],
  ['state', 'State'],
];

export default function CompanyPage() {
  const [form, setForm] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    company
      .get()
      .then((c) => {
        if (c)
          setForm({
            companyName: String(c.companyName ?? ''),
            gstin: String(c.gstin ?? ''),
            state: String(c.state ?? ''),
          });
      })
      .catch((e) => setError(String(e)));
  }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    setError(null);
    try {
      await company.update({ companyName: form.companyName, gstin: form.gstin, state: form.state });
      setMsg('Saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  }

  return (
    <div>
      <h1 style={{ fontSize: 24, marginTop: 0, marginBottom: 16 }}>Company Profile</h1>
      <div style={{ maxWidth: 440 }}>
        <Card title="Company details">
          <form onSubmit={save}>
            {FIELDS.map(([k, label]) => (
              <Field key={k} label={label}>
                <Input value={form[k] ?? ''} onChange={(e) => setForm((p) => ({ ...p, [k]: e.target.value }))} />
              </Field>
            ))}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
              <Button type="submit">Save</Button>
              {msg && <span style={{ color: 'var(--mn-success)', fontSize: 13 }}>{msg}</span>}
            </div>
            {error && <div style={{ marginTop: 12 }}><ErrorState message={error} /></div>}
          </form>
        </Card>
      </div>
    </div>
  );
}
