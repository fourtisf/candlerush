import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Providers } from './providers';
import './globals.css';

const site = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://candlerush.fun';

/**
 * Icons and social images are file-based: app/icon.svg, app/apple-icon.png,
 * app/opengraph-image.jpg and app/twitter-image.jpg are picked up automatically. All of
 * them are generated from docs/brand/svg/vault.svg, so the tab icon cannot drift from the
 * logo it was cut from.
 */
export const metadata: Metadata = {
  metadataBase: new URL(site),
  title: 'Candle Rush',
  description:
    'Ride the candles, bank the close. A levelled endless runner where the terrain is a candlestick chart.',
  applicationName: 'Candle Rush',
  manifest: '/manifest.webmanifest',
  openGraph: {
    type: 'website',
    url: site,
    siteName: 'Candle Rush',
    title: 'Candle Rush',
    description: 'Ride the candles, bank the close.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Candle Rush',
    description: 'Ride the candles, bank the close.',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#06081C',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
