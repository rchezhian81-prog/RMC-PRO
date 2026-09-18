# ThemeToggle
An `IconButton` in the topbar that flips `data-theme` on `<html>` between `light` and `dark`, showing Moon in light and Sun in dark (18px). Light is the default for long-hour readability; the choice persists in `localStorage` under `mn-theme`.

- The consumer renders it once, in the topbar; it needs no props. `aria-label` is "Toggle light/dark theme".
- The v2 finish is a separate switch (`data-ui="v2"`, set at build time), not part of this toggle.
- Static rendition: the component is in the bundle, but on mount it writes `data-theme` on the frame's `<html>`, which would fight the page's own theme switch.
