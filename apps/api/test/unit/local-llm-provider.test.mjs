/**
 * Unit tests for the inbuilt (self-hosted) local LLM provider's pure translators
 * — the internal content-block history <-> OpenAI-compatible chat shapes. No
 * network: these prove tool-calls round-trip so the same tool-use loop drives a
 * local model exactly as it drives the hosted one.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toOpenAiMessages, toOpenAiTools, fromOpenAiChoice } from '../../dist/agents/llm/local.provider.js';

test('toOpenAiMessages emits a system message, a user turn, tool_calls and tool results', () => {
  const msgs = toOpenAiMessages('SYS', [
    { role: 'user', content: [{ type: 'text', text: 'How are sales?' }] },
    { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'analysis.summary', input: { windowDays: 7 } }] },
    { role: 'user', content: [{ type: 'tool_result', toolUseId: 't1', content: '{"revenue":500000}' }] },
  ]);
  assert.deepEqual(msgs[0], { role: 'system', content: 'SYS' });
  assert.deepEqual(msgs[1], { role: 'user', content: 'How are sales?' });
  // assistant tool call
  assert.equal(msgs[2].role, 'assistant');
  assert.equal(msgs[2].tool_calls[0].function.name, 'analysis.summary');
  assert.equal(msgs[2].tool_calls[0].function.arguments, JSON.stringify({ windowDays: 7 }));
  // tool result becomes a `tool` message keyed by the call id
  assert.deepEqual(msgs[3], { role: 'tool', tool_call_id: 't1', content: '{"revenue":500000}' });
});

test('toOpenAiTools maps tool specs to OpenAI function tools', () => {
  const tools = toOpenAiTools([{ name: 'x.read', description: 'reads', inputSchema: { type: 'object', properties: {} } }]);
  assert.equal(tools[0].type, 'function');
  assert.equal(tools[0].function.name, 'x.read');
  assert.deepEqual(tools[0].function.parameters, { type: 'object', properties: {} });
});

test('fromOpenAiChoice maps a tool_calls turn to a tool_use response', () => {
  const r = fromOpenAiChoice({
    finish_reason: 'tool_calls',
    message: { role: 'assistant', content: null, tool_calls: [{ id: 'c1', function: { name: 'monitor.checks', arguments: '{"stockThreshold":0}' } }] },
  });
  assert.equal(r.stopReason, 'tool_use');
  assert.equal(r.toolUses.length, 1);
  assert.equal(r.toolUses[0].name, 'monitor.checks');
  assert.deepEqual(r.toolUses[0].input, { stockThreshold: 0 });
});

test('fromOpenAiChoice maps a plain text turn to end_turn', () => {
  const r = fromOpenAiChoice({ finish_reason: 'stop', message: { role: 'assistant', content: 'Revenue was 5,00,000.' } });
  assert.equal(r.stopReason, 'end_turn');
  assert.equal(r.text, 'Revenue was 5,00,000.');
  assert.equal(r.toolUses.length, 0);
});

test('fromOpenAiChoice treats tool_calls as tool_use even when finish_reason is stop, and survives bad JSON args', () => {
  const r = fromOpenAiChoice({
    finish_reason: 'stop',
    message: { role: 'assistant', content: null, tool_calls: [{ id: 'c2', function: { name: 'x', arguments: 'not json' } }] },
  });
  assert.equal(r.stopReason, 'tool_use');
  assert.deepEqual(r.toolUses[0].input, {}); // malformed args default to {} instead of crashing
});
