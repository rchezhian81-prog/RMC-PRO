# SearchInput
A search surface: a 16px Search icon in `mn-muted`, a borderless `type="search"` input at 14px, and a clear button (15px X in `mn-subtle`, `mn-primary` on hover) that appears once there is a value. Minimum width 200px; full width below 768px.

- Ground `mn-surface`, edge `mn-border-strong`, `mn-radius-md`; the whole surface takes the `mn-primary` border and `mn-focus` outline on `focus-within`.
- The consumer provides `value`, `onChange(string)`, a `placeholder` ("Search challans…") and an `ariaLabel`; it lives in a `FilterBar`.
