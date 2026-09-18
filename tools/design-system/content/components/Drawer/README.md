# Drawer
A right-side panel for detail, filters or a longer form: `min(440px, 100%)` wide, full height, `mn-surface` with an `mn-border` left edge and `mn-shadow-pop`, over an `mn-scrim` backdrop (z-index 60/61). It slides in over `mn-dur-drawer`; full width and no edge below 480px.

- Head: a 16px display title and an `IconButton` close (X, 18px), padding 16px 18px, an `mn-border` underline. Body: padding 18px, scrolls. Foot: right-aligned actions with a 10px gap.
- Behaviour matches `Dialog`: `role="dialog"`, focus trapped and restored, Escape and backdrop close.
- The consumer provides `open`, `onClose`, `title`, children and `footer`. Use a drawer when the user needs to keep the list in view; a dialog when they must answer before continuing.
