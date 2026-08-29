/**
 * Minimal state-machine guard (Tier-A gap A6). Several manual `setStatus`
 * setters validated only that the target value was in an allow-list, never the
 * current → target move — so a terminal record (completed / cancelled / a
 * weighbridge entry already converted) could be re-opened, e.g. a completed
 * batch-queue entry flipped back to batching to over-produce.
 *
 * This guards the one invariant that matters: you cannot leave a terminal
 * state. Non-terminal moves stay open (the setters are operator-driven and the
 * automated flows change status by direct update, not through here). Pure so it
 * is unit-testable.
 */
export function leavesTerminal(current: string, target: string, terminal: readonly string[]): boolean {
  return current !== target && terminal.includes(current);
}
