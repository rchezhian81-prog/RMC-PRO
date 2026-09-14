/**
 * IS 456:2000 §15.2.2 Table 10 — cube-sampling frequency.
 *
 * Stated in full, because the tests are written from the table and not from
 * the code:
 *
 *   quantity of concrete (m³)   samples
 *   1 – 5                       1
 *   6 – 15                      2
 *   16 – 30                     3
 *   31 – 50                     4
 *   51 and above                4 + one per additional 50 m³ or part thereof
 *
 * Nothing modelled this before. The register could list every cube set ever
 * cast and still not say whether Tuesday's 80 m³ of M25 had the five samples
 * it needed — the first thing an inspector asks.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { requiredSamples, samplingSummary } from '../../dist/qc/sampling.util.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../../..');
const codeOnly = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

test('Table 10 at every band boundary', () => {
  const table = [
    [0, 0], [0.5, 1], [1, 1], [5, 1],
    [5.001, 2], [6, 2], [15, 2],
    [16, 3], [30, 3],
    [31, 4], [50, 4],
    [51, 5], [100, 5], [100.5, 6], [101, 6], [150, 6], [151, 7], [1000, 23],
  ];
  for (const [m3, want] of table) {
    assert.equal(requiredSamples(m3), want, `${m3} m³ → ${want} sample(s)`);
  }
  assert.equal(requiredSamples(Number.NaN), 0);
  assert.equal(requiredSamples(-4), 0);
});

test('a day is compliant only when every grade produced has its samples', () => {
  const g = (day, grade, producedM3, samplesCast) => ({
    plantId: 'p1', plantLabel: 'P1', day, gradeId: grade, gradeLabel: grade, producedM3, samplesCast,
  });
  const s = samplingSummary([
    g('2026-09-10', 'M25', 80, 5), // needs 5, has 5
    g('2026-09-10', 'M20', 12, 1), // needs 2, has 1 — short by 1
    g('2026-09-11', 'M25', 4, 0), // needs 1, has 0 — short by 1
    g('2026-09-11', 'M30', 0, 0), // nothing produced: not a group at all
  ]);
  assert.equal(s.groups, 3, 'a grade with no production that day is not judged');
  assert.equal(s.underSampled, 2);
  assert.equal(s.totalRequired, 8);
  assert.equal(s.totalCast, 6);
  assert.equal(s.totalShortfall, 2);
  assert.equal(s.totalProducedM3, 96);
  const m20 = s.rows.find((r) => r.gradeLabel === 'M20');
  assert.deepEqual(
    { required: m20.samplesRequired, shortfall: m20.shortfall, compliant: m20.compliant },
    { required: 2, shortfall: 1, compliant: false },
  );
  const m25 = s.rows.find((r) => r.day === '2026-09-10' && r.gradeLabel === 'M25');
  assert.equal(m25.compliant, true);
});

test('extra samples are never a credit against another grade or day', () => {
  const s = samplingSummary([
    { plantId: 'p1', plantLabel: 'P1', day: '2026-09-10', gradeId: 'M25', gradeLabel: 'M25', producedM3: 10, samplesCast: 9 },
    { plantId: 'p1', plantLabel: 'P1', day: '2026-09-10', gradeId: 'M20', gradeLabel: 'M20', producedM3: 10, samplesCast: 0 },
  ]);
  assert.equal(s.underSampled, 1, 'nine M25 sets do not certify the M20');
  assert.equal(s.totalShortfall, 2);
});

test('rows come newest day first, grades alphabetical within a day', () => {
  const s = samplingSummary([
    { plantId: 'p1', plantLabel: 'P1', day: '2026-09-09', gradeId: 'M25', gradeLabel: 'M25', producedM3: 1, samplesCast: 1 },
    { plantId: 'p1', plantLabel: 'P1', day: '2026-09-10', gradeId: 'M30', gradeLabel: 'M30', producedM3: 1, samplesCast: 1 },
    { plantId: 'p1', plantLabel: 'P1', day: '2026-09-10', gradeId: 'M20', gradeLabel: 'M20', producedM3: 1, samplesCast: 1 },
  ]);
  assert.deepEqual(s.rows.map((r) => `${r.day} ${r.gradeLabel}`), ['2026-09-10 M20', '2026-09-10 M30', '2026-09-09 M25']);
});

test('the compliance agent asks the same SQL and rule as the report', () => {
  // Two implementations of "did we sample enough" is how the report says yes
  // and the compliance finding says no about the same Tuesday.
  const agent = codeOnly(readFileSync(resolve(repoRoot, 'apps/api/src/agents/specialist.agent.ts'), 'utf8'));
  assert.match(agent, /samplingGroupsWithin\(/, 'the agent must use the shared SQL');
  assert.match(agent, /samplingSummary\(/, 'and the shared rule');
  assert.match(agent, /code: 'under_sampled'/, 'and raise the finding');
  assert.doesNotMatch(agent, /FROM qc_cube_sets/, 'without a cube-set query of its own');
});
