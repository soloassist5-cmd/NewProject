import { NextResponse, type NextRequest } from 'next/server';

/**
 * Заголовки безопасности для всех ответов.
 *
 * Главный из них — Content-Security-Policy. Он не заменяет экранирование
 * (React и так вставляет пользовательский текст как текст), но остаётся
 * последним рубежом: даже если куда-то просочится чужой скрипт, браузер
 * откажется его выполнять.
 *
 * Скрипты разрешены не «отсюда», а по одноразовому nonce: он свой на каждый
 * ответ, и подобрать его нельзя. Next сам проставляет этот nonce своим
 * скриптам, увидев его в заголовке.
 */
export function middleware(request: NextRequest) {
  const nonce = crypto.randomUUID().replaceAll('-', '');
  const isDev = process.env.NODE_ENV !== 'production';

  const policy = [
    "default-src 'self'",
    // strict-dynamic: доверяем только скриптам с nonce и тем, что они грузят.
    // В разработке Next пересобирает страницу через eval — там без этого никак.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    // Стили Next вставляет прямо в страницу; для стилей риск несопоставимо ниже.
    "style-src 'self' 'unsafe-inline'",
    // blob: — превью картинки, которую человек только что выбрал и ещё не отправил.
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "font-src 'self'",
    "connect-src 'self'",
    // Service worker: без явного разрешения он унаследовал бы script-src, где
    // стоит strict-dynamic — а тот отменяет 'self' и заблокировал бы /sw.js.
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    // Страницу нельзя открыть в чужом фрейме — защита от подмены нажатий.
    "frame-ancestors 'none'",
    ...(isDev ? [] : ['upgrade-insecure-requests']),
  ].join('; ');

  // Маршруты API отдают JSON и файлы; у выдачи файлов свой, более строгий CSP,
  // и перебивать его здесь не нужно.
  const isApi = request.nextUrl.pathname.startsWith('/api/');

  const requestHeaders = new Headers(request.headers);
  if (!isApi) {
    requestHeaders.set('x-nonce', nonce);
    requestHeaders.set('content-security-policy', policy);
  }

  const response = NextResponse.next({ request: { headers: requestHeaders } });

  if (!isApi) response.headers.set('content-security-policy', policy);

  // Браузер не должен угадывать тип содержимого по его началу.
  response.headers.set('x-content-type-options', 'nosniff');
  // Для старых браузеров, не знающих frame-ancestors.
  response.headers.set('x-frame-options', 'DENY');
  // Адрес нашей страницы не утекает на чужие сайты по ссылкам из сообщений.
  response.headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  // Ничего из этого приложению не нужно — пусть будет отключено.
  response.headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=(), interest-cohort=()');

  return response;
}

export const config = {
  matcher: [
    /*
     * Все страницы и маршруты, кроме статики самого Next и картинок-иконок:
     * им заголовки безопасности не нужны, а лишний обработчик только замедляет.
     */
    '/((?!_next/static|_next/image|icon.svg|manifest.webmanifest|favicon.ico).*)',
  ],
};
