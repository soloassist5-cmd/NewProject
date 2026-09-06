import { currentUser } from '@/lib/auth';
import { config } from '@/lib/config';
import { sqlOne } from '@/lib/db';
import { eventsSince, latestEventId, publish } from '@/lib/events';
import { fail } from '@/lib/http';
import { runMaintenance } from '@/lib/maintenance';
import { getUser } from '@/lib/queries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Поток событий (Server-Sent Events).
 *
 * Почему не WebSocket: на serverless-хостинге вроде Vercel держать сокет и
 * общую шину между инстансами негде. Здесь источник правды — таблица `events`,
 * а каждое соединение просто читает её по курсору. Инстансы друг о друге не
 * знают, при обрыве ничего не теряется, и то же самое работает на своём сервере.
 *
 * Курсор берётся из заголовка Last-Event-ID, который браузер сам присылает при
 * переподключении EventSource, так что дырок в ленте не остаётся.
 */
export async function GET(request: Request): Promise<Response> {
  const user = await currentUser();
  if (!user) return fail(401, 'Нужно войти в аккаунт.');

  const url = new URL(request.url);
  const headerCursor = request.headers.get('last-event-id');
  const queryCursor = url.searchParams.get('cursor');
  const requested = Number.parseInt(headerCursor ?? queryCursor ?? '', 10);

  // Без курсора начинаем с текущей вершины: старые события переигрывать незачем.
  let cursor = Number.isFinite(requested) && requested >= 0 ? requested : await latestEventId();

  const encoder = new TextEncoder();
  const startedAt = Date.now();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;

      const send = (chunk: string): boolean => {
        if (closed) return false;
        try {
          controller.enqueue(encoder.encode(chunk));
          return true;
        } catch {
          // Клиент ушёл — дальше писать некуда.
          closed = true;
          return false;
        }
      };

      const sendEvent = (id: number | null, event: string, data: unknown): boolean => {
        const lines = [id != null ? `id: ${id}` : null, `event: ${event}`, `data: ${JSON.stringify(data)}`, '', ''];
        return send(lines.filter((line) => line !== null).join('\n'));
      };

      const onAbort = () => {
        closed = true;
      };
      request.signal.addEventListener('abort', onAbort);

      // Просим браузер переподключаться быстро, и сообщаем стартовый курсор.
      send('retry: 1000\n\n');
      sendEvent(null, 'hello', {
        cursor,
        userId: user.id,
        serverTime: new Date().toISOString(),
        onlineWindowSeconds: config.presence.onlineWindowSeconds,
      });

      await announcePresence(user.id);

      let emptyPolls = 0;
      let lastHeartbeat = Date.now();
      let lastPresenceTouch = Date.now();

      try {
        while (!closed && Date.now() - startedAt < config.realtime.streamLifetimeMs) {
          const events = await eventsSince(user.id, cursor);

          if (events.length > 0) {
            emptyPolls = 0;
            for (const event of events) {
              cursor = event.id;
              const ok = sendEvent(event.id, event.type, {
                conversationId: event.conversation_id,
                ...event.payload,
              });
              if (!ok) break;
            }
          } else {
            emptyPolls += 1;
          }

          if (closed) break;

          // Комментарий-пульс не даёт прокси закрыть «молчащее» соединение.
          if (Date.now() - lastHeartbeat > 15_000) {
            if (!send(': пульс\n\n')) break;
            lastHeartbeat = Date.now();
          }

          // Пока соединение живо, человек считается онлайн.
          if (Date.now() - lastPresenceTouch > 20_000) {
            await announcePresence(user.id);
            lastPresenceTouch = Date.now();
          }

          const interval =
            emptyPolls >= config.realtime.idleAfterEmptyPolls
              ? config.realtime.pollIdleMs
              : config.realtime.pollActiveMs;
          await sleep(interval, request.signal);
        }

        // Плановое завершение: отдаём курсор, браузер переподключится сам.
        sendEvent(cursor, 'bye', { cursor });
      } catch (error) {
        console.error('Ошибка потока событий:', error);
      } finally {
        request.signal.removeEventListener('abort', onAbort);
        try {
          controller.close();
        } catch {
          // Поток уже закрыт — это нормальный исход.
        }
      }

      // Изредка подчищаем служебные таблицы, чтобы они не росли бесконечно.
      if (Math.random() < 0.02) void runMaintenance().catch(() => {});
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Отключает буферизацию у nginx — иначе события копятся и приходят пачкой.
      'X-Accel-Buffering': 'no',
    },
  });
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(finish, ms);
    function finish() {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    }
    signal.addEventListener('abort', finish);
  });
}

/**
 * Отмечает человека в сети. Событие рассылаем только в момент появления —
 * пока он онлайн, лишний раз всех дёргать незачем.
 */
async function announcePresence(userId: number): Promise<void> {
  const row = await sqlOne<{ was_offline: boolean }>`
    WITH previous AS (
      SELECT last_seen_at FROM users WHERE id = ${userId}
    )
    UPDATE users
    SET last_seen_at = now()
    FROM previous
    WHERE users.id = ${userId}
    RETURNING previous.last_seen_at
      < now() - make_interval(secs => ${config.presence.onlineWindowSeconds}) AS was_offline
  `;

  if (row?.was_offline) {
    await publish({ type: 'presence', payload: { actorId: userId, user: await getUser(userId) } });
  }
}
