import './globals.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Inter, Space_Grotesk } from 'next/font/google';

/* Self-hosted at build time (next/font) — no runtime external calls. Inter for
   UI/data, Space Grotesk for display/headings. Noto Sans (Indian scripts) is
   named in the CSS fallback stack and loaded in a later i18n phase. */
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-space-grotesk',
  weight: ['500', '600', '700'],
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
    <html lang="en" data-theme="light" className={`${inter.variable} ${spaceGrotesk.variable}`}>
      <body>{children}</body>
    </html>
  );
}
