'use client';

import { useEffect, useState } from 'react';
import { Sparkles, RefreshCw } from 'lucide-react';
import { aiApi } from '../lib/api';
import { Card } from './ui/Card';
import { Button } from './ui/Button';

const NOT_CONFIGURED = /not set up|not configured|AI_NOT_CONFIGURED/i;

/** Dashboard card of AI-written insights. Renders nothing if AI is switched off. */
export function InsightsCard() {
  const [text, setText] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setBusy(true);
    setError(null);
    try {
      const r = await aiApi.insights();
      setText(r.insights);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      if (NOT_CONFIGURED.test(msg)) {
        setHidden(true);
        return;
      }
      setError('Could not load insights.');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  if (hidden) return null;

  return (
    <Card
      title={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <Sparkles size={16} color="var(--mn-primary)" /> AI insights
        </span>
      }
      actions={
        <Button variant="ghost" size="sm" icon={<RefreshCw size={14} />} onClick={load} loading={busy}>
          Refresh
        </Button>
      }
    >
      {busy && !text ? (
        <p style={{ margin: 0, color: 'var(--mn-muted)', fontSize: 13 }}>Analysing your plant…</p>
      ) : error ? (
        <p style={{ margin: 0, color: 'var(--mn-danger)', fontSize: 13 }}>{error}</p>
      ) : (
        <div style={{ whiteSpace: 'pre-wrap', fontSize: 13.5, lineHeight: 1.6 }}>{text}</div>
      )}
    </Card>
  );
}
