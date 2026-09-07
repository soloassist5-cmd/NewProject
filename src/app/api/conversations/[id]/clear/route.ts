import { json, requireMembership, withUser } from '@/lib/http';
import { clearConversation, getConversationSummary } from '@/lib/queries';
import { parseId } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

/**
 * Очистка переписки — только у себя.
 *
 * Чужие слова остаются на месте: собеседник вправе видеть свой разговор
 * целиком, и одна кнопка не должна стирать его память. Здесь ставится граница,
 * после которой история для нажавшего начинается заново.
 */
export const POST = withUser<Context>(async (user, _request, { params }) => {
  const conversationId = parseId((await params).id, 'идентификатор диалога');
  await requireMembership(user.id, conversationId);

  await clearConversation(user.id, conversationId);

  return json({ conversation: await getConversationSummary(user.id, conversationId) });
});
