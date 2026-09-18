# Shell
The app frame: a 248px `mn-sidebar` (logo at 26px, collapsible nav groups, nav items) beside a fluid column with a sticky `mn-topbar` and the padded `mn-main`. Ground `mn-bg`; sidebar and topbar on `mn-surface` with `mn-border` seams. A "Skip to content" link comes first and targets `main`.

- Nav group header (`mn-navgroup`): an 11px uppercase button in `mn-subtle` with a chevron that rotates when expanded; the active page's group opens by default. Nav item (`mn-nav`): 14px in `mn-muted`, an 18px Lucide icon, padding 8px 11px, radius 9px; hover washes `mn-purple-50`; the active item fills `mn-primary` with white text.
- Topbar: 12px 22px, the page label in the display face at 16px, then the `ThemeToggle`, the signed-in email (hidden below 768px) and a ghost Logout button. A hamburger appears below 1024px, when the sidebar becomes a 268px off-canvas drawer over `mn-scrim`.
- Under v2 the sidebar becomes the deep-violet rail (gradient in `bundle.css`, ink `mn-rail-fg`, items `mn-rail-muted`, headers `mn-rail-title`, a back-lit active band), the topbar blurs, and a desktop toggle collapses the rail to 76px of icons.
- The consumer provides the nav groups (title, items with href, label and icon), the page label and the user; see the icon domain map in the brand book.
- Static rendition: the shell is the app layout (`apps/web/src/app/app/layout.tsx`), not an exported component, so this preview is markup on the same classes.
