import { publish } from '@/lib/events';
import { HttpError, json, readJson, withUser } from '@/lib/http';
import { createGroup, ensureDm, getConversationSummary, listConversations } from '@/lib/queries';
import { parseGroupTitle, parseId, parseIdList } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Список диалогов для боковой панели. */
export const GET = withUser(async (user) => {
  return json({ conversations: await listConversations(user.id) });
});

/** Создаёт личный диалог или группу. */
export const POST = withUser(async (user, request) => {
  const body = await readJson(request);
  const kind = body.kind === 'group' ? 'group' : 'dm';

  if (kind === 'dm') {
    const otherId = parseId(body.userId, 'идентификатор собеседника');
    const conversationId = await ensureDm(user.id, otherId);
    const conversation = await getConversationSummary(user.id, conversationId);

    // Собеседнику показываем новый диалог сразу, без перезагрузки страницы.
    await publish({
      type: 'conversation.created',
      conversationId,
      payload: { actorId: user.id },
    });

    return json({ conversation }, 201);
  }

  const title = parseGroupTitle(body.title);
  // Группу можно создать и пустой: остальные войдут по коду приглашения.
  const memberIds = parseIdList(body.memberIds ?? [], 'идентификатор участника');

  const conversationId = await createGroup(user.id, title, memberIds);
  const conversation = await getConversationSummary(user.id, conversationId);
  if (!conversation) throw new HttpError(500, 'Группа создана, но её не удалось прочитать.');

  await publish({
    type: 'conversation.created',
    conversationId,
    payload: { actorId: user.id, title },
  });

  return json({ conversation }, 201);
});
