/**
 * End-to-end order-to-cash integration test (money path).
 *
 * Drives the real API through the whole business cycle and asserts each stage
 * advances and the invoice is billed and settled:
 *   quotation → approve → order → confirm → batch queue → batch ticket
 *   (consumes stock) → dispatch → challan → deliver → invoice → issue → receipt.
 *
 * Reuses scripts/setup/test-order-cycle.mjs, the maintained flow driver, which
 * validates every step and the ₹ total internally and exits non-zero on any
 * failure. Requires the plant master fixtures the orchestrator seeds.
 *
 * Env: API_URL, LOGIN, RMC_PASSWORD (provided by run-integration.mjs).
 */
import { spawnSync } from 'node:child_process';

console.log('=== order-to-cash cycle (quotation → … → invoice → receipt) ===');
const r = spawnSync('node', ['../../scripts/setup/test-order-cycle.mjs'], {
  stdio: 'inherit',
  env: process.env,
});

if ((r.status ?? 1) === 0) {
  console.log('\nORDER-TO-CASH TEST: cycle completed and settled ✓');
  process.exit(0);
}
console.error('\nORDER-TO-CASH TEST: cycle failed');
process.exit(1);
