import type { MetadataRoute } from 'next';

/**
 * The web app manifest: lets Chrome and Edge offer "Install Mix Nova" on the
 * plant computer, so it opens in its own window from a desktop icon like any
 * other program, with the sign-in page as its front door.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Mix Nova RMC Software',
    short_name: 'Mix Nova',
    description: 'Smart Mix. Stronger Future. The operating system for a ready-mix concrete plant.',
    start_url: '/login',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#0f0a22',
    theme_color: '#6c2bd9',
    icons: [
      { src: '/icon.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/apple-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  };
}
