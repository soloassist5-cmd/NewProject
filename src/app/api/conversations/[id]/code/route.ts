import { publish } from '@/lib/events';
import { HttpError, json, requireMembership, withUser } from '@/lib/http';
import { getJoinCode, regenerateJoinCode } from '@/lib/queries';
import { parseId } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

/** Код группы. Видят только те, кто в ней состоит. */
export const GET = withUser<Context>(async (user, _request, { params }) => {
  const conversationId = parseId((await params).id, 'идентификатор диалога');
  const membership = await requireMembership(user.id, conversationId);
  if (membership.kind !== 'group') throw new HttpError(400, 'У личного диалога кода нет.');

  return json({ code: await getJoinCode(conversationId) });
});

/**
 * Выдаёт группе новый код. Нужно, когда старый разошёлся дальше, чем
 * задумывалось: после смены по нему уже не войти.
 */
export const POST = withUser<Context>(async (user, _request, { params }) => {
  const conversationId = parseId((await params).id, 'идентификатор диалога');
  const membership = await requireMembership(user.id, conversationId);

  if (membership.kind !== 'group') throw new HttpError(400, 'У личного диалога кода нет.');
  if (membership.role !== 'owner' && user.role !== 'admin') {
    throw new HttpError(403, 'Сменить код может только создатель группы.');
  }

  const code = await regenerateJoinCode(conversationId);

  await publish({
    type: 'conversation.updated',
    conversationId,
    payload: { actorId: user.id, codeChanged: true },
  });

  return json({ code });
});
