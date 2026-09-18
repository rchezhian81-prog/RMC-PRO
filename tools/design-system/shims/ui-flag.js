// The app reads NEXT_PUBLIC_UI_V2 at build time. In the design system the v2 finish
// follows the two v2 themes instead, so the flag is on whenever the frame's theme is one.
export function isUiV2() {
  const doc = globalThis.document;
  const t = doc ? doc.documentElement.getAttribute('data-theme') || '' : '';
  return t.startsWith('v2-');
}
