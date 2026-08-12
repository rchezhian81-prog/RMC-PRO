/**
 * Unit tests for aggregate moisture & water/cement correction (Plan A2).
 *
 * Imports the COMPILED output, so `pnpm --filter @rmc/api build` must run first
 * (the test turbo task depends on build).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyMoistureCorrection } from '../../dist/production/moisture-correction.util.js';

const close = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);

test('no aggregates: everything passes through unchanged', () => {
  const { results, totalFreeWater } = applyMoistureCorrection([
    { materialType: 'cement', targetSsd: 320, absorptionPct: 0, moisturePct: 0 },
    { materialType: 'water', targetSsd: 180, absorptionPct: 0, moisturePct: 0 },
  ]);
  assert.equal(totalFreeWater, 0);
  assert.equal(results[0].correctedTarget, 320);
  assert.equal(results[1].correctedTarget, 180);
});

test('wet aggregate is batched heavier and its surface water is taken off the mix water', () => {
  const { results, totalFreeWater } = applyMoistureCorrection([
    { materialType: 'cement', targetSsd: 320, absorptionPct: 0, moisturePct: 0 },
    { materialType: 'fine_aggregate', targetSsd: 100, absorptionPct: 1, moisturePct: 5 },
    { materialType: 'water', targetSsd: 180, absorptionPct: 0, moisturePct: 0 },
  ]);
  // dry = 100/1.01 = 99.0099; wet = ×1.05 = 103.96; free = 3.96
  close(results[1].correctedTarget, 103.96);
  close(results[1].freeWater, 3.96);
  close(totalFreeWater, 3.96);
  // cement untouched; water reduced by the free water
  assert.equal(results[0].correctedTarget, 320);
  close(results[2].correctedTarget, 176.04);
  close(results[2].freeWater, -3.96);
});

test('a thirsty aggregate (moisture < absorption) increases the mix water', () => {
  const { results, totalFreeWater } = applyMoistureCorrection([
    { materialType: 'coarse_aggregate', targetSsd: 100, absorptionPct: 2, moisturePct: 0.5 },
    { materialType: 'water', targetSsd: 180, absorptionPct: 0, moisturePct: 0 },
  ]);
  // dry = 100/1.02 = 98.039; wet = ×1.005 = 98.529; free = -1.471
  close(results[0].correctedTarget, 98.529);
  close(results[0].freeWater, -1.471);
  close(totalFreeWater, -1.471);
  close(results[1].correctedTarget, 181.471); // more water added
});

test('total water is preserved: added water + free water = design water (w/c held)', () => {
  const designWater = 180;
  const { results, totalFreeWater } = applyMoistureCorrection([
    { materialType: 'fine_aggregate', targetSsd: 800, absorptionPct: 1.2, moisturePct: 6 },
    { materialType: 'coarse_aggregate', targetSsd: 1050, absorptionPct: 0.8, moisturePct: 1.5 },
    { materialType: 'water', targetSsd: designWater, absorptionPct: 0, moisturePct: 0 },
  ]);
  const addedWater = results[2].correctedTarget;
  close(addedWater + totalFreeWater, designWater);
});

test('missing absorption/moisture data leaves an aggregate unchanged', () => {
  const { results } = applyMoistureCorrection([
    { materialType: 'fine_aggregate', targetSsd: 100, absorptionPct: 0, moisturePct: 0 },
  ]);
  assert.equal(results[0].correctedTarget, 100);
  assert.equal(results[0].freeWater, 0);
});
