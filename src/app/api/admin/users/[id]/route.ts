import {
  blockAccount,
  requireAdmin,
  setAccountPassword,
  unblockAccount,
} from '@/lib/admin';
import { HttpError, json, readJson, withUser } from '@/lib/http';
import { parseBio, parseId, parsePassword } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

/**
 * Меняет чужой аккаунт: блокирует, разблокирует, ставит новый пароль.
 *
 * Обе операции гасят сессии этого человека, поэтому в одном запросе их можно
 * прислать вместе: «заблокировать и сменить пароль» — обычный порядок действий,
 * когда аккаунт увели.
 */
export const PATCH = withUser<Context>(async (user, request, { params }) => {
  requireAdmin(user);

  const userId = parseId((await params).id, 'идентификатор аккаунта');
  const body = await readJson(request);

  if (body.blocked === undefined && body.password === undefined) {
    throw new HttpError(400, 'Нечего менять: укажите блокировку или новый пароль.');
  }

  let updated = null;

  if (body.blocked !== undefined) {
    if (typeof body.blocked !== 'boolean') {
      throw new HttpError(400, 'Поле blocked должно быть true или false.');
    }
    // Причину показываем самому человеку при попытке войти, поэтому длину
    // ограничиваем так же, как «о себе».
    updated = body.blocked
      ? await blockAccount(user, userId, parseBio(body.reason))
      : await unblockAccount(user, userId);
  }

  if (body.password !== undefined) {
    updated = await setAccountPassword(user, userId, parsePassword(body.password));
  }

  return json({ user: updated });
});
