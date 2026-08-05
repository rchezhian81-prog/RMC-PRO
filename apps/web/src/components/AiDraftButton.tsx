'use client';

import { useState } from 'react';
import { Sparkles, Copy, X } from 'lucide-react';
import { aiApi } from '../lib/api';
import { Button } from './ui/Button';

/** A "draft with AI" action that opens a small editable panel with the result. */
export function AiDraftButton({
  kind,
  context,
  label = 'AI draft',
  title = 'Draft',
}: {
  kind: string;
  context: Record<string, unknown>;
  label?: string;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function run() {
    setOpen(true);
    setBusy(true);
    setError(null);
    setText('');
    setCopied(false);
    try {
      const r = await aiApi.draft(kind, context);
      setText(r.text);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not draft.');
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — user can select manually */
    }
  }

  return (
    <>
      <Button variant="ghost" size="sm" icon={<Sparkles size={14} />} onClick={run}>
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
              maxWidth: 520,
              background: 'var(--mn-surface)',
              border: '1px solid var(--mn-border)',
              borderRadius: 'var(--mn-radius-lg)',
              boxShadow: 'var(--mn-shadow-card)',
              overflow: 'hidden',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--mn-border)' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: 600 }}>
                <Sparkles size={16} color="var(--mn-primary)" /> {title}
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
                <p style={{ margin: 0, color: 'var(--mn-muted)', fontSize: 13 }}>Drafting…</p>
              ) : error ? (
                <p style={{ margin: 0, color: 'var(--mn-danger)', fontSize: 13 }}>{error}</p>
              ) : (
                <>
                  <textarea
                    className="mn-input"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    rows={7}
                    style={{ resize: 'vertical', fontSize: 14, lineHeight: 1.5 }}
                  />
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>
                      Close
                    </Button>
                    <Button size="sm" icon={<Copy size={14} />} onClick={copy}>
                      {copied ? 'Copied' : 'Copy'}
                    </Button>
                  </div>
                  <p style={{ margin: 0, color: 'var(--mn-subtle)', fontSize: 11.5 }}>
                    Review and edit before sending — AI drafts can contain mistakes.
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
