# Dialog
The centred modal for confirmations, prompts and short forms: `min(480px, 100%)` wide on `mn-surface` with an `mn-border` edge, `mn-radius-lg` and `mn-shadow-pop`, over an `mn-scrim` backdrop (z-index 70) with 16px inset. It pops in over `mn-dur-std` (collapsed under reduced motion).

- Head: a 16px display title, padding 16px 18px, an `mn-border` underline. Body: padding 18px, scrolls when tall. Foot: actions right-aligned with a 10px gap, an `mn-border` overline; Cancel (secondary) then the confirming button (primary, or danger for a destructive act).
- Behaviour: `role="dialog"` with `aria-modal`, focus moves in and is trapped, Escape and a backdrop click close, focus returns to the trigger.
- The consumer provides `open`, `onClose`, `title`, children and `footer`. For a yes/no or a one-field prompt use `useConfirm()` from `ConfirmProvider`, which renders this surface from an imperative `confirm({...})` / `prompt({...})` call and replaces `window.confirm`.
- The preview also mounts `ConfirmProvider` and calls `useConfirm().confirm` and `.prompt` from two buttons.
