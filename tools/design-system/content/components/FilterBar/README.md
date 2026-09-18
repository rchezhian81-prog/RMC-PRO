# FilterBar
A `role="search"` row of filter controls on `mn-surface` with an `mn-border` edge, `mn-radius-md`, padding 10px 12px and 10px gaps; it wraps on narrow screens and stacks every control full width below 480px.

- Inputs inside it are auto-width with a 150px minimum; a `SearchInput` goes first, then `Select`s (status, plant, date range), then `actions` on the right ("More filters" as a ghost button).
- The consumer provides the controls as children and the `actions`.
