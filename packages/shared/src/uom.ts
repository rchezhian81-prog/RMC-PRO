/**
 * Unit conversion over a tenant's `uom_conversions` rows (Plan A1). Each row
 * reads "1 `from` = `factor` × `to`"; conversions are bidirectional (the inverse
 * is `1/factor`) and chain transitively, so defining every unit against one base
 * makes any pair in that category convertible.
 *
 * Shared by the API (which converts and stores) and the web (which offers the
 * reachable units on a line and shows the converted value as it is typed), so
 * both sides agree on what can be converted. Pure: returns null when no path
 * exists (e.g. across unrelated categories), never a wrong number.
 */
export interface UomConversionRow {
  from: string;
  to: string;
  /** How many `to` units equal one `from` unit; must be finite and > 0. */
  factor: number;
}

type Edge = { to: string; factor: number };

function adjacency(rows: UomConversionRow[]): Map<string, Edge[]> {
  const adj = new Map<string, Edge[]>();
  const addEdge = (a: string, b: string, factor: number): void => {
    if (!Number.isFinite(factor) || factor <= 0) return;
    const list = adj.get(a);
    if (list) list.push({ to: b, factor });
    else adj.set(a, [{ to: b, factor }]);
  };
  for (const r of rows) {
    addEdge(r.from, r.to, r.factor);
    addEdge(r.to, r.from, 1 / r.factor);
  }
  return adj;
}

/**
 * Convert `value` from one unit to another. `value` is scaled by the product of
 * factors along the shortest conversion path. Same unit → value unchanged; no
 * path → null.
 */
export function convertUom(value: number, from: string, to: string, rows: UomConversionRow[]): number | null {
  if (from === to) return value;
  const adj = adjacency(rows);
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

/**
 * Every unit reachable from `uom` through the rows, in either direction, with
 * `uom` itself first. What a line's Unit select offers.
 */
export function reachableUoms(uom: string | null | undefined, rows: UomConversionRow[]): string[] {
  const start = String(uom ?? '').trim();
  if (!start) return [];
  const adj = adjacency(rows);
  const out = [start];
  const seen = new Set(out);
  // for-of walks entries pushed during the loop, so this is a breadth-first sweep.
  for (const unit of out) {
    for (const edge of adj.get(unit) ?? []) {
      if (!seen.has(edge.to)) { seen.add(edge.to); out.push(edge.to); }
    }
  }
  return out;
}
