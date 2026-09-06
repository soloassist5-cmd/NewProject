import { createSession, pruneExpiredSessions, verifyPassword } from '@/lib/auth';
import { config } from '@/lib/config';
import { sqlOne } from '@/lib/db';
import { handle, HttpError, json, readJson } from '@/lib/http';
import { clientIp, rateLimit } from '@/lib/ratelimit';
import { parseUsername } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = handle(async (request) => {
  const body = await readJson(request);
  const username = parseUsername(body.username);
  const password = typeof body.password === 'string' ? body.password : '';

  // Два лимита. Порог по адресу высокий — вся школа приходит с одного IP, и
  // «весь класс заходит на первом уроке» не должно выглядеть как атака. Реальная
  // защита от подбора пароля — второй лимит, он считается на конкретный аккаунт.
  await rateLimit(`login-ip:${clientIp(request)}`, {
    limit: config.rateLimits.loginsPerQuarterHourPerIp,
    windowSeconds: 15 * 60,
  });
  await rateLimit(`login-user:${username}`, {
    limit: config.rateLimits.loginsPerQuarterHourPerAccount,
    windowSeconds: 15 * 60,
    message: 'Слишком много попыток входа в этот аккаунт. Подождите 15 минут.',
  });

  const user = await sqlOne<{ id: number; username: string; display_name: string; password_hash: string; role: string }>`
    SELECT id, username, display_name, password_hash, role FROM users WHERE username = ${username}
  `;

  // Одинаковый ответ и для несуществующего имени, и для неверного пароля —
  // чтобы нельзя было перебором узнать, кто зарегистрирован.
  const ok = user ? await verifyPassword(password, user.password_hash) : false;
  if (!user || !ok) throw new HttpError(401, 'Неверное имя пользователя или пароль.');

  await createSession(user.id, request.headers.get('user-agent') ?? '');
  // Заодно подчищаем протухшие сессии — редкая и дешёвая операция.
  void pruneExpiredSessions().catch(() => {});

  return json({
    user: {
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      role: user.role,
    },
  });
});
