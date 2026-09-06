import { publish } from '@/lib/events';
import { json, readJson, requireMembership, withUser } from '@/lib/http';
import { markRead } from '@/lib/queries';
import { parseId } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

/** Отмечает диалог прочитанным до указанного сообщения. */
export const POST = withUser<Context>(async (user, request, { params }) => {
  const conversationId = parseId((await params).id, 'идентификатор диалога');
  await requireMembership(user.id, conversationId);

  const body = await readJson(request);
  const messageId = parseId(body.messageId, 'идентификатор сообщения');

  await markRead(user.id, conversationId, messageId);

  // Собеседник увидит вторую галочку.
  await publish({
    type: 'message.read',
    conversationId,
    payload: { actorId: user.id, userId: user.id, lastReadMessageId: messageId },
  });

  return json({ ok: true });
});
