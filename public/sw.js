/*
 * Service worker «ГимРума».
 *
 * Задача у него скромная и намеренно такая: пережить пропажу сети, показав
 * понятный экран вместо ошибки браузера, и не заставлять телефон каждый раз
 * скачивать оболочку приложения заново.
 *
 * Чего он НЕ делает — и это главное решение здесь: не кэширует ничего из
 * /api/. Переписка, списки чатов, вложения проходят мимо кэша всегда. Иначе
 * сообщения оседали бы на диске у каждого, кто открыл мессенджер с общего
 * компьютера в классе, и «выйти из аккаунта» перестало бы что-либо значить.
 * Кэшируется только то, что и так открыто всем: разметка оболочки, скрипты,
 * стили, герб.
 */

const CACHE = 'gimroom-shell-v1';
const OFFLINE_PAGE = '/offline.html';

// Файлы, без которых офлайн-экран не покажется.
const PRECACHE = [OFFLINE_PAGE, '/mark.svg', '/emblem.png', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      // Не ждём закрытия всех вкладок: новая версия нужна сразу.
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Чужие домены и всё, кроме обычного чтения, — мимо нас.
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  // Переписка и файлы: только сеть. См. комментарий вверху файла.
  if (url.pathname.startsWith('/api/')) return;

  // Статика Next помечена хешем в имени: содержимое по такому адресу
  // не меняется никогда, поэтому кэш можно отдавать не спрашивая сеть.
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ??
          fetch(request).then((response) => {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
            return response;
          }),
      ),
    );
    return;
  }

  // Переходы по страницам: сначала сеть — она отдаёт свежую сессию, — а если
  // связи нет, показываем офлайн-экран.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match(OFFLINE_PAGE).then((hit) => hit ?? offlineFallback())),
    );
    return;
  }

  // Остальное (герб, значки, манифест): сеть, а при неудаче — что было.
  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy));
        return response;
      })
      .catch(() => caches.match(request)),
  );
});

/*
 * Нажатие на уведомление.
 *
 * На Android уведомления показывает именно service worker — значит и нажатие
 * приходит сюда, а не на страницу. Если мессенджер уже открыт, поднимаем его
 * окно и просим открыть нужный чат; если закрыт — открываем заново.
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const conversationId = event.notification.data?.conversationId;

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });

      for (const client of windows) {
        if (!client.url.startsWith(self.location.origin)) continue;
        await client.focus();
        client.postMessage({ type: 'open-conversation', conversationId });
        return;
      }

      // Открытого окна нет — запускаем мессенджер и передаём чат в адресе.
      const target = conversationId ? `/?chat=${conversationId}` : '/';
      await self.clients.openWindow(target);
    })(),
  );
});

/** На случай, если офлайн-страница почему-то не попала в кэш. */
function offlineFallback() {
  return new Response('<h1>Нет связи</h1><p>Проверьте интернет и обновите страницу.</p>', {
    status: 503,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}
