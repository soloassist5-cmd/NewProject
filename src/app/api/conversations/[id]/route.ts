import { sql, sqlOne } from '@/lib/db';
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

  // Картинка группы. Ставит её только создатель: аватар группы виден всем, и
  // менять общий значок каждому по очереди — верный способ устроить чехарду.
  if (body.avatarFileId !== undefined) {
    if (membership.kind !== 'group') throw new HttpError(400, 'У личного диалога нет картинки.');
    if (membership.role !== 'owner' && user.role !== 'admin') {
      throw new HttpError(403, 'Картинку группы меняет только её создатель.');
    }

    const fileId = body.avatarFileId === null ? null : parseId(body.avatarFileId, 'файл');

    if (fileId !== null) {
      const file = await sqlOne<{ mime: string }>`SELECT mime FROM files WHERE id = ${fileId}`;
      if (!file) throw new HttpError(404, 'Файл не найден.');
      if (!file.mime.startsWith('image/')) throw new HttpError(400, 'Картинкой может быть только изображение.');
    }

    await sql`UPDATE conversations SET avatar_file_id = ${fileId} WHERE id = ${conversationId}`;
    await postSystemMessage(
      conversationId,
      fileId === null
        ? `${user.display_name} убрал(а) картинку группы`
        : `${user.display_name} сменил(а) картинку группы`,
    );
    await publish({
      type: 'conversation.updated',
      conversationId,
      payload: { actorId: user.id, avatarFileId: fileId },
    });
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
