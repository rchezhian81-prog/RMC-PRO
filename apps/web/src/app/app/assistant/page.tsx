'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Send, Sparkles, Trash2 } from 'lucide-react';
import { aiApi, type ChatTurn } from '../../../lib/api';
import { Card } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { Form } from '../../../components/ui/Form';
import { Input } from '../../../components/ui/Field';
import { ErrorState } from '../../../components/ui/States';

/**
 * Assistant — ask about the plant in plain words.
 *
 * One card: the conversation (with suggested questions when it is empty),
 * then the composer. The assistant reads live data and changes nothing.
 * When it is switched off, the card says who can switch it on. Same layout
 * in both skins; every colour reads the semantic tokens.
 */

const SUGGESTIONS = [
  'Give me an overview of the plant',
  'Who owes us the most money?',
  'What are we low on in stock?',
  'Show recent orders on credit hold',
  'Which trucks are due for service?',
  'How much did we batch this month?',
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
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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
    <div className="mn-ord mn-ai">
      <header className="mn-board-head">
        <div className="mn-board-title">
          <h1>Assistant</h1>
          <p>Ask about the plant the way you would ask the office: who owes what, what is low, what is due. It reads your live data and changes nothing. Check important figures against the reports.</p>
        </div>
        <div className="mn-board-tools">
          <span className="mn-board-live mn-ord-sum" aria-live="polite">
            <Sparkles size={14} aria-hidden />
            {enabled === null ? 'Checking…' : enabled ? `${turns.length ? `${Math.ceil(turns.length / 2)} ${turns.length <= 2 ? 'question' : 'questions'} this session` : 'Ready'}` : 'Switched off'}
          </span>
          {turns.length > 0 && <Button variant="ghost" size="sm" icon={<Trash2 size={14} />} onClick={() => { setTurns([]); setError(null); }} disabled={busy}>Start again</Button>}
        </div>
      </header>

      {enabled === false && (
        <div className="mn-ord-note mn-ord-note--warn" role="status">
          <Sparkles size={16} aria-hidden />
          <span><strong>The assistant is not switched on.</strong> An administrator switches it on by setting an Anthropic API key on the server; until then the reports answer the same questions.</span>
        </div>
      )}

      {enabled !== false && (
        <Card padded={false}>
          <div className="mn-ai-thread" role="log" aria-live="polite">
            {turns.length === 0 && (
              <div className="mn-ai-empty">
                <span className="mn-ai-empty-icon" aria-hidden><Sparkles size={22} /></span>
                <p className="mn-ai-empty-title">Try asking</p>
                <div className="mn-ai-suggest">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} type="button" className="mn-board-chip mn-ai-chip" onClick={() => void ask(s)} disabled={busy}>
                      <span className="mn-board-chip-l">{s}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {turns.map((t, i) => (
              <div key={i} className="mn-ai-turn" data-role={t.role}>
                <span className="mn-ai-turn-who">{t.role === 'user' ? 'You' : 'Assistant'}</span>
                <div className="mn-ai-bubble">{t.content}</div>
              </div>
            ))}
            {busy && (
              <div className="mn-ai-turn" data-role="assistant">
                <span className="mn-ai-turn-who">Assistant</span>
                <div className="mn-ai-bubble mn-ai-bubble--thinking">Looking it up…</div>
              </div>
            )}
            <div ref={endRef} />
          </div>
          {error && <div className="mn-ai-error"><ErrorState message={error} /></div>}
          <Form onSubmit={onSubmit} className="mn-ai-composer">
            <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask about outstanding, stock, orders, trucks…" aria-label="Ask the assistant" disabled={busy || enabled === null} />
            <Button type="submit" icon={<Send size={16} />} loading={busy} disabled={!input.trim() || enabled === null}>Ask</Button>
          </Form>
        </Card>
      )}
      <p className="mn-ord-how mn-ai-foot">The assistant can make mistakes. It sees the same figures as the reports, but the reports are the record.</p>
    </div>
  );
}
