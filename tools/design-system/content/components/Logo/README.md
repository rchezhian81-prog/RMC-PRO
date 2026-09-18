# Logo
The Mix Nova lockup, from `assets/Logos/`, or a typographic wordmark when the file is missing. Place `mix-nova-logo.svg` on `mn-surface` and `mix-nova-logo-white.svg` on `mn-gradient`, the login hero or the v2 rail; the component picks the on-dark file when `onDark` is set and falls back to the light one.

- Sizes: `sm` 26px (sidebar), `md` 32px (headers, default), `lg` 42px (login).
- The consumer provides nothing but the size and `onDark`; `showTagline` adds "Smart Mix. Stronger Future." only to the fallback wordmark, never under the real file.
- Fallback wordmark: a rounded square (28% radius) in `mn-gradient` holding "M" in white, then "Mix Nova" in the display face at 700 with "Nova" as gradient text; on dark, the square is white and "Nova" is `mn-purple-100`.
- Do not recolour, crop, or add the tagline beside the real lockup.
- The preview hands the two lockup files to the component through `window.MixNovaBrand` (a design-system-only hook patched into the bundle) instead of the app's `/brand/` paths, so it probes no network.
