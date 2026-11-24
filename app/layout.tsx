import type { Metadata, Viewport } from 'next';
import '@fontsource/press-start-2p/400.css';
import '@fontsource/pixelify-sans/400.css';
import '@fontsource/pixelify-sans/600.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'Pixel Pot',
  description: 'A chip counter for poker night. Deal real cards at the table and keep the chips on your phones.',
};

export const viewport: Viewport = {
  themeColor: '#1a1429',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
