'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Send, Sparkles } from 'lucide-react';
import { aiApi, type ChatTurn } from '../../../lib/api';
import { Card } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { ErrorState } from '../../../components/ui/States';

const SUGGESTIONS = [
  'Give me an overview of the plant',
  'Who owes us the most money?',
  'What are we low on in stock?',
  'Show recent orders on credit hold',
];

export default function AssistantPage() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    aiApi
      .status()
      .then((s) => setEnabled(s.enabled))
      .catch(() => setEnabled(false));
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns, busy]);

  async function ask(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    setError(null);
    const next: ChatTurn[] = [...turns, { role: 'user', content: q }];
    setTurns(next);
    setInput('');
    setBusy(true);
    try {
      const { reply } = await aiApi.chat(next);
      setTurns([...next, { role: 'assistant', content: reply }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The assistant could not respond.');
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void ask(input);
  }

  return (
    <div style={{ maxWidth: 820, margin: '0 auto', display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span
          className="mn-gradient"
          style={{ width: 34, height: 34, borderRadius: 9, display: 'grid', placeItems: 'center' }}
        >
          <Sparkles size={18} color="#fff" />
        </span>
        <div>
          <h1 style={{ fontSize: 22, margin: 0 }}>Assistant</h1>
          <p style={{ margin: 0, color: 'var(--mn-muted)', fontSize: 13 }}>
            Ask about your plant — reads your live data, changes nothing.
          </p>
        </div>
      </div>

      {enabled === false && (
        <Card>
          <p style={{ margin: 0, color: 'var(--mn-muted)', fontSize: 14 }}>
            The AI assistant isn&apos;t switched on yet. An administrator can enable it by setting an
            Anthropic API key on the server.
          </p>
        </Card>
      )}

      {enabled !== false && (
        <Card padded={false}>
          <div style={{ padding: 16, minHeight: 320, maxHeight: '58vh', overflowY: 'auto', display: 'grid', gap: 12 }}>
            {turns.length === 0 && (
              <div style={{ display: 'grid', gap: 10 }}>
                <p style={{ color: 'var(--mn-muted)', fontSize: 13, margin: 0 }}>Try asking:</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => void ask(s)}
                      disabled={busy}
                      className="mn-btn mn-btn-secondary mn-btn-sm"
                      style={{ cursor: busy ? 'default' : 'pointer' }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {turns.map((t, i) => (
              <div
                key={i}
                style={{
                  justifySelf: t.role === 'user' ? 'end' : 'start',
                  maxWidth: '85%',
                  background: t.role === 'user' ? 'var(--mn-primary)' : 'var(--mn-surface-2, var(--mn-surface))',
                  color: t.role === 'user' ? 'var(--mn-on-primary)' : 'var(--mn-text)',
                  border: t.role === 'user' ? 'none' : '1px solid var(--mn-border)',
                  borderRadius: 12,
                  padding: '10px 13px',
                  fontSize: 14,
                  whiteSpace: 'pre-wrap',
                  lineHeight: 1.5,
                }}
              >
                {t.content}
              </div>
            ))}

            {busy && (
              <div style={{ justifySelf: 'start', color: 'var(--mn-muted)', fontSize: 13, padding: '4px 2px' }}>
                Thinking…
              </div>
            )}
            <div ref={endRef} />
          </div>

          {error && (
            <div style={{ padding: '0 16px 12px' }}>
              <ErrorState message={error} />
            </div>
          )}

          <form onSubmit={onSubmit} style={{ display: 'flex', gap: 8, padding: 12, borderTop: '1px solid var(--mn-border)' }}>
            <input
              className="mn-input"
              style={{ flex: 1 }}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about outstanding, stock, orders…"
              aria-label="Ask the assistant"
              disabled={busy}
            />
            <Button type="submit" icon={<Send size={16} />} loading={busy} disabled={!input.trim()}>
              Send
            </Button>
          </form>
        </Card>
      )}

      <p style={{ color: 'var(--mn-subtle)', fontSize: 12, margin: 0, textAlign: 'center' }}>
        The assistant can make mistakes — check important figures against the reports.
      </p>
    </div>
  );
}
