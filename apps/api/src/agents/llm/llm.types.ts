/**
 * Provider-agnostic LLM contract for the multi-agent system (LLM-1).
 *
 * The agents reason through a *provider* — an adapter over some chat model — but
 * the kernel never lets the model act directly. The model may only PROPOSE tool
 * calls (as `tool_use` blocks); the kernel's guardrail funnel (scope → policy →
 * budget → tenant-scoped execute → audit) still disposes. These types are the
 * seam: they are deliberately small and map 1:1 onto the Anthropic Messages API
 * content blocks, so the real adapter is a thin translation and a scripted fake
 * can drive the loop in a unit test with no network and no API key.
 *
 * Nothing here imports the Anthropic SDK — that stays behind `AnthropicLlmProvider`
 * so the loop, the service and the tests are dependency-free and pure to test.
 */

/** A tool as the model sees it: a name, a description, and a JSON-schema shape. */
export interface LlmToolSpec {
  name: string;
  description: string;
  /** JSON Schema (draft 2020-12) object describing the tool's input. */
  inputSchema: Record<string, unknown>;
}

/**
 * One content block in a turn. This is the union the loop stores in its history
 * and hands back to the provider verbatim — including `thinking` blocks, which
 * MUST be preserved across turns when extended thinking is on with tool use.
 */
export type LlmContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; toolUseId: string; content: string; isError?: boolean }
  | { type: 'thinking'; thinking: string; signature: string }
  | { type: 'redacted_thinking'; data: string };

export interface LlmMessage {
  role: 'user' | 'assistant';
  content: LlmContentBlock[];
}

/** A single tool the model asked to call (extracted from an assistant turn). */
export interface LlmToolUse {
  id: string;
  name: string;
  input: unknown;
}

export interface LlmRequest {
  system: string;
  messages: LlmMessage[];
  tools: LlmToolSpec[];
  maxTokens: number;
}

export interface LlmResponse {
  /** 'end_turn' | 'tool_use' | 'max_tokens' | 'refusal' | … (provider's word). */
  stopReason: string;
  /** The full assistant turn — appended to history verbatim for the next call. */
  content: LlmContentBlock[];
  /** Convenience: the concatenated text blocks of this turn. */
  text: string;
  /** Convenience: the tool_use blocks of this turn, in order. */
  toolUses: LlmToolUse[];
}

/**
 * A pluggable chat-model adapter. `isConfigured()` gates the whole feature:
 * when it is false (no API key), the kernel degrades gracefully and never calls
 * `complete()`, so a deployment without a key keeps every deterministic path
 * working and simply reports that reasoning is unavailable.
 */
export interface LlmProvider {
  readonly name: string;
  isConfigured(): boolean;
  modelId(): string;
  complete(req: LlmRequest): Promise<LlmResponse>;
}

/** DI token for the active provider (bound in AgentsModule). */
export const LLM_PROVIDER = 'AGENT_LLM_PROVIDER';

/** The outcome of a bounded reasoning loop. */
export interface LlmLoopResult {
  /** True when no provider was configured — nothing was sent to any model. */
  degraded: boolean;
  /** Machine-readable reason when degraded (e.g. 'llm_not_configured'). */
  reason?: string;
  /** The model's final text (or a terminal note if it ran out of iterations). */
  text: string;
  /** How many model turns were taken. */
  iterations: number;
  /** How many tool calls the model requested (each still ran the funnel). */
  toolCalls: number;
  /** The provider's terminal stop reason (or 'max_iterations'). */
  stopReason: string;
  /** The model id that answered (or would have). */
  model: string;
}
