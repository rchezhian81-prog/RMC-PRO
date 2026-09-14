/**
 * Amounts in words, the Indian way. Every invoice and receipt now carries the
 * figure in words beside the figure; these pin the system (lakh, crore), the
 * paise, and the edges (zero, rounding, negatives, junk).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { amountInWords, integerInWords } from '../../dist/common/amount-in-words.util.js';

test('lakh and crore, not million and billion', () => {
  assert.equal(amountInWords(1234567.5), 'Rupees Twelve Lakh Thirty-Four Thousand Five Hundred Sixty-Seven and Paise Fifty Only');
  assert.equal(amountInWords(10000000), 'Rupees One Crore Only');
  assert.equal(amountInWords(210500000), 'Rupees Twenty-One Crore Five Lakh Only');
  assert.equal(amountInWords(1e12), 'Rupees One Lakh Crore Only');
  assert.equal(integerInWords(100000), 'One Lakh');
});

test('the small numbers read naturally', () => {
  assert.equal(amountInWords(0), 'Rupees Zero Only');
  assert.equal(amountInWords(1), 'Rupees One Only');
  assert.equal(amountInWords(19), 'Rupees Nineteen Only');
  assert.equal(amountInWords(20), 'Rupees Twenty Only');
  assert.equal(amountInWords(100), 'Rupees One Hundred Only');
  assert.equal(amountInWords(4800), 'Rupees Four Thousand Eight Hundred Only');
  assert.equal(amountInWords('56640.00'), 'Rupees Fifty-Six Thousand Six Hundred Forty Only');
});

test('paise are rounded the way the figure beside them is', () => {
  assert.equal(amountInWords(0.05), 'Rupees Zero and Paise Five Only');
  assert.equal(amountInWords(999.999), 'Rupees One Thousand Only', 'rounds to the paise first, then carries');
  assert.equal(amountInWords(12.345), 'Rupees Twelve and Paise Thirty-Five Only');
});

test('a negative amount says so; junk says nothing rather than a wrong amount', () => {
  assert.equal(amountInWords(-250), 'Minus Rupees Two Hundred Fifty Only');
  assert.equal(amountInWords(-0.001), 'Rupees Zero Only', 'a negative that rounds to nothing is nothing, not "Minus Zero"');
  assert.equal(amountInWords('abc'), '');
  assert.equal(amountInWords(null), '');
  assert.equal(amountInWords(undefined), '');
  assert.equal(amountInWords(''), '');
  assert.equal(amountInWords(Infinity), '');
});
