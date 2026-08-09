# Mix Nova — brand assets

Drop the official Mix Nova logo file(s) here. **The `Logo` component auto-detects and
uses them the moment they exist — no code change needed.** Until then it renders a
typographic wordmark placeholder. We do not recreate or redesign the supplied logo.

## Files the app looks for (first that loads wins)

| Surface | Filenames (in priority order) |
|---------|-------------------------------|
| Light backgrounds (sidebar, admin) | `mix-nova-logo.svg` → `mix-nova-logo.png` |
| Dark / gradient backgrounds (login header) | `mix-nova-logo-white.svg` → `mix-nova-logo-white.png` → the light ones |

- **SVG preferred** (crisp at any size). A high-res **PNG (transparent, ~2× ≈ 400–600px tall)** also works.
- Use the **horizontal lockup** (mark + "MIX NOVA / RMC SOFTWARE" wordmark) — the tagline is optional (the component won't add a second one).
- For dark surfaces, export a **white/light** version so it stays legible on the purple gradient.
- *(Optional)* `mix-nova-mark.svg` (square mark only) and `icon.svg` / `favicon.ico` for the browser tab.

## How to add it
1. Save/export the logo from your design source as `mix-nova-logo.svg` (or `.png`) — the standalone logo, **not** the full brand board.
2. Put it in this folder (`apps/web/public/brand/`) and commit it to the branch.
3. Reload — the login, sidebar, and admin portal will show it automatically.

**Brand:** Mix Nova · *Smart Mix. Stronger Future.*
**Palette:** Primary Purple `#6C2BD9` · Electric Violet `#8A4FFF` · Soft Lavender `#B78CFF`
· Deep Navy `#1E1E2E` · Neutral Grey `#8E8E9A`.
