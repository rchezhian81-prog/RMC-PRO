/**
 * Unit conversion over a tenant's `uom_conversions` rows (Plan A1). Each row
 * reads "1 `from` = `factor` × `to`"; conversions are bidirectional (the inverse
 * is `1/factor`) and chain transitively, so defining every unit against one base
 * makes any pair in that category convertible.
 *
 * Kept pure and free of the database so the arithmetic is unit-testable and
 * reusable by the batching correction in A2. Returns null when no path exists
 * (e.g. across unrelated categories), never a wrong number.
 */
export interface UomConversionRow {
  from: string;
  to: string;
  /** How many `to` units equal one `from` unit; must be finite and > 0. */
  factor: number;
}

/**
 * Convert `value` from one unit to another. `value` is scaled by the product of
 * factors along the shortest conversion path. Same unit → value unchanged; no
 * path → null.
 */
export function convertUom(
  value: number,
  from: string,
  to: string,
  rows: UomConversionRow[],
): number | null {
  if (from === to) return value;

  const adj = new Map<string, { to: string; factor: number }[]>();
  const addEdge = (a: string, b: string, factor: number): void => {
    if (!Number.isFinite(factor) || factor <= 0) return;
    (adj.get(a) ?? adj.set(a, []).get(a)!).push({ to: b, factor });
  };
  for (const r of rows) {
    addEdge(r.from, r.to, r.factor);
    addEdge(r.to, r.from, 1 / r.factor);
  }

  // Breadth-first search for the fewest-hop path, accumulating the factor.
  const seen = new Set<string>([from]);
  let frontier: { unit: string; factor: number }[] = [{ unit: from, factor: 1 }];
  while (frontier.length) {
    const next: { unit: string; factor: number }[] = [];
    for (const node of frontier) {
      for (const edge of adj.get(node.unit) ?? []) {
        const factor = node.factor * edge.factor;
        if (edge.to === to) return value * factor;
        if (!seen.has(edge.to)) {
          seen.add(edge.to);
          next.push({ unit: edge.to, factor });
        }
      }
    }
    frontier = next;
  }
  return null;
}
