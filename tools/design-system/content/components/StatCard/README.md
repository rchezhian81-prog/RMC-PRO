# StatCard
A KPI tile for the owner dashboard: an uppercase `stat-label` in `mn-muted`, an icon chip (30px, `mn-purple-50` ground, `mn-primary` icon; 40px and tone-tinted under v2) and a big `stat-value` in the display face.

- The consumer provides `label`, `value` (already formatted: "₹18,40,000.00", "128"), an optional 16px icon, a `tone`, and `href` to make the whole tile a link.
- Tone colours the value (`mn-success`, `mn-warning`, `mn-danger`, `mn-info`); under v2 it also colours the icon chip and a 3px severity keyline on the left, the same status language as the operations grid. Neutral stays `mn-text`.
- `gradient` fills the tile with `mn-gradient` and white ink for the one headline figure; never more than one per strip.
- Long rupee figures ("₹18,40,000.00") need the v2 tile width; on a narrow strip abbreviate to lakhs ("₹18.4L") as the source gallery does.
- Lay tiles out in a `SummaryStrip`. Minimum width 168px (212px under v2).
