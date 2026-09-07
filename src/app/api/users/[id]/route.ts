import { json, HttpError, withUser } from '@/lib/http';
import { getUser } from '@/lib/queries';
import { parseId } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

/**
 * Карточка человека: то же, что видно в каталоге школы, — имя, логин, класс,
 * «о себе» и статус. Ничего сверх этого здесь нет: ни почты, ни телефона, ни
 * списка чатов, так что открыть чужой профиль безопасно.
 */
export const GET = withUser<Context>(async (_user, _request, { params }) => {
  const userId = parseId((await params).id, 'идентификатор пользователя');
  const person = await getUser(userId);
  if (!person) throw new HttpError(404, 'Человек не найден.');

  return json({ user: person });
});
