import { sql } from '@/lib/db';
import { publish } from '@/lib/events';
import { HttpError, json, readJson, requireMembership, withUser } from '@/lib/http';
import { postSystemMessage } from '@/lib/messaging';
import { getConversationSummary, listMembers, readReceipts, typingUsers } from '@/lib/queries';
import { parseGroupTitle, parseId } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

/** Карточка диалога: заголовок, участники, статусы прочтения. */
export const GET = withUser<Context>(async (user, _request, { params }) => {
  const conversationId = parseId((await params).id, 'идентификатор диалога');
  await requireMembership(user.id, conversationId);

  const [conversation, members, receipts, typing] = await Promise.all([
    getConversationSummary(user.id, conversationId),
    listMembers(conversationId),
    readReceipts(conversationId, user.id),
    typingUsers(conversationId, user.id),
  ]);

  if (!conversation) throw new HttpError(404, 'Диалог не найден.');
  return json({ conversation, members, receipts, typing });
});

/** Переименование группы и переключение уведомлений. */
export const PATCH = withUser<Context>(async (user, request, { params }) => {
  const conversationId = parseId((await params).id, 'идентификатор диалога');
  const membership = await requireMembership(user.id, conversationId);
  const body = await readJson(request);

  // «Без звука» — личная настройка, её меняет каждый для себя.
  if (typeof body.muted === 'boolean') {
    await sql`
      UPDATE conversation_members SET muted = ${body.muted}
      WHERE conversation_id = ${conversationId} AND user_id = ${user.id}
    `;
  }

  if (body.title !== undefined) {
    if (membership.kind !== 'group') throw new HttpError(400, 'У личного диалога нет названия.');
    if (membership.role !== 'owner' && user.role !== 'admin') {
      throw new HttpError(403, 'Переименовать группу может только её создатель.');
    }

    const title = parseGroupTitle(body.title);
    await sql`UPDATE conversations SET title = ${title} WHERE id = ${conversationId}`;
    await postSystemMessage(conversationId, `${user.display_name} переименовал(а) группу в «${title}»`);
    await publish({
      type: 'conversation.updated',
      conversationId,
      payload: { actorId: user.id, title },
    });
  }

  return json({ conversation: await getConversationSummary(user.id, conversationId) });
});

/** Выход из группы. Личные диалоги не удаляются — история остаётся у обоих. */
export const DELETE = withUser<Context>(async (user, _request, { params }) => {
  const conversationId = parseId((await params).id, 'идентификатор диалога');
  const membership = await requireMembership(user.id, conversationId);

  if (membership.kind !== 'group') {
    throw new HttpError(400, 'Из личного диалога нельзя выйти — можно просто не писать.');
  }

  await sql`
    DELETE FROM conversation_members
    WHERE conversation_id = ${conversationId} AND user_id = ${user.id}
  `;
  await postSystemMessage(conversationId, `${user.display_name} вышел(ла) из группы`);
  await publish({
    type: 'conversation.members',
    conversationId,
    payload: { actorId: user.id, removed: user.id },
  });

  return json({ ok: true });
});
