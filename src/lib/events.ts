import { pool, sql } from './db';

/**
 * Realtime построен на журнале событий в базе.
 *
 * Любое изменение (новое сообщение, реакция, правка) кладёт строку в `events`.
 * Клиенты держат SSE-соединение и читают журнал по курсору `id`, поэтому
 * ничего не теряется при переподключении и не нужна отдельная шина сообщений —
 * важное свойство для serverless, где инстансы не видят друг друга.
 */

export type EventType =
  | 'message.new'
  | 'message.edited'
  | 'message.deleted'
  | 'message.read'
  | 'reaction.changed'
  | 'conversation.created'
  | 'conversation.updated'
  | 'conversation.members'
  | 'typing'
  | 'presence';

export interface PublishInput {
  type: EventType;
  /** К какому диалогу относится событие. null — событие вне диалогов. */
  conversationId?: number | null;
  /** Кому адресовано. null — всем участникам диалога. */
  userId?: number | null;
  payload?: Record<string, unknown>;
}

export async function publish(event: PublishInput): Promise<void> {
  await sql`
    INSERT INTO events (conversation_id, user_id, type, payload)
    VALUES (
      ${event.conversationId ?? null},
      ${event.userId ?? null},
      ${event.type},
      ${JSON.stringify(event.payload ?? {})}::jsonb
    )
  `;
}

/** Несколько событий одним запросом — чтобы не гонять базу по кругу. */
export async function publishMany(events: PublishInput[]): Promise<void> {
  if (events.length === 0) return;

  const values: unknown[] = [];
  const tuples = events.map((event, index) => {
    const base = index * 4;
    values.push(
      event.conversationId ?? null,
      event.userId ?? null,
      event.type,
      JSON.stringify(event.payload ?? {}),
    );
    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}::jsonb)`;
  });

  await pool().query(
    `INSERT INTO events (conversation_id, user_id, type, payload) VALUES ${tuples.join(', ')}`,
    values,
  );
}

export interface StoredEvent {
  id: number;
  conversation_id: number | null;
  user_id: number | null;
  type: EventType;
  payload: Record<string, unknown>;
}

/**
 * Забирает события, которые видит данный пользователь: адресованные лично ему
 * и всё, что происходит в его диалогах.
 *
 * Собственные события пользователя тоже возвращаются — иначе вторая вкладка или
 * телефон не увидели бы отправленное с ноутбука. Клиент склеивает их с тем, что
 * уже показал оптимистично, по идентификатору сообщения.
 */
export async function eventsSince(userId: number, cursor: number, limit = 200): Promise<StoredEvent[]> {
  return sql<StoredEvent>`
    SELECT e.id, e.conversation_id, e.user_id, e.type, e.payload
    FROM events e
    WHERE e.id > ${cursor}
      AND (e.user_id IS NULL OR e.user_id = ${userId})
      AND (
        e.conversation_id IS NULL
        OR EXISTS (
          SELECT 1 FROM conversation_members m
          WHERE m.conversation_id = e.conversation_id AND m.user_id = ${userId}
        )
      )
    ORDER BY e.id
    LIMIT ${limit}
  `;
}

/** Текущая вершина журнала — стартовый курсор для нового соединения. */
export async function latestEventId(): Promise<number> {
  const rows = await sql<{ id: number | null }>`SELECT max(id) AS id FROM events`;
  return rows[0]?.id ?? 0;
}

