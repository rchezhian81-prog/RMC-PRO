'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { company } from '../../../lib/api';
import { button, card, input } from '../../../lib/ui';

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
      <h1 style={{ fontSize: 22, marginTop: 0 }}>Company Profile</h1>
      <section style={{ ...card, maxWidth: 420 }}>
        <form onSubmit={save}>
          {FIELDS.map(([k, label]) => (
            <div key={k} style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, color: 'var(--muted)' }}>{label}</label>
              <input
                style={input}
                value={form[k] ?? ''}
                onChange={(e) => setForm((p) => ({ ...p, [k]: e.target.value }))}
              />
            </div>
          ))}
          <button style={button}>Save</button>
          {msg && <span style={{ marginLeft: 12, color: '#6ee7a8', fontSize: 13 }}>{msg}</span>}
          {error && <p style={{ color: '#ff8080', fontSize: 13 }}>{error}</p>}
        </form>
      </section>
    </div>
  );
}
