import { publish } from '@/lib/events';
import { HttpError, json, readJson, withUser } from '@/lib/http';
import { postSystemMessage } from '@/lib/messaging';
import { getConversationSummary, joinByCode } from '@/lib/queries';
import { rateLimit } from '@/lib/ratelimit';
import { parseJoinCode } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Присоединение к группе по коду вида CFH6QK. */
export const POST = withUser(async (user, request) => {
  // Код короткий, поэтому его можно перебирать. Ограничиваем попытки.
  await rateLimit(`join:${user.id}`, {
    limit: 20,
    windowSeconds: 10 * 60,
    message: 'Слишком много попыток ввести код. Подождите немного.',
  });

  const body = await readJson(request);
  const code = parseJoinCode(body.code);

  const result = await joinByCode(user.id, code);
  const conversation = await getConversationSummary(user.id, result.conversationId);
  if (!conversation) throw new HttpError(500, 'Не удалось открыть группу.');

  // Повторный вход по тому же коду просто открывает группу — объявлять
  // о «новом участнике» второй раз не нужно.
  if (!result.alreadyMember) {
    await postSystemMessage(result.conversationId, `${user.display_name} присоединился(ась) по коду`);
    await publish({
      type: 'conversation.members',
      conversationId: result.conversationId,
      payload: { actorId: user.id, added: [user.id] },
    });
  }

  return json({ conversation, alreadyMember: result.alreadyMember });
});
