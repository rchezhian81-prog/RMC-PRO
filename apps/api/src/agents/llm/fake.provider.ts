import type { LlmProvider, LlmRequest, LlmResponse } from './llm.types';

/**
 * A scripted, offline provider for unit tests. It returns a pre-baked sequence of
 * responses (one per `complete()` call), so a test can drive the full tool-use
 * loop — tool_use turns, tool results fed back, a final end_turn — with no
 * network and no API key. It also records every request it saw, so a test can
 * assert on the history the loop built (e.g. that a tool_result was appended).
 *
 * This lives in `src` (not the test dir) only so the loop can be unit-tested
 * against the same compiled types; it is never wired into the running app.
 */
export class FakeLlmProvider implements LlmProvider {
  readonly name = 'fake';
  readonly seen: LlmRequest[] = [];
  private i = 0;

  constructor(
    private readonly script: LlmResponse[],
    private readonly configured = true,
    private readonly model = 'fake-model',
  ) {}

  isConfigured(): boolean {
    return this.configured;
  }

  modelId(): string {
    return this.model;
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    // Snapshot the request as it was at THIS call — the loop keeps mutating the
    // same `messages` array across turns, so storing the reference would let a
    // later turn's history leak back into what an earlier turn "saw".
    this.seen.push(structuredClone(req));
    // Clamp to the last scripted turn so an over-eager loop can't run off the end;
    // the loop is bounded by maxIterations regardless.
    const r = this.script[Math.min(this.i, this.script.length - 1)];
    this.i += 1;
    if (!r) throw new Error('FakeLlmProvider: empty script');
    return r;
  }
}

/** Small builders so tests read cleanly. */
export const fakeText = (text: string): LlmResponse => ({
  stopReason: 'end_turn',
  content: [{ type: 'text', text }],
  text,
  toolUses: [],
});

export const fakeToolUse = (id: string, name: string, input: unknown): LlmResponse => ({
  stopReason: 'tool_use',
  content: [{ type: 'tool_use', id, name, input }],
  text: '',
  toolUses: [{ id, name, input }],
});
