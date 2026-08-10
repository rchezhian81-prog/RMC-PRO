import { Injectable, Logger } from '@nestjs/common';
import type {
  LlmContentBlock,
  LlmMessage,
  LlmProvider,
  LlmRequest,
  LlmResponse,
  LlmToolSpec,
  LlmToolUse,
} from './llm.types';

/**
 * The INBUILT, self-hosted reasoning provider — no subscription, no external
 * vendor. It speaks the OpenAI-compatible `/chat/completions` API that every
 * common local server exposes (Ollama, llama.cpp `server`, vLLM, LM Studio,
 * text-generation-webui), so the owner runs a small open-source model on their
 * OWN box and the agents reason against it through the same seam Anthropic used.
 *
 * It is *fail-safe off*: with no `AGENT_LLM_LOCAL_BASE_URL` set, `isConfigured()`
 * is false and the kernel degrades to the deterministic agents — exactly the
 * prepare-only/no-model baseline. The model only ever PROPOSES tool calls; the
 * kernel's guardrail funnel still disposes.
 *
 * Deliberately dependency-free (raw `fetch`, no SDK): nothing here reaches a paid
 * API, and the translation to/from the internal content-block shape is pure and
 * unit-tested.
 */
@Injectable()
export class LocalLlmProvider implements LlmProvider {
  readonly name = 'local';
  private readonly log = new Logger(LocalLlmProvider.name);

  isConfigured(): boolean {
    return !!process.env.AGENT_LLM_LOCAL_BASE_URL?.trim();
  }

  modelId(): string {
    return process.env.AGENT_LLM_LOCAL_MODEL?.trim() || 'local-model';
  }

  private baseUrl(): string {
    return (process.env.AGENT_LLM_LOCAL_BASE_URL ?? '').trim().replace(/\/$/, '');
  }

  private timeoutMs(): number {
    // Local CPU inference can be slow; default 120s, overridable.
    const n = Number(process.env.AGENT_LLM_LOCAL_TIMEOUT_MS);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 120_000;
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const body = {
      model: this.modelId(),
      messages: toOpenAiMessages(req.system, req.messages),
      tools: req.tools.length ? toOpenAiTools(req.tools) : undefined,
      tool_choice: req.tools.length ? 'auto' : undefined,
      max_tokens: req.maxTokens,
      temperature: 0,
      stream: false,
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs());
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl()}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Most local servers ignore auth; send a bearer only if one is set.
          ...(process.env.AGENT_LLM_LOCAL_API_KEY?.trim()
            ? { Authorization: `Bearer ${process.env.AGENT_LLM_LOCAL_API_KEY.trim()}` }
            : {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (e) {
      throw new Error(`local LLM unreachable at ${this.baseUrl()}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`local LLM returned ${res.status}: ${text.slice(0, 500)}`);
    }
    const data = (await res.json().catch(() => null)) as OpenAiChatResponse | null;
    const choice = data?.choices?.[0];
    if (!choice) throw new Error('local LLM returned no choices');
    return fromOpenAiChoice(choice);
  }
}

// ---- pure translators (exported for unit tests) ----

interface OpenAiToolCall {
  id?: string;
  function?: { name?: string; arguments?: string };
}
interface OpenAiMessageOut {
  role: string;
  content: string | null;
  tool_calls?: OpenAiToolCall[];
}
interface OpenAiChatResponse {
  choices?: Array<{ message?: OpenAiMessageOut; finish_reason?: string }>;
}

/** Internal content-block history → OpenAI chat messages (with a leading system). */
export function toOpenAiMessages(system: string, messages: LlmMessage[]): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  if (system?.trim()) out.push({ role: 'system', content: system });

  for (const m of messages) {
    if (m.role === 'assistant') {
      const text = m.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('');
      const toolUses = m.content.filter((b): b is Extract<LlmContentBlock, { type: 'tool_use' }> => b.type === 'tool_use');
      const msg: Record<string, unknown> = { role: 'assistant', content: text || null };
      if (toolUses.length) {
        msg.tool_calls = toolUses.map((t) => ({
          id: t.id,
          type: 'function',
          function: { name: t.name, arguments: JSON.stringify(t.input ?? {}) },
        }));
      }
      out.push(msg);
      continue;
    }
    // user turn: tool results become `tool` messages; plain text becomes a user message.
    const results = m.content.filter((b): b is Extract<LlmContentBlock, { type: 'tool_result' }> => b.type === 'tool_result');
    for (const r of results) {
      out.push({ role: 'tool', tool_call_id: r.toolUseId, content: r.content });
    }
    const text = m.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('');
    if (text) out.push({ role: 'user', content: text });
  }
  return out;
}

/** Internal tool specs → OpenAI function tools. */
export function toOpenAiTools(tools: LlmToolSpec[]): Array<Record<string, unknown>> {
  return tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.inputSchema },
  }));
}

/** An OpenAI choice → the internal response shape. */
export function fromOpenAiChoice(choice: { message?: OpenAiMessageOut; finish_reason?: string }): LlmResponse {
  const msg = choice.message ?? { role: 'assistant', content: null };
  const content: LlmContentBlock[] = [];
  if (typeof msg.content === 'string' && msg.content.length) content.push({ type: 'text', text: msg.content });

  const toolUses: LlmToolUse[] = [];
  for (const tc of msg.tool_calls ?? []) {
    const id = tc.id ?? `call_${toolUses.length}`;
    const nameStr = tc.function?.name ?? 'unknown';
    const input = safeParse(tc.function?.arguments);
    content.push({ type: 'tool_use', id, name: nameStr, input });
    toolUses.push({ id, name: nameStr, input });
  }

  const stopReason = toolUses.length
    ? 'tool_use'
    : choice.finish_reason === 'length'
      ? 'max_tokens'
      : 'end_turn';
  const text = content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('').trim();
  return { stopReason, content, text, toolUses };
}

function safeParse(s: string | undefined): unknown {
  if (!s) return {};
  try {
    return JSON.parse(s);
  } catch {
    return {}; // small local models occasionally emit malformed args; don't crash the loop
  }
}
