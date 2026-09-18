# Field
A labelled control with optional help or error text. The label is `label` (13px/500, `mn-muted`, 6px above), a required mark is a red asterisk in `mn-danger`, help is `small` in `mn-subtle`, an error is `small` in `mn-danger`; the field ends with a 14px margin.

- `Input` and `Select` share one surface: `mn-input`, full width, padding 10px 12px, 14px in the body face, `mn-surface` ground, `mn-border-strong` edge, `mn-radius-md`. Focus turns the border `mn-primary` and draws the 2px `mn-focus` outline at a 1px offset (v2: a 3px violet halo underneath and a 42px minimum height).
- The consumer provides `label`, the single control as the child, and `help`, `error`, `required` as needed. The field wires `htmlFor`, an `id` and `aria-describedby` itself; pass `htmlFor` and your own `id` to opt out.
- Show either help or error, never both; an error replaces the help text.
