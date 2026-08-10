/**
 * Unit tests for the tool registry — the least-privilege enforcement point.
 * An agent may call ONLY the tools in its own allow-list; anything else is a
 * typed TOOL_OUT_OF_SCOPE rejection, and misconfiguration fails fast at
 * registration. No I/O.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ToolRegistryService } from '../../dist/agents/tool-registry.service.js';
import { AgentError } from '../../dist/agents/agent.types.js';

const tool = (name, over = {}) => ({
  name, kind: 'read', reversibility: 'reversible', description: name,
  execute: async () => ({}), ...over,
});

test('resolveTool enforces the agent allow-list', () => {
  const r = new ToolRegistryService();
  r.registerTool(tool('t.read'));
  r.registerTool(tool('t.write', { kind: 'write' }));
  r.registerAgent({ name: 'a', description: '', tools: ['t.read'], handler: async () => null });

  assert.equal(r.resolveTool('a', 't.read').name, 't.read');
  assert.throws(
    () => r.resolveTool('a', 't.write'),
    (e) => e instanceof AgentError && e.code === 'TOOL_OUT_OF_SCOPE',
  );
});

test('an unknown agent is a typed UNKNOWN_AGENT error', () => {
  const r = new ToolRegistryService();
  assert.throws(
    () => r.getAgent('nope'),
    (e) => e instanceof AgentError && e.code === 'UNKNOWN_AGENT',
  );
});

test('an agent that allow-lists an unregistered tool fails fast at registration', () => {
  const r = new ToolRegistryService();
  assert.throws(
    () => r.registerAgent({ name: 'a', description: '', tools: ['ghost'], handler: async () => null }),
    /unknown tool/,
  );
});

test('duplicate tool and agent registrations are rejected', () => {
  const r = new ToolRegistryService();
  r.registerTool(tool('t'));
  assert.throws(() => r.registerTool(tool('t')), /duplicate tool/);
  r.registerAgent({ name: 'a', description: '', tools: ['t'], handler: async () => null });
  assert.throws(
    () => r.registerAgent({ name: 'a', description: '', tools: ['t'], handler: async () => null }),
    /duplicate agent/,
  );
});

test('the runtime cannot resolve a tool the agent did not list — even if registered', () => {
  const r = new ToolRegistryService();
  r.registerTool(tool('t.a'));
  r.registerTool(tool('t.b'));
  r.registerAgent({ name: 'scoped', description: '', tools: ['t.a'], handler: async () => null });
  // t.b exists but is not in scope → still rejected (no runtime privilege escalation).
  assert.throws(
    () => r.resolveTool('scoped', 't.b'),
    (e) => e instanceof AgentError && e.code === 'TOOL_OUT_OF_SCOPE',
  );
});
