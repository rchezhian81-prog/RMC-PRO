# CommandBar
The page-level bar: title (`cmdbar-title`, an h1 at 18px/600) and a 13px `mn-muted` subtitle on the left, actions pushed right with an 8px gap. Ground `mn-surface-command`, edge `mn-border-command`, `mn-radius-lg`, lift `mn-elev-command`; padding 12px 16px.

- The consumer provides `title`, `subtitle` ("Today · Plant A"), `actions` (one primary button at most, then secondary or ghost, usually `size="sm"`), and `sticky` to pin it 12px from the top (z-index 15; near-opaque with a slight saturate under v2).
- Below 768px the actions wrap onto their own full-width line; below 480px each button stretches.
