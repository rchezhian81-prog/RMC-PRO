/**
 * Unit tests for the shared password policy (both the web warns and the server
 * enforces from this). Guards the exact rules the e2e suite depends on — a
 * change here that silently weakened the policy would be caught.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { passwordProblems, isPasswordAcceptable, passwordProblemMessage, PASSWORD_MIN_LENGTH } from '../../dist/index.js';

test('a compliant password has no problems', () => {
  assert.deepEqual(passwordProblems('Concrete#2026'), []);
  assert.equal(isPasswordAcceptable('Concrete#2026'), true);
  assert.equal(passwordProblemMessage('Concrete#2026'), null);
});

test('too-short passwords are rejected', () => {
  assert.equal(PASSWORD_MIN_LENGTH, 10);
  assert.ok(passwordProblems('Ab1!').some((p) => p.includes('at least')));
});

test('common-word prefixes are rejected (incl. the old demo value)', () => {
  assert.ok(passwordProblems('Passw0rd!23').some((p) => p.includes('common word')));
  assert.ok(passwordProblems('admin12345').some((p) => p.includes('common word')));
});

test('a password must include a letter and a number', () => {
  assert.ok(passwordProblems('!!!!!!!!!!').some((p) => p.includes('letter')));
  assert.ok(passwordProblems('abcdefghij').some((p) => p.includes('number')));
});

test('leading/trailing space is rejected', () => {
  assert.ok(passwordProblems(' Concrete#2026').some((p) => p.includes('space')));
});
