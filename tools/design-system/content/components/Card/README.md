# Card
The working surface for a table, a form or a block of content: `mn-surface`, a 1px `mn-border`, `mn-radius-lg` and `mn-shadow-card`. An optional header carries a title in the display face (15px; 16px under v2) and right-aligned actions, divided from the body by an `mn-border` hairline.

- The consumer provides `title` (string or node), `actions` (usually small buttons) and children. `padded` (default) pads the body 18px; set it false to run a table edge to edge.
- The card sets `min-width: 0` so a wide table scrolls inside it instead of stretching the page; keep that when composing your own.
- Cards sit on `mn-bg`, never on another card. A card inside a link lifts 2–3px on hover under v2.
- Under v2 the header pads 13px 18px, the body 16px 18px, and the card takes `mn-radius-lg-v2` with a layered `mn-shadow-card`.
