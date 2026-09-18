# Toolbar
The strip above a table (`role="toolbar"`): a 13px `mn-muted` count on the left ("128 challans", tabular figures) and actions on the right. Ground `mn-surface`, edge `mn-border`, `mn-radius-md`, padding 9px 12px, 10px gaps.

- With `selectedCount` above zero it switches to the selection state: "3 selected" announced politely, the ground `mn-selected` and the border `mn-selected-border`, and the bulk actions (Approve, Delete) take the place of the list actions.
- The consumer provides `count` or `selectedCount`, `actions`, and any extra controls as children.
