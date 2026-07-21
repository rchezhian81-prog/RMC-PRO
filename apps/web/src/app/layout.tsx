import './globals.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Inter, Space_Grotesk, Noto_Sans, Noto_Sans_Tamil } from 'next/font/google';

/* Self-hosted at build time (next/font) — no runtime external calls. Inter for
   UI/data, Space Grotesk for display/headings, and Noto Sans (Devanagari/Hindi)
   + Noto Sans Tamil so Indian-language names (customer, site, receiver) render
   with real glyphs instead of tofu on any OS. Latin stays on Inter; the browser
   only reaches for a Noto face when a codepoint isn't in Inter. */
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-space-grotesk',
  weight: ['500', '600', '700'],
  display: 'swap',
});
const notoSans = Noto_Sans({
  subsets: ['devanagari'],
  variable: '--font-noto',
  weight: ['400', '500', '600', '700'],
  display: 'swap',
});
const notoSansTamil = Noto_Sans_Tamil({
  subsets: ['tamil'],
  variable: '--font-noto-tamil',
  weight: ['400', '500', '600', '700'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Mix Nova RMC Software',
  description:
    'Mix Nova — Smart Mix. Stronger Future. Multi-tenant Ready Mix Concrete plant operating system.',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  // Light default (long-hour ops readability); dark is opt-in via a toggle (Phase B).
  return (
    <html
      lang="en"
      data-theme="light"
      className={`${inter.variable} ${spaceGrotesk.variable} ${notoSans.variable} ${notoSansTamil.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
