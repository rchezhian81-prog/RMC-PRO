/**
 * RMC Phase-1 hardening / UAT test runner.
 *   node --experimental-sqlite tests/run.mjs
 * Requires the API + Postgres running and the demo tenants seeded. Exits
 * non-zero if any suite fails — suitable as a CI gate.
 */
import * as isolation from './tenant-isolation.mjs';
import * as rbac from './rbac-authorization.mjs';
import * as uat from './uat-e2e.mjs';
import * as security from './security.mjs';

const suites = [
  ['Tenant Isolation (CI gate)', isolation],
  ['RBAC / Authorization', rbac],
  ['UAT end-to-end', uat],
  ['Security', security], // last: intentionally trips the login rate limiter
];

const summary = [];
let totalPass = 0, totalFail = 0;

for (const [name, mod] of suites) {
  console.log(`\n=== ${name} ===`);
  try {
    const r = await mod.run();
    totalPass += r.passed; totalFail += r.failed;
    summary.push({ name: r.name, passed: r.passed, failed: r.failed });
  } catch (e) {
    console.error(`SUITE ERROR: ${e.message}`);
    totalFail += 1;
    summary.push({ name, passed: 0, failed: 1, error: e.message });
  }
}

console.log('\n===== SUMMARY =====');
for (const x of summary) {
  console.log(`${x.failed === 0 ? 'PASS' : 'FAIL'}  ${x.name}: ${x.passed} passed, ${x.failed} failed${x.error ? ` (${x.error})` : ''}`);
}
console.log(`\nTOTAL: ${totalPass} passed, ${totalFail} failed`);
process.exit(totalFail === 0 ? 0 : 1);
