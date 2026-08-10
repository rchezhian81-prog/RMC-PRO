/**
 * Unit tests for the LLM tool-use loop (LLM-1). No network, no API key: a scripted
 * fake provider drives the loop so we can prove the safety-critical behaviours in
 * isolation —
 *   - the model PROPOSES a tool call; the loop routes it through the caller's
 *     guardrailed callTool and feeds the JSON result back to the model;
 *   - a BLOCKED / out-of-scope tool is fed back as an ERROR result (the action
 *     never runs) and the model can still finish — it cannot turn a block into an
 *     action;
 *   - a BUDGET_EXCEEDED stop is terminal (propagates), ending the run;
 *   - the loop is bounded by maxIterations when the model never stops;
 *   - with no provider configured it degrades gracefully and never calls a model;
 *   - runAgentLoop exposes ONLY the agent's allow-listed tools to the model.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LlmService } from '../../dist/agents/llm/llm.service.js';
import { FakeLlmProvider, fakeText, fakeToolUse } from '../../dist/agents/llm/fake.provider.js';
import { ToolRegistryService } from '../../dist/agents/tool-registry.service.js';
import { AgentError } from '../../dist/agents/agent.types.js';

const SUMMARY_TOOL = {
  name: 'analysis.summary',
  description: 'KPI snapshot',
  inputSchema: { type: 'object', properties: { windowDays: { type: 'integer' } } },
};

test('the loop routes a tool call through the guardrail and feeds the result back', async () => {
  const provider = new FakeLlmProvider([
    fakeToolUse('t1', 'analysis.summary', { windowDays: 7 }),
    fakeText('Revenue was 500000.'),
  ]);
  const svc = new LlmService(provider, /* registry unused here */ {});

  const calls = [];
  const callTool = async (name, input) => {
    calls.push({ name, input });
    return { revenue: 500000 };
  };

  const r = await svc.runToolLoop({ system: 'sys', userMessage: 'How are sales?', tools: [SUMMARY_TOOL], callTool });

  assert.equal(r.degraded, false);
  assert.equal(r.text, 'Revenue was 500000.');
  assert.equal(r.iterations, 2);
  assert.equal(r.toolCalls, 1);
  // The tool ran through our callback with exactly what the model proposed.
  assert.deepEqual(calls, [{ name: 'analysis.summary', input: { windowDays: 7 } }]);
  // The tool result was fed back to the model on the 2nd request.
  const secondReq = provider.seen[1];
  const toolResult = secondReq.messages.at(-1).content[0];
  assert.equal(toolResult.type, 'tool_result');
  assert.equal(toolResult.toolUseId, 't1');
  assert.match(toolResult.content, /500000/);
});

test('a blocked tool is fed back as an error result and the model can still finish', async () => {
  const provider = new FakeLlmProvider([
    fakeToolUse('t1', 'automation.commit_financial', {}),
    fakeText('That action needs human approval; I have not performed it.'),
  ]);
  const svc = new LlmService(provider, {});

  let ran = 0;
  const callTool = async () => {
    ran += 1;
    // Simulate the funnel blocking a financial action BEFORE any execution.
    throw new AgentError('ACTION_BLOCKED', 'blocked: financial action requires approval');
  };

  const r = await svc.runToolLoop({ system: 'sys', userMessage: 'Pay the vendor', tools: [], callTool });

  assert.equal(r.text, 'That action needs human approval; I have not performed it.');
  assert.equal(r.toolCalls, 1);
  // The funnel was consulted (and blocked) — nothing executed beyond that.
  assert.equal(ran, 1);
  const fedBack = provider.seen[1].messages.at(-1).content[0];
  assert.equal(fedBack.type, 'tool_result');
  assert.equal(fedBack.isError, true);
  assert.match(fedBack.content, /approval/i);
});

test('a BUDGET_EXCEEDED stop is terminal and propagates out of the loop', async () => {
  const provider = new FakeLlmProvider([fakeToolUse('t1', 'analysis.summary', {})]);
  const svc = new LlmService(provider, {});
  const callTool = async () => { throw new AgentError('BUDGET_EXCEEDED', 'step budget exceeded'); };

  await assert.rejects(
    () => svc.runToolLoop({ system: 's', userMessage: 'go', tools: [SUMMARY_TOOL], callTool }),
    (e) => e instanceof AgentError && e.code === 'BUDGET_EXCEEDED',
  );
});

test('the loop is bounded by maxIterations when the model never stops', async () => {
  // A single tool_use turn, clamped forever by the fake → the loop must stop itself.
  const provider = new FakeLlmProvider([fakeToolUse('t1', 'analysis.summary', {})]);
  const svc = new LlmService(provider, {});
  let ran = 0;
  const callTool = async () => { ran += 1; return {}; };

  const r = await svc.runToolLoop({ system: 's', userMessage: 'go', tools: [SUMMARY_TOOL], callTool, maxIterations: 3 });

  assert.equal(r.iterations, 3);
  assert.equal(r.toolCalls, 3);
  assert.equal(ran, 3);
  assert.equal(r.stopReason, 'max_iterations');
});

test('runAgentLoop degrades gracefully when no provider is configured (no model call)', async () => {
  const provider = new FakeLlmProvider([], /* configured */ false);
  const svc = new LlmService(provider, {});
  let called = false;
  const callTool = async () => { called = true; return {}; };

  const r = await svc.runAgentLoop({
    agentName: 'data-analysis', agentDescription: 'analytics', userMessage: 'hi', callTool,
  });

  assert.equal(r.degraded, true);
  assert.equal(r.reason, 'llm_not_configured');
  assert.equal(provider.seen.length, 0); // never called the model
  assert.equal(called, false); // never called a tool
});

test('runAgentLoop exposes ONLY the agent allow-listed tools to the model', async () => {
  const reg = new ToolRegistryService();
  reg.registerTool({
    name: 'a.read', kind: 'read', reversibility: 'reversible', description: 'allowed',
    parameters: { type: 'object', properties: {} }, execute: async () => ({}),
  });
  reg.registerTool({
    name: 'b.secret', kind: 'read', reversibility: 'reversible', description: 'not for this agent',
    execute: async () => ({}),
  });
  reg.registerAgent({ name: 'demo', description: 'demo agent', tools: ['a.read'], handler: async () => null });

  const provider = new FakeLlmProvider([fakeText('done')]);
  const svc = new LlmService(provider, reg);

  await svc.runAgentLoop({ agentName: 'demo', agentDescription: 'demo agent', userMessage: 'go', callTool: async () => ({}) });

  const offered = provider.seen[0].tools.map((t) => t.name);
  assert.deepEqual(offered, ['a.read']); // b.secret is never shown to the model
});
