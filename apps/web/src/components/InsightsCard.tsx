'use client';

import { useEffect, useState } from 'react';
import { Sparkles, RefreshCw } from 'lucide-react';
import { aiApi } from '../lib/api';
import { Card } from './ui/Card';
import { Button } from './ui/Button';

/**
 * Dashboard card of AI-written insights — an optional extra on top of the
 * rule-based alerts card.
 *
 * Any failure hides the card outright rather than showing an error: AI is not
 * required for the plant to run, and the alerts card above already covers the
 * same ground from the database. A missing key, an unfunded account, or an
 * outage should therefore be invisible to the operator, not a red banner.
 */
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
    } catch {
      // Only surface an error if insights had previously loaded — otherwise the
      // feature is simply unavailable and the card should not appear at all.
      if (text) setError('Could not refresh insights.');
      else setHidden(true);
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
