# Table
A data table at 14px inside a horizontal scroller (`mn-tablescroll`), so wide registers scroll within their card on phones with a soft edge shadow that appears only while the table overflows.

- Header cells (`Th`): 12px/600 uppercase, 0.02em, `mn-muted`, padding 10px 12px, an `mn-border` underline. Body cells (`Td`): `mn-text`, padding 10px 12px, an `mn-border` divider. Pass `numeric` to right-align a quantity or amount column; figures are tabular.
- The consumer provides the `thead` / `tbody` markup using `Th` and `Td`, and formats every value (Indian grouping, ₹, units). Put a `StatusBadge` in a status column, never a coloured cell.
- Under v2 the header takes an `mn-surface-2` ground, `mn-subtle` 11px caps at 0.06em, rows pad 11px 14px, hover washes 5% of `mn-primary`, and the last row drops its divider.
- Place the table in a `Card` with `padded={false}` and a `Toolbar` above it.
