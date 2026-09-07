import { json, HttpError, withUser } from '@/lib/http';
import { blockUser, blockedBetween, getUser, unblockUser } from '@/lib/queries';
import { parseId } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

/**
 * Карточка человека: то же, что видно в каталоге школы, — имя, логин, класс,
 * «о себе» и статус. Ничего сверх этого здесь нет: ни почты, ни телефона, ни
 * списка чатов, так что открыть чужой профиль безопасно.
 *
 * Плюс одно личное: заблокирован ли он мной — от этого зависит кнопка в
 * карточке. Обратное (заблокировал ли он меня) наружу не отдаётся: знать это
 * незачем, а поводов для ссоры прибавилось бы.
 */
export const GET = withUser<Context>(async (user, _request, { params }) => {
  const userId = parseId((await params).id, 'идентификатор пользователя');
  const person = await getUser(userId);
  if (!person) throw new HttpError(404, 'Человек не найден.');

  const { iBlocked } = await blockedBetween(user.id, userId);

  return json({ user: person, blocked: iBlocked });
});

/** Заблокировать человека или снять блокировку. */
export const POST = withUser<Context>(async (user, request, { params }) => {
  const userId = parseId((await params).id, 'идентификатор пользователя');
  const url = new URL(request.url);
  const unblock = url.searchParams.get('action') === 'unblock';

  if (unblock) {
    await unblockUser(user.id, userId);
  } else {
    await blockUser(user.id, userId);
  }

  return json({ blocked: !unblock });
});
