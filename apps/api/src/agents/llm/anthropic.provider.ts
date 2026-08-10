import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import type {
  ContentBlock,
  ContentBlockParam,
  MessageParam,
  Tool,
} from '@anthropic-ai/sdk/resources/messages';
import type {
  LlmContentBlock,
  LlmProvider,
  LlmRequest,
  LlmResponse,
  LlmToolUse,
} from './llm.types';

/** Default model — see the claude-api guidance; overridable per deployment. */
const DEFAULT_MODEL = 'claude-opus-5';

/**
 * The real provider: an adapter over the Anthropic Messages API using the
 * official SDK. It is deliberately a thin translation layer — our content blocks
 * map 1:1 onto the API's, so `complete()` is: our shapes → API shapes → one
 * `messages.create` → API shapes → our shapes.
 *
 * Configuration is by environment, and the whole feature is *fail-safe off*:
 *   - `ANTHROPIC_API_KEY` — when absent, `isConfigured()` is false and the kernel
 *     never calls this provider (graceful degradation; the key is held for the
 *     owner to set at deployment, never in the repo or logs);
 *   - `AGENT_LLM_MODEL` — overrides the model id (defaults to claude-opus-5);
 *   - `AGENT_LLM_MAX_TOKENS` — caps output tokens (defaults to 8192).
 *
 * Adaptive extended thinking is on (`thinking: {type:'adaptive'}`), which lets the
 * model reason more on harder asks; the loop preserves the returned `thinking`
 * blocks across turns, as the API requires when thinking is combined with tools.
 */
@Injectable()
export class AnthropicLlmProvider implements LlmProvider {
  readonly name = 'anthropic';
  private readonly log = new Logger(AnthropicLlmProvider.name);
  private client: Anthropic | null = null;

  isConfigured(): boolean {
    return !!process.env.ANTHROPIC_API_KEY?.trim();
  }

  modelId(): string {
    return process.env.AGENT_LLM_MODEL?.trim() || DEFAULT_MODEL;
  }

  private maxTokens(fallback: number): number {
    const n = Number(process.env.AGENT_LLM_MAX_TOKENS);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
  }

  /** Lazily build the client so importing this module never needs a key. */
  private getClient(): Anthropic {
    if (!this.client) {
      // The SDK reads ANTHROPIC_API_KEY from the environment by default; we do
      // not pass, log, or echo the key ourselves.
      this.client = new Anthropic();
    }
    return this.client;
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const client = this.getClient();
    const tools: Tool[] = req.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Tool.InputSchema,
    }));
    const messages: MessageParam[] = req.messages.map((m) => ({
      role: m.role,
      content: m.content.map(toApiBlock),
    }));

    const msg = await client.messages.create({
      model: this.modelId(),
      max_tokens: this.maxTokens(req.maxTokens),
      thinking: { type: 'adaptive' },
      system: req.system,
      tools,
      messages,
    });

    const content = msg.content.map(fromApiBlock).filter((b): b is LlmContentBlock => b !== null);
    const text = content
      .filter((b): b is Extract<LlmContentBlock, { type: 'text' }> => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
    const toolUses: LlmToolUse[] = content
      .filter((b): b is Extract<LlmContentBlock, { type: 'tool_use' }> => b.type === 'tool_use')
      .map((b) => ({ id: b.id, name: b.name, input: b.input }));

    return { stopReason: msg.stop_reason ?? 'end_turn', content, text, toolUses };
  }
}

/** Our content block → an Anthropic request block (shapes align 1:1). */
function toApiBlock(b: LlmContentBlock): ContentBlockParam {
  switch (b.type) {
    case 'text':
      return { type: 'text', text: b.text };
    case 'tool_use':
      return { type: 'tool_use', id: b.id, name: b.name, input: b.input };
    case 'tool_result':
      return { type: 'tool_result', tool_use_id: b.toolUseId, content: b.content, is_error: b.isError ?? false };
    case 'thinking':
      return { type: 'thinking', thinking: b.thinking, signature: b.signature };
    case 'redacted_thinking':
      return { type: 'redacted_thinking', data: b.data };
  }
}

/** An Anthropic response block → our content block (skip anything we don't model). */
function fromApiBlock(b: ContentBlock): LlmContentBlock | null {
  switch (b.type) {
    case 'text':
      return { type: 'text', text: b.text };
    case 'tool_use':
      return { type: 'tool_use', id: b.id, name: b.name, input: b.input };
    case 'thinking':
      return { type: 'thinking', thinking: b.thinking, signature: b.signature };
    case 'redacted_thinking':
      return { type: 'redacted_thinking', data: b.data };
    default:
      return null;
  }
}
