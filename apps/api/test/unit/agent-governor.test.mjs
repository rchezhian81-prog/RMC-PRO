/**
 * Unit tests for the governor's pure budget helpers — the runaway-loop backstop.
 * (The DB-backed kill switch itself is exercised in the integration suite.)
 */
import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepAllowed, actionAllowed, DEFAULT_CONTROLS } from '../../dist/agents/agent-governor.service.js';

test('the step budget stops exactly at the cap', () => {
  assert.equal(stepAllowed(0, 1), true);
  assert.equal(stepAllowed(1, 1), false);
  assert.equal(stepAllowed(49, 50), true);
  assert.equal(stepAllowed(50, 50), false);
});

test('the action budget stops at the cap, and a zero cap blocks the first write', () => {
  assert.equal(actionAllowed(0, 0), false); // no writes allowed at all
  assert.equal(actionAllowed(0, 1), true);
  assert.equal(actionAllowed(1, 1), false);
});

test('defaults are safe: not paused, positive caps', () => {
  assert.equal(DEFAULT_CONTROLS.automationPaused, false);
  assert.ok(DEFAULT_CONTROLS.maxStepsPerRun > 0);
  assert.ok(DEFAULT_CONTROLS.maxActionsPerRun > 0);
});
