/**
 * Live end-to-end test of the INBUILT model path over real HTTP. It boots a stub
 * OpenAI-compatible `/v1/chat/completions` server (standing in for Ollama /
 * llama.cpp), points AGENT_LLM_LOCAL_BASE_URL at it, and drives the real
 * LlmService tool-use loop through the real LocalLlmProvider. This proves the
 * wiring that unit-testing the translators alone cannot:
 *   - LocalLlmProvider.complete() performs a real HTTP round-trip;
 *   - the request is OpenAI-shaped (system message + tools);
 *   - the model's tool_call is routed through the guardrail callback, the JSON
 *     result is fed back as a `tool` message, and a final answer is returned.
 *
 * It's the exact path that runs when the owner points the app at a real local
 * model server — de-risked here with no model download.
 *
 * This file sets an env var and binds a port; the Node test runner isolates each
 * test file in its own process, so neither leaks to other suites.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

// --- a scripted OpenAI-compatible model server ---
const seenRequests = [];
const server = http.createServer((req, res) => {
  if (req.method !== 'POST' || !req.url.endsWith('/chat/completions')) {
    res.writeHead(404).end();
    return;
  }
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const body = JSON.parse(raw);
    seenRequests.push(body);
    const hasToolResult = body.messages.some((m) => m.role === 'tool');
    const payload = hasToolResult
      ? { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'Revenue in the last 7 days was 500000.' } }] }
      : {
          choices: [{
            finish_reason: 'tool_calls',
            message: {
              role: 'assistant', content: null,
              tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'kpi.summary', arguments: JSON.stringify({ windowDays: 7 }) } }],
            },
          }],
        };
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(payload));
  });
});

test('the inbuilt local model path works end-to-end over real HTTP', async (t) => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  process.env.AGENT_LLM_LOCAL_BASE_URL = `http://127.0.0.1:${port}/v1`;
  process.env.AGENT_LLM_LOCAL_MODEL = 'stub-model';
  t.after(() => new Promise((r) => server.close(r)));

  // Import AFTER the env is set so the provider reads the stub base URL.
  const { LlmService } = await import('../../dist/agents/llm/llm.service.js');
  const { LocalLlmProvider } = await import('../../dist/agents/llm/local.provider.js');
  const { ToolRegistryService } = await import('../../dist/agents/tool-registry.service.js');

  const reg = new ToolRegistryService();
  reg.registerTool({
    name: 'kpi.summary', kind: 'read', reversibility: 'reversible', description: 'KPI snapshot',
    parameters: { type: 'object', properties: { windowDays: { type: 'integer' } } },
    execute: async () => ({}),
  });
  reg.registerAgent({ name: 'data-analysis', description: 'analytics', tools: ['kpi.summary'], handler: async () => null });

  const provider = new LocalLlmProvider();
  assert.equal(provider.isConfigured(), true);
  assert.equal(provider.name, 'local');

  const svc = new LlmService(provider, reg);

  const toolCalls = [];
  const result = await svc.runAgentLoop({
    agentName: 'data-analysis',
    agentDescription: 'analytics',
    userMessage: 'How were sales this week?',
    callTool: async (name, input) => { toolCalls.push({ name, input }); return { revenue: 500000 }; },
  });

  // The loop ran a real HTTP conversation and finished with the model's answer.
  assert.equal(result.degraded, false);
  assert.equal(result.text, 'Revenue in the last 7 days was 500000.');
  assert.equal(result.iterations, 2);
  assert.equal(result.toolCalls, 1);
  assert.deepEqual(toolCalls, [{ name: 'kpi.summary', input: { windowDays: 7 } }]);

  // The wire payloads were OpenAI-shaped in both directions.
  assert.equal(seenRequests.length, 2);
  assert.equal(seenRequests[0].messages[0].role, 'system');
  assert.equal(seenRequests[0].tools[0].function.name, 'kpi.summary');
  const toolMsg = seenRequests[1].messages.find((m) => m.role === 'tool');
  assert.ok(toolMsg && /500000/.test(toolMsg.content), 'the tool result was fed back as an OpenAI tool message');
});
