# Badge
A dark-text-on-tint pill for a status: 12px/600, padding 3px 9px, `mn-radius-pill`, an optional 16px leading icon at a 5px gap. Tone pairs are `mn-success` on `mn-success-tint`, `mn-warning` on `mn-warning-tint`, `mn-danger` on `mn-danger-tint`, `mn-info` (also `processing`) on `mn-info-tint`, and `neutral` as `mn-muted` on `mn-surface-2`.

- The consumer provides the text (one or two words) and a `tone`, or uses `StatusBadge` with the raw API status: it maps the status through `statusTone` and shows it with underscores as spaces ("credit hold", "partially paid").
- Every status the API can emit must be in the map; an unmapped one falls to neutral and makes a blocking state look routine.
- Colour never carries the meaning alone: the word is always visible. Under v2 a hairline of the tone at 22% lifts the pill off its tint.
