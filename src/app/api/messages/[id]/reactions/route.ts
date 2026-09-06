import { sql, sqlOne } from '@/lib/db';
import { publish } from '@/lib/events';
import { HttpError, json, readJson, requireMembership, withUser } from '@/lib/http';
import { getMessage } from '@/lib/queries';
import { parseEmoji, parseId } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

/** Ставит или снимает реакцию — повторное нажатие на ту же эмодзи убирает её. */
export const POST = withUser<Context>(async (user, request, { params }) => {
  const messageId = parseId((await params).id, 'идентификатор сообщения');
  const body = await readJson(request);
  const emoji = parseEmoji(body.emoji);

  const message = await sqlOne<{ conversation_id: number; deleted_at: Date | null }>`
    SELECT conversation_id, deleted_at FROM messages WHERE id = ${messageId}
  `;
  if (!message) throw new HttpError(404, 'Сообщение не найдено.');
  if (message.deleted_at) throw new HttpError(400, 'Нельзя реагировать на удалённое сообщение.');
  await requireMembership(user.id, message.conversation_id);

  const removed = await sql`
    DELETE FROM reactions
    WHERE message_id = ${messageId} AND user_id = ${user.id} AND emoji = ${emoji}
    RETURNING emoji
  `;

  if (removed.length === 0) {
    await sql`
      INSERT INTO reactions (message_id, user_id, emoji)
      VALUES (${messageId}, ${user.id}, ${emoji})
      ON CONFLICT DO NOTHING
    `;
  }

  const updated = await getMessage(user.id, messageId);
  await publish({
    type: 'reaction.changed',
    conversationId: message.conversation_id,
    payload: { actorId: user.id, messageId, reactions: updated?.reactions ?? [] },
  });

  return json({ reactions: updated?.reactions ?? [] });
});
