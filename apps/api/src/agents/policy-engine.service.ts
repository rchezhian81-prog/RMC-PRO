import { Injectable } from '@nestjs/common';
import type { AgentToolDef, PolicyDecision, Reversibility, ToolKind } from './agent.types';

/**
 * The single funnel every agent action passes through. It encodes the
 * blueprint's hard rule as pure logic (no I/O, so it unit-tests trivially):
 *
 *   - a READ always executes (L0/L1);
 *   - a REVERSIBLE write is `bounded` — it may execute under budget/caps, logged
 *     (L3);
 *   - anything else (irreversible / financial / legal / safety) is `block`ed for
 *     human approval (L2).
 *
 * There is deliberately no path here that lets a financial, legal, safety, or
 * irreversible action auto-execute. That is the property the whole substrate
 * exists to guarantee.
 */
export function decidePolicy(tool: { kind: ToolKind; reversibility: Reversibility }): PolicyDecision {
  if (tool.kind === 'read') {
    return { verdict: 'execute', reason: 'read-only — no side effects (L0/L1)' };
  }
  if (tool.reversibility === 'reversible') {
    return { verdict: 'bounded', reason: 'reversible write — bounded execute under caps (L3)' };
  }
  return {
    verdict: 'block',
    reason: `${tool.reversibility} action — human approval required, never auto-executed (L2)`,
  };
}

@Injectable()
export class PolicyEngineService {
  decide(tool: AgentToolDef): PolicyDecision {
    return decidePolicy(tool);
  }
}
