# Button
One primary action per surface; everything else is secondary, ghost or danger. `primary` fills `mn-primary` with `mn-on-primary` text, `secondary` is `mn-surface` with an `mn-border-strong` edge, `ghost` is transparent and washes `mn-purple-50` on hover, `danger` fills `mn-danger` with white text.

- Sizes: `md` (14px/600, padding 10px 16px, min-height 40px, the touch floor) and `sm` (13px, 6px 11px, 32px). Radius `mn-radius-md`; icon gap 8px; a leading `icon` at 15–16px.
- The consumer provides the label as children, an optional leading icon and the handler. If `onClick` returns a promise the button goes busy on its own: a spinning Loader2 replaces the icon, `aria-busy` is set and further clicks are refused until it settles. A submit button also reflects its enclosing `Form`'s save. Pass `loading` to drive it yourself.
- Disabled and busy: 60% opacity, cursor default, colours unchanged.
- Hover: primary darkens to `mn-primary-hover`; secondary takes `mn-surface-2` and an `mn-primary` border; ghost tints. Under v2 the primary carries `mn-glow-primary`, a press drops it 1px, and the secondary gains `mn-shadow-1`.
- Keep danger for destructive confirms only (Delete, Approve override, Reject with loss). Its white label is 2.8:1 on the dark themes, a source pair kept as is.
