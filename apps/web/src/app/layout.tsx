import './globals.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import localFont from 'next/font/local';
import { isUiV2 } from '@/lib/ui-flag';

/* Vendored (self-hosted) at build time via next/font/local — NO build-time or
   runtime external calls. The four variable woff2 subsets under ./fonts/ are the
   exact Google Fonts faces (Inter latin, Space Grotesk latin, Noto Sans
   Devanagari, Noto Sans Tamil), committed to the repo so the web image builds
   deterministically offline (CI/Docker/VPS never reach fonts.gstatic.com).
   Inter for UI/data, Space Grotesk for display/headings, and the Noto faces so
   Indian-language names (customer, site, receiver) render with real glyphs
   instead of tofu. Latin stays on Inter; the browser only reaches for a Noto
   face when a codepoint isn't in Inter. */
const inter = localFont({
  src: './fonts/Inter-latin.woff2',
  variable: '--font-inter',
  weight: '100 900',
  display: 'swap',
});
const spaceGrotesk = localFont({
  src: './fonts/SpaceGrotesk-latin.woff2',
  variable: '--font-space-grotesk',
  weight: '300 700',
  display: 'swap',
});
const notoSans = localFont({
  src: './fonts/NotoSans-devanagari.woff2',
  variable: '--font-noto',
  weight: '100 900',
  display: 'swap',
});
const notoSansTamil = localFont({
  src: './fonts/NotoSansTamil-tamil.woff2',
  variable: '--font-noto-tamil',
  weight: '100 900',
  display: 'swap',
});
/* Display face for UI V2 ("Deep Violet Matte"). preload:false so it is fetched
   only when a rule actually uses it — i.e. only under [data-ui="v2"] — so the
   default (flag-OFF) UI downloads nothing extra and stays byte-identical. */
const outfit = localFont({
  src: './fonts/Outfit-latin.woff2',
  variable: '--font-outfit',
  weight: '100 900',
  display: 'swap',
  preload: false,
});

export const metadata: Metadata = {
  title: 'Mix Nova RMC Software',
  description:
    'Mix Nova — Smart Mix. Stronger Future. Multi-tenant Ready Mix Concrete plant operating system.',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  // Light default (long-hour ops readability); dark is opt-in via a toggle (Phase B).
  //
  // UI V2 rollout flag (PRESENTATION ONLY): when NEXT_PUBLIC_UI_V2 is on, stamp
  // data-ui="v2" on <html> so the Deep Violet Matte skin (added in a later PR
  // under :root[data-ui='v2']) applies. Resolved server-side from a build-time
  // constant, so it is identical on the client — no hydration mismatch, no flash.
  // When OFF the attribute is omitted entirely and the current UI is unchanged.
  const uiV2 = isUiV2();
  return (
    <html
      lang="en"
      data-theme="light"
      {...(uiV2 ? { 'data-ui': 'v2' } : {})}
      className={`${inter.variable} ${spaceGrotesk.variable} ${notoSans.variable} ${notoSansTamil.variable} ${outfit.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
