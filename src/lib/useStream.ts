'use client';

import { useEffect, useRef } from 'react';

/** Типы событий, которые присылает /api/stream. */
const EVENT_TYPES = [
  'message.new',
  'message.edited',
  'message.deleted',
  'message.read',
  'reaction.changed',
  'conversation.created',
  'conversation.updated',
  'conversation.members',
  'typing',
  'presence',
] as const;

export type StreamEvent = (typeof EVENT_TYPES)[number];

interface Options {
  onEvent: (type: StreamEvent, data: Record<string, unknown>) => void;
  onStatusChange?: (connected: boolean) => void;
}

/**
 * Держит соединение с лентой событий.
 *
 * EventSource переподключается сам и присылает Last-Event-ID, поэтому серверу
 * достаточно закрывать поток по таймеру, а клиенту — ничего не предпринимать:
 * место в ленте не теряется.
 */
export function useEventStream({ onEvent, onStatusChange }: Options): void {
  // Обработчик держим в ref: иначе смена колбэка пересоздавала бы соединение.
  const handlerRef = useRef(onEvent);
  const statusRef = useRef(onStatusChange);

  useEffect(() => {
    handlerRef.current = onEvent;
    statusRef.current = onStatusChange;
  }, [onEvent, onStatusChange]);

  useEffect(() => {
    let source: EventSource | null = null;
    let reopenTimer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    const connect = () => {
      if (stopped) return;
      if (reopenTimer) {
        clearTimeout(reopenTimer);
        reopenTimer = null;
      }
      source?.close();

      source = new EventSource('/api/stream');

      source.onopen = () => statusRef.current?.(true);

      source.onerror = () => {
        statusRef.current?.(false);
        // Браузер переподключается сам, но если поток закрыт окончательно —
        // поднимаем его вручную с небольшой паузой.
        if (source?.readyState === EventSource.CLOSED && !stopped) {
          reopenTimer = setTimeout(connect, 2000);
        }
      };

      for (const type of EVENT_TYPES) {
        source.addEventListener(type, (event) => {
          try {
            handlerRef.current(type, JSON.parse((event as MessageEvent).data));
          } catch {
            // Битую строку просто пропускаем — следующая придёт нормальной.
          }
        });
      }

      source.addEventListener('hello', () => statusRef.current?.(true));
    };

    /**
     * Возвращение в приложение.
     *
     * В свёрнутой вкладке браузер сильно замедляет таймеры, поэтому после
     * планового закрытия потока переподключение может подвиснуть на минуту.
     * Для телефона это обычное дело — приложение сворачивают постоянно, — так
     * что при возвращении поднимаем соединение сами, не дожидаясь таймера.
     */
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || stopped) return;
      if (!source || source.readyState === EventSource.CLOSED) connect();
    };

    connect();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onVisible);
    window.addEventListener('pageshow', onVisible);

    return () => {
      stopped = true;
      if (reopenTimer) clearTimeout(reopenTimer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onVisible);
      window.removeEventListener('pageshow', onVisible);
      source?.close();
    };
  }, []);
}
