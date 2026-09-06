import type { Metadata, Viewport } from 'next';
import { config } from '@/lib/config';
import './globals.css';

export const metadata: Metadata = {
  title: `${config.appName} — ${config.appTagline}`,
  description: `Мессенджер для общения внутри ${config.schoolName}.`,
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: config.appName, statusBarStyle: 'default' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Мессенджер ведёт себя как приложение: подстраиваемся под вырезы экрана
  // и не даём странице разъезжаться от двойного тапа.
  viewportFit: 'cover',
  maximumScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f4f5f9' },
    { media: '(prefers-color-scheme: dark)', color: '#0e1016' },
  ],
};

/** Применяет сохранённую тему до первой отрисовки, чтобы не мигало белым. */
const themeScript = `
try {
  var saved = localStorage.getItem('peremena-theme');
  if (saved === 'dark' || saved === 'light') {
    document.documentElement.dataset.theme = saved;
  }
} catch (error) {}
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
