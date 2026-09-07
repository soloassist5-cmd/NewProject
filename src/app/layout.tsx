import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
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
    { media: '(prefers-color-scheme: light)', color: '#eef3f8' },
    { media: '(prefers-color-scheme: dark)', color: '#0b1219' },
  ],
};

/** Применяет сохранённую тему до первой отрисовки, чтобы не мигало белым. */
const themeScript = `
try {
  var saved = localStorage.getItem('gimroom-theme');
  if (saved === 'dark' || saved === 'light') {
    document.documentElement.dataset.theme = saved;
  }
} catch (error) {}
`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Одноразовый ключ из middleware: без него браузер не выполнит этот скрипт,
  // потому что политика запрещает любые скрипты без nonce.
  const nonce = (await headers()).get('x-nonce') ?? undefined;

  return (
    <html lang="ru" suppressHydrationWarning>
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
