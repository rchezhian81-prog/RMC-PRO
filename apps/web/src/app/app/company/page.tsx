'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { company } from '../../../lib/api';
import { Card } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { Form } from '../../../components/ui/Form';
import { Field, Input } from '../../../components/ui/Field';
import { ErrorState } from '../../../components/ui/States';

/**
 * The plant's own legal identity, grouped the way it reads on a tax invoice.
 * Every field is what customers, auditors and the GST portal expect to see, so
 * the sections mirror an invoice: who you are, where you are, how to reach you,
 * and where to pay.
 */
const SECTIONS: Array<{ title: string; help?: string; fields: Array<[string, string, string?]> }> = [
  {
    title: 'Identity',
    help: 'Shown at the top of every invoice and quotation.',
    fields: [
      ['companyName', 'Company name (trading name)'],
      ['legalName', 'Registered legal name', 'If different from the trading name'],
      ['gstin', 'GSTIN', '15-character GST number'],
      ['pan', 'PAN'],
    ],
  },
  {
    title: 'Address',
    help: 'Your plant / registered address. The state decides CGST+SGST vs IGST on invoices.',
    fields: [
      ['addressLine1', 'Address line 1'],
      ['addressLine2', 'Address line 2'],
      ['city', 'City'],
      ['state', 'State'],
      ['pincode', 'PIN code'],
    ],
  },
  {
    title: 'Contact',
    fields: [
      ['phone', 'Phone'],
      ['email', 'Email'],
      ['website', 'Website'],
    ],
  },
  {
    title: 'Bank details',
    help: 'Printed on the invoice so customers know where to pay.',
    fields: [
      ['bankName', 'Bank name'],
      ['bankAccountNo', 'Account number'],
      ['bankIfsc', 'IFSC'],
      ['bankBranch', 'Branch'],
    ],
  },
];

const ALL_KEYS = SECTIONS.flatMap((s) => s.fields.map(([k]) => k));

export default function CompanyPage() {
  const [form, setForm] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    company
      .get()
      .then((c) => {
        if (c) {
          const next: Record<string, string> = {};
          for (const k of ALL_KEYS) next[k] = String((c as Record<string, unknown>)[k] ?? '');
          setForm(next);
        }
      })
      .catch((e) => setError(String(e)));
  }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    setError(null);
    try {
      // Send only the profile keys, trimmed.
      const payload: Record<string, string> = {};
      for (const k of ALL_KEYS) payload[k] = (form[k] ?? '').trim();
      await company.update(payload);
      setMsg('Saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  }

  return (
    <div style={{ maxWidth: 720 }}>
      <h1 style={{ fontSize: 24, marginTop: 0, marginBottom: 4 }}>Company Profile</h1>
      <p style={{ color: 'var(--mn-muted)', fontSize: 13, margin: '0 0 18px' }}>
        These details appear on every invoice and quotation you send. Fill them in once.
      </p>

      {error && <div style={{ marginBottom: 14 }}><ErrorState message={error} /></div>}

      <Form onSubmit={save}>
        <div style={{ display: 'grid', gap: 18 }}>
          {SECTIONS.map((section) => (
            <Card key={section.title} title={section.title}>
              {section.help && (
                <p style={{ color: 'var(--mn-subtle)', fontSize: 12, margin: '0 0 12px' }}>{section.help}</p>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                {section.fields.map(([k, label, help]) => (
                  <Field key={k} label={label} help={help}>
                    <Input value={form[k] ?? ''} onChange={(e) => setForm((p) => ({ ...p, [k]: e.target.value }))} />
                  </Field>
                ))}
              </div>
            </Card>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 18 }}>
          <Button type="submit">Save profile</Button>
          {msg && <span style={{ color: 'var(--mn-success)', fontSize: 13 }}>{msg}</span>}
        </div>
      </Form>
    </div>
  );
}
