import { sql, sqlOne } from '@/lib/db';
import { publish } from '@/lib/events';
import { HttpError, json, readJson, requireMembership, withUser } from '@/lib/http';
import { getMessage } from '@/lib/queries';
import { parseId, parseMessageBody } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

interface MessageOwnerRow {
  id: number;
  conversation_id: number;
  sender_id: number | null;
  kind: string;
  deleted_at: Date | null;
}

async function loadMessage(messageId: number): Promise<MessageOwnerRow> {
  const row = await sqlOne<MessageOwnerRow>`
    SELECT id, conversation_id, sender_id, kind, deleted_at FROM messages WHERE id = ${messageId}
  `;
  if (!row) throw new HttpError(404, 'Сообщение не найдено.');
  return row;
}

/** Правка своего сообщения. */
export const PATCH = withUser<Context>(async (user, request, { params }) => {
  const messageId = parseId((await params).id, 'идентификатор сообщения');
  const message = await loadMessage(messageId);
  await requireMembership(user.id, message.conversation_id);

  if (message.sender_id !== user.id) throw new HttpError(403, 'Редактировать можно только свои сообщения.');
  if (message.deleted_at) throw new HttpError(400, 'Это сообщение удалено.');
  if (message.kind !== 'text') throw new HttpError(400, 'Служебные сообщения не редактируются.');

  const body = await readJson(request);
  const text = parseMessageBody(body.body);
  if (text.length === 0) throw new HttpError(400, 'Пустой текст: если сообщение не нужно — удалите его.');

  await sql`UPDATE messages SET body = ${text}, edited_at = now() WHERE id = ${messageId}`;

  const updated = await getMessage(user.id, messageId);
  await publish({
    type: 'message.edited',
    conversationId: message.conversation_id,
    payload: { actorId: user.id, message: updated },
  });

  return json({ message: updated });
});

/**
 * Удаление. Ставим пометку вместо физического удаления: так остаются целыми
 * ответы на это сообщение и нумерация истории.
 */
export const DELETE = withUser<Context>(async (user, _request, { params }) => {
  const messageId = parseId((await params).id, 'идентификатор сообщения');
  const message = await loadMessage(messageId);
  const membership = await requireMembership(user.id, message.conversation_id);

  // Своё сообщение — всегда; чужое — создатель группы или администратор школы.
  const canDelete =
    message.sender_id === user.id || user.role === 'admin' || membership.role === 'owner';
  if (!canDelete) throw new HttpError(403, 'Удалить это сообщение может только его автор.');

  if (!message.deleted_at) {
    await sql`UPDATE messages SET deleted_at = now(), body = '' WHERE id = ${messageId}`;
    await sql`DELETE FROM reactions WHERE message_id = ${messageId}`;
  }

  await publish({
    type: 'message.deleted',
    conversationId: message.conversation_id,
    payload: { actorId: user.id, messageId },
  });

  return json({ ok: true });
});
