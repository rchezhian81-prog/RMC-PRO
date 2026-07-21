# Mix Nova — brand assets

Drop the official Mix Nova logo files here. They are **not** in the repo yet, so the
UI currently renders a typographic wordmark placeholder (`src/components/ui/Logo.tsx`).
We do not recreate or redesign the supplied logo — this folder is only for the real asset.

Expected files (SVG preferred for crispness at any size):

| File | Use |
|------|-----|
| `mix-nova-logo.svg` | full horizontal lockup (mark + wordmark) — login, sidebar header |
| `mix-nova-mark.svg` | square mark only — collapsed sidebar, avatars |
| `favicon.ico` / `icon.svg` | browser tab icon (wire via `app/icon`) |
| `mix-nova-logo-dark.svg` *(optional)* | variant tuned for dark surfaces |

Once added, update `src/components/ui/Logo.tsx` to render the SVG via `<img>` (or
`next/image`) instead of the placeholder wordmark, preserving the same size props.

**Brand:** Mix Nova · *Smart Mix. Stronger Future.*
**Palette:** Primary Purple `#6C2BD9` · Electric Violet `#8A4FFF` · Soft Lavender `#B78CFF`
· Deep Navy `#1E1E2E` · Neutral Grey `#8E8E9A`.
