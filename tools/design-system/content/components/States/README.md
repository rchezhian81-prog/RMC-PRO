# States
The five non-data states every list and detail screen needs: `Loading` (an 18px spinning Loader2 beside a 14px `mn-muted` label, `role="status"`), `Skeleton` (an `mn-border` block, `mn-radius-sm`, pulsing; shimmering under v2) and `TableSkeleton` (rows of them, so a list never flashes empty before its first page), `EmptyState` (a 44px `mn-purple-50` chip with a 22px Inbox icon in `mn-primary`, a 16px display title, a 13px `mn-muted` line up to 360px, an optional action), `ErrorState` (`role="alert"`: `mn-danger-tint` ground, `mn-danger` border, AlertTriangle, the message, an optional retry) and `PermissionDenied` (the empty layout with a Lock on `mn-surface-2` and the title "Restricted").

- The consumer provides the copy: an empty title that names the thing ("No challans today"), a description that says what to do, an action that does it; an error message that says what failed.
- Show a skeleton while the first page loads, an inline `Loading` for a refresh, never both.
