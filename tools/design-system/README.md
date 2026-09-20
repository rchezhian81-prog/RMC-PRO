# Design-system producer

Rebuilds the files of the **Mix Nova Design System** artifact
(<https://claude.ai/artifact/9XPTQfRuCZbCVvd8qK885i>) from this repository, so the design
system follows the code instead of drifting from it.

```bash
node tools/design-system/build.mjs            # → tools/design-system/dist/project/…  + report.json
node tools/design-system/build.mjs --full     # also copies content/ (brand book, guides, previews)
```

No repository dependency is needed: the first run installs esbuild, lucide-react and React 18
into `tools/design-system/.deps/` (git-ignored). Node 20+.

## What it reads and writes

| From the app | To `dist/project/` | How |
| --- | --- | --- |
| `apps/web/src/app/globals.css` (`--mn-*` under `:root`, `[data-theme='dark']`, `[data-ui='v2']`, both) | `tokens.json` | values re-read per theme (light, dark, v2-light, v2-dark) and merged onto `content/tokens.json`, keeping every usage note; new variables appended, vanished ones listed |
| `globals.css` component layer (`.mn-*`) | `components/bundle.css` | token blocks stripped, `data-ui='v2'` mapped to the two v2 themes, plus a small shim for the inline styles the React components render |
| `apps/web/src/components/ui/*.tsx`, `OfflineBanner.tsx`, two lib hooks | `components/bundle.js` | esbuild, one classic script assigning `window.MixNova`; React from the page, `next/link` as a plain anchor, the v2 flag read from the frame's theme, `Logo` given a `window.MixNovaBrand` hook |
| `apps/web/src/app/fonts/*.woff2` | `fonts/` | copied |
| `apps/web/public/brand/*.svg|png` | `assets/Logos/` | copied (the artifact stores these as uploads) |
| npm `react@18.3.1` | `components/lib/` | the previews' runtime |

`content/` holds the authored files (brand book, token usage notes, component guides and
previews, the cover, types, asset-group notes). They are the source for a full rebuild; the
automatic refresh never overwrites them, so edits made on the page are kept.

`report.json` lists every built file with its sha256 and the token changes, so a publisher
sends only what differs.

## Automatic refresh

A Routine in Claude Code (owner: the artifact's owner) runs daily in a fresh session: it checks
whether the paths above changed since the commit recorded in the artifact's `tokens.json`
(`meta.ref`), and if so runs this script and publishes the changed files to the artifact,
recording the new commit. When nothing changed it does nothing. Publishing is done through the
Artifact tool, which is why the refresh is a Routine rather than a GitHub Actions job.

If a component or the stylesheet changes shape so that the script cannot apply its `Logo` hook
or find the component layer, the script fails loudly and the Routine reports it instead of
publishing a broken bundle.
