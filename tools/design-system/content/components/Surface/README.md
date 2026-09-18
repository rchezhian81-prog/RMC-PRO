# Surface
The base primitive under every command surface: `plain` is a flat card ground (`mn-surface`, `mn-border`, `mn-radius-lg`), `raised` adds `mn-elev-command`, `command` swaps to `mn-surface-command`, `mn-border-command` and the same lift.

- The consumer provides children, optionally `padded` (16px), `as` to change the element, and a class or style.
- Use `command` for page-level tools that sit above content (the dashboard funnel, a sticky bar); `raised` for a block that should float a little; `plain` for everything else. Never put glass or a shadow on a table or a form.
