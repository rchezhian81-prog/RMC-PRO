'use client';

import { useEffect, useState } from 'react';
import { MessageSquareText, Copy, X, Send } from 'lucide-react';
import { templatesApi, type MessageTemplate } from '../lib/api';
import { renderTemplate, whatsappLink } from '../lib/templates';
import { Button } from './ui/Button';

/** Cached for the session — the catalogue is small and never changes mid-use. */
let cache: { companyName: string; templates: MessageTemplate[] } | null = null;

/**
 * Compose a standard customer message from a template.
 *
 * Everything happens locally: the catalogue is fetched once, merge fields are
 * filled from the row the user clicked, and the result can be copied or opened
 * straight in WhatsApp. No external service, no per-message cost.
 */
export function TemplateButton({
  templateKeys,
  context,
  mobile,
  label = 'Message',
  title = 'Compose message',
}: {
  /** Which templates apply on this screen, in preference order. */
  templateKeys: string[];
  /** Values for the merge fields (customerName, amount, …). */
  context: Record<string, unknown>;
  /** Customer mobile — enables the "Send on WhatsApp" action. */
  mobile?: unknown;
  label?: string;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(cache);
  const [activeKey, setActiveKey] = useState<string>(templateKeys[0] ?? '');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Load the catalogue once, then render the first applicable template.
  useEffect(() => {
    if (!open || data) return;
    setBusy(true);
    templatesApi
      .list()
      .then((r) => {
        cache = r;
        setData(r);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load templates.'))
      .finally(() => setBusy(false));
  }, [open, data]);

  const available = (data?.templates ?? []).filter((t) => templateKeys.includes(t.key));
  const active = available.find((t) => t.key === activeKey) ?? available[0];

  // Re-render whenever the chosen template or the row's context changes.
  useEffect(() => {
    if (!active || !data) return;
    setText(renderTemplate(active.body, { ...context, companyName: data.companyName }).text);
    setCopied(false);
    // context is rebuilt by the parent on every render; key off its values, not identity.
  }, [active, data, JSON.stringify(context)]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — the text is selectable in the box */
    }
  }

  const waHref = whatsappLink(mobile, text);

  return (
    <>
      <Button variant="ghost" size="sm" icon={<MessageSquareText size={14} />} onClick={() => setOpen(true)}>
        {label}
      </Button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.45)',
            display: 'grid',
            placeItems: 'center',
            padding: 20,
            zIndex: 60,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: 560,
              background: 'var(--mn-surface)',
              border: '1px solid var(--mn-border)',
              borderRadius: 'var(--mn-radius-lg)',
              boxShadow: 'var(--mn-shadow-card)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 16px',
                borderBottom: '1px solid var(--mn-border)',
              }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: 600 }}>
                <MessageSquareText size={16} color="var(--mn-primary)" /> {title}
              </span>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--mn-muted)' }}
              >
                <X size={18} />
              </button>
            </div>

            <div style={{ padding: 16, display: 'grid', gap: 10 }}>
              {busy ? (
                <p style={{ margin: 0, color: 'var(--mn-muted)', fontSize: 13 }}>Loading templates…</p>
              ) : error ? (
                <p style={{ margin: 0, color: 'var(--mn-danger)', fontSize: 13 }}>{error}</p>
              ) : !active ? (
                <p style={{ margin: 0, color: 'var(--mn-muted)', fontSize: 13 }}>No template available for this screen.</p>
              ) : (
                <>
                  {available.length > 1 && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {available.map((t) => (
                        <button
                          key={t.key}
                          onClick={() => setActiveKey(t.key)}
                          title={t.description}
                          style={{
                            border: '1px solid var(--mn-border)',
                            background: t.key === active.key ? 'var(--mn-primary)' : 'var(--mn-surface-2)',
                            color: t.key === active.key ? '#fff' : 'var(--mn-text)',
                            borderRadius: 999,
                            padding: '4px 12px',
                            fontSize: 12.5,
                            cursor: 'pointer',
                          }}
                        >
                          {t.name}
                        </button>
                      ))}
                    </div>
                  )}

                  <textarea
                    className="mn-input"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    rows={12}
                    style={{ resize: 'vertical', fontSize: 14, lineHeight: 1.5 }}
                  />

                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                    <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>
                      Close
                    </Button>
                    <Button variant="secondary" size="sm" icon={<Copy size={14} />} onClick={copy}>
                      {copied ? 'Copied' : 'Copy'}
                    </Button>
                    {waHref && (
                      <a href={waHref} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
                        <Button size="sm" icon={<Send size={14} />}>
                          Send on WhatsApp
                        </Button>
                      </a>
                    )}
                  </div>

                  <p style={{ margin: 0, color: 'var(--mn-subtle)', fontSize: 11.5 }}>
                    {waHref
                      ? 'Opens WhatsApp with the message ready — you still press send.'
                      : 'Add a mobile number to the customer master to send directly on WhatsApp.'}
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
