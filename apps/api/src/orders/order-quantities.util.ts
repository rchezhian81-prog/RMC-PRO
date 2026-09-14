/**
 * Ordered, batched, delivered — one order, three quantities, one rule.
 *
 * An order for concrete moves through three quantities that are easy to
 * confuse and were, in fact, confused: the m³ ORDERED (its lines), the m³
 * BATCHED (confirmed batch tickets — made, whether or not it left the yard),
 * and the m³ DELIVERED (delivery challans marked delivered, net of what came
 * back on the truck). The order book counted delivered from challans; the order
 * detail counted "delivered" from batch tickets and labelled it Delivered. A
 * load batched but still on the road, or delivered with 5 m³ returned, made the
 * two screens disagree about how much of the same order was left.
 *
 * This is the whole of the arithmetic, pure, so both screens and the tests can
 * share it. The SQL that produces the inputs lives in the orders service.
 */

export interface OrderQuantityInputs {
  orderedM3: number;
  batchedM3: number;
  /** Net of returns — what the customer actually kept. */
  deliveredM3: number;
  returnedM3: number;
}

export interface OrderQuantities extends OrderQuantityInputs {
  /** Ordered minus delivered: what the customer is still owed. */
  balanceM3: number;
  /** Batched but not yet on a delivered challan: on the road, or awaiting one. */
  pendingDeliveryM3: number;
}

const round3 = (n: number): number => Math.round((Number(n) || 0) * 1000) / 1000;

export function reconcileQuantities(q: OrderQuantityInputs): OrderQuantities {
  const orderedM3 = round3(q.orderedM3);
  const batchedM3 = round3(q.batchedM3);
  const deliveredM3 = round3(q.deliveredM3);
  const returnedM3 = round3(q.returnedM3);
  return {
    orderedM3,
    batchedM3,
    deliveredM3,
    returnedM3,
    balanceM3: round3(orderedM3 - deliveredM3),
    pendingDeliveryM3: round3(Math.max(0, batchedM3 - deliveredM3 - returnedM3)),
  };
}

export interface GradeQuantities {
  batchedM3: number;
  deliveredM3: number;
  returnedM3: number;
}

export interface LineQuantities extends GradeQuantities {
  balanceM3: number;
}

/**
 * Attribute an order's batched / delivered figures to its lines.
 *
 * Tickets and challans carry a grade, not an order line, so the figures are
 * known per grade. A line gets its grade's figures only when it is the only
 * line of that grade on the order; two M25 lines cannot be told apart, and
 * showing the grade's total on both would count it twice. Those get null and
 * the screen shows a dash rather than a number that is not theirs.
 */
export function attributeByGrade<T extends { gradeId?: string | null; gradeLabel?: string | null; quantityM3: number | string }>(
  items: T[],
  byGrade: Map<string, GradeQuantities>,
): (LineQuantities | null)[] {
  const keyOf = (it: T) => it.gradeId ?? String(it.gradeLabel ?? '').trim().toUpperCase();
  const linesPerGrade = new Map<string, number>();
  for (const it of items) linesPerGrade.set(keyOf(it), (linesPerGrade.get(keyOf(it)) ?? 0) + 1);
  return items.map((it) => {
    const key = keyOf(it);
    if ((linesPerGrade.get(key) ?? 0) !== 1) return null;
    const g = byGrade.get(key) ?? { batchedM3: 0, deliveredM3: 0, returnedM3: 0 };
    return {
      batchedM3: round3(g.batchedM3),
      deliveredM3: round3(g.deliveredM3),
      returnedM3: round3(g.returnedM3),
      balanceM3: round3(Number(it.quantityM3) - g.deliveredM3),
    };
  });
}
