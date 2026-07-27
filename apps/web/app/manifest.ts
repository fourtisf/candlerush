import type { MetadataRoute } from 'next';

/**
 * Installed to a home screen the game is landscape-only and dark, and saying so here is
 * what stops Android opening it in a portrait browser chrome.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Candle Rush',
    short_name: 'Candle Rush',
    description: 'Ride the candles, bank the close.',
    start_url: '/',
    display: 'fullscreen',
    orientation: 'landscape',
    background_color: '#06081C',
    theme_color: '#06081C',
    icons: [
      { src: '/brand/icon.svg', sizes: 'any', type: 'image/svg+xml' },
      { src: '/brand/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/brand/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    ],
  };
}
