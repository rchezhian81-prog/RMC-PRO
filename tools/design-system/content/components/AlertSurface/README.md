# AlertSurface
An inline notice or approval request: an 18px tone icon, a 13.5px body with a 600 title, and optional actions (Approve / Reject) 10px below. Padding 13px 15px, `mn-radius-md`, 12px gap.

- Tones set the border, tint and icon colour: `mn-info` on `mn-info-tint` (Info icon; also `processing` and `neutral`), `mn-success` on `mn-success-tint` (CheckCircle2), `mn-warning` on `mn-warning-tint` (AlertTriangle), `mn-danger` on `mn-danger-tint` (XCircle). Body text stays `mn-text` for readability; only the icon and border carry the tone.
- `danger` renders with `role="alert"`, the rest `role="status"`.
- The consumer provides `tone`, `title`, the body as children, `actions` (small buttons) and, rarely, a custom `icon`. Write the body as a fact and a consequence: "This dispatch exceeds the credit hold. Approve to proceed."
