# IconButton
A 38px square `mn-iconbtn` for a single icon action: the theme toggle, the hamburger, the drawer's close, the rail collapse. `mn-surface` ground, `mn-border` edge, `mn-muted` icon at 17–18px, `mn-radius-md`.

- Hover washes `mn-purple-50`, turns the icon and border `mn-primary`. On the v2 rail it becomes a 10% white square with a white icon.
- The consumer provides the icon and an `aria-label` (it has no visible text); pair it with `title` for a tooltip.
- Two variants exist only as visibility switches: `mn-hamburger` shows below 1024px, `mn-rail-toggle` shows at 1025px and up.
- Static rendition: `mn-iconbtn` is a class, not a React component.
