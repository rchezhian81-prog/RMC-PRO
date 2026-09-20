# Mix Nova — brand assets

The real Mix Nova logo lives here and the `Logo` component picks it up automatically.

## Files

| File | Used for |
|------|----------|
| `mix-nova-logo.png` | Horizontal lockup (emblem + "MIX NOVA / RMC SOFTWARE") on light surfaces: landing nav and footer, the default sidebar, admin. |
| `mix-nova-logo-white.png` | The same lockup with the navy ink turned white, for dark surfaces: the violet rail, the login hero, the dark theme. |
| `mix-nova-lockup.png` / `-white.png` | Stacked lockup (emblem over wordmark and the tagline "Smart Mix. Stronger Future."), where the component is asked for the tagline (the login card header). |
| `mix-nova-mark.png` | The emblem alone (M + N with the mixer, ring, skyline and star). Also the source of the browser-tab icon in `apps/web/src/app/icon.png`. |

## Where they came from

Cut from the approved brand board (the same board is under `tools/design-system/content/assets/LOGO/`): the near-white ground keyed to transparency with the edge fringe removed, the horizontal lockup composed from the board's emblem and wordmark, and the on-dark versions made by turning the dark, unsaturated ink white. All are PNG at 2× to 4× the largest size the app renders.

## Upgrading to vector

When the design source is available, export the same lockups as SVG with these names, drop them here and commit:

- `mix-nova-logo.svg`, `mix-nova-logo-white.svg`
- `mix-nova-lockup.svg`, `mix-nova-lockup-white.svg`

An SVG with the same name wins over the PNG automatically; nothing else changes.

**Brand:** Mix Nova · *Smart Mix. Stronger Future.*
**Palette:** Primary Purple `#6C2BD9` · Electric Violet `#8A4FFF` · Soft Lavender `#B78CFF`
· Deep Navy `#1E1E2E` · Neutral Grey `#8E8E9A`.
