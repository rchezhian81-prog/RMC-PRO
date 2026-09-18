# Row
An interactive list row (`mn-row`) for pickers, queues and drawers: 14px text, padding 9px 12px, `mn-radius-md`, a 10px gap between its parts.

- Hover washes `mn-hover`. `mn-row-selected` takes the `mn-selected` ground and a 2px inset `mn-selected-border` keyline on the left. `aria-disabled="true"` drops it to 55% opacity and ignores the pointer.
- The consumer provides the content and the selection state; keep a badge or a figure at the right end.
- Static rendition: `mn-row` is a class, not a React component.
