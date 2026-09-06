import { config } from './config';
import { pool, sql, sqlOne } from './db';
import { publish } from './events';
import { HttpError } from './http';
import { getMessage, type Message } from './queries';

interface CreateMessageInput {
  conversationId: number;
  senderId: number | null;
  body: string;
  replyToId?: number | null;
  kind?: 'text' | 'system';
  attachmentIds?: number[];
}

/**
 * Записывает сообщение, поднимает диалог в списке и рассылает событие.
 *
 * Всё пишется одной транзакцией, чтобы не осталось сообщения без вложений или
 * диалога с неверным временем последней активности.
 */
export async function createMessage(input: CreateMessageInput): Promise<Message> {
  const kind = input.kind ?? 'text';
  const attachmentIds = input.attachmentIds ?? [];

  if (kind === 'text' && input.body.length === 0 && attachmentIds.length === 0) {
    throw new HttpError(400, 'Нельзя отправить пустое сообщение.');
  }
  if (attachmentIds.length > config.limits.attachmentsPerMessage) {
    throw new HttpError(400, `К сообщению можно приложить не больше ${config.limits.attachmentsPerMessage} файлов.`);
  }

  // Ответ возможен только на сообщение из этого же диалога.
  let replyToId: number | null = null;
  if (input.replyToId) {
    const parent = await sqlOne<{ id: number }>`
      SELECT id FROM messages WHERE id = ${input.replyToId} AND conversation_id = ${input.conversationId}
    `;
    if (!parent) throw new HttpError(400, 'Сообщение, на которое вы отвечаете, не найдено.');
    replyToId = parent.id;
  }

  // Прикладывать можно только собственные, ещё не использованные загрузки.
  if (attachmentIds.length > 0 && input.senderId != null) {
    const owned = await sql<{ id: number }>`
      SELECT f.id FROM files f
      WHERE f.id = ANY(${attachmentIds}::bigint[])
        AND f.owner_id = ${input.senderId}
        AND NOT EXISTS (SELECT 1 FROM message_attachments ma WHERE ma.file_id = f.id)
    `;
    if (owned.length !== attachmentIds.length) {
      throw new HttpError(400, 'Одно из вложений недоступно или уже прикреплено к другому сообщению.');
    }
  }

  const client = await pool().connect();
  let messageId: number;
  try {
    await client.query('BEGIN');

    const inserted = await client.query(
      `INSERT INTO messages (conversation_id, sender_id, body, reply_to_id, kind)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [input.conversationId, input.senderId, input.body, replyToId, kind],
    );
    messageId = Number(inserted.rows[0].id);

    if (attachmentIds.length > 0) {
      const values = attachmentIds.map((_, index) => `($1, $${index + 2}, ${index})`).join(', ');
      await client.query(
        `INSERT INTO message_attachments (message_id, file_id, position) VALUES ${values}`,
        [messageId, ...attachmentIds],
      );
    }

    await client.query(`UPDATE conversations SET last_message_at = now() WHERE id = $1`, [
      input.conversationId,
    ]);

    // Отправитель по определению прочитал собственное сообщение.
    if (input.senderId != null) {
      await client.query(
        `UPDATE conversation_members SET last_read_message_id = GREATEST(last_read_message_id, $1)
         WHERE conversation_id = $2 AND user_id = $3`,
        [messageId, input.conversationId, input.senderId],
      );
      await client.query(`DELETE FROM typing_state WHERE conversation_id = $1 AND user_id = $2`, [
        input.conversationId,
        input.senderId,
      ]);
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  const message = await getMessage(input.senderId ?? 0, messageId);
  if (!message) throw new HttpError(500, 'Сообщение сохранено, но его не удалось прочитать.');

  await publish({
    type: 'message.new',
    conversationId: input.conversationId,
    payload: { actorId: input.senderId, message },
  });

  return message;
}

/** Служебная запись в ленте: «Аня добавила Петю», «Группа переименована» и т. п. */
export async function postSystemMessage(conversationId: number, text: string): Promise<void> {
  await createMessage({ conversationId, senderId: null, body: text, kind: 'system' });
}
