import { json, readJson, requireMembership, withUser } from '@/lib/http';
import { createMessage } from '@/lib/messaging';
import { listMessages } from '@/lib/queries';
import { parseId, parseIdList, parseMessageBody } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

/**
 * История диалога.
 *   ?before=<id> — страница вверх (листание к началу переписки)
 *   ?after=<id>  — всё новое после указанного сообщения (сверка после обрыва связи)
 */
export const GET = withUser<Context>(async (user, request, { params }) => {
  const conversationId = parseId((await params).id, 'идентификатор диалога');
  await requireMembership(user.id, conversationId);

  const url = new URL(request.url);
  const before = url.searchParams.get('before');
  const after = url.searchParams.get('after');

  const messages = await listMessages(user.id, conversationId, {
    before: before ? parseId(before, 'курсор') : undefined,
    after: after ? parseId(after, 'курсор') : undefined,
  });

  return json({ messages });
});

/** Отправка сообщения. */
export const POST = withUser<Context>(async (user, request, { params }) => {
  const conversationId = parseId((await params).id, 'идентификатор диалога');
  await requireMembership(user.id, conversationId);

  const body = await readJson(request);
  const text = parseMessageBody(body.body ?? '');
  const attachmentIds = body.attachmentIds ? parseIdList(body.attachmentIds, 'вложение') : [];

  const message = await createMessage({
    conversationId,
    senderId: user.id,
    body: text,
    replyToId: body.replyToId ? parseId(body.replyToId, 'идентификатор ответа') : null,
    attachmentIds,
  });

  return json({ message }, 201);
});
