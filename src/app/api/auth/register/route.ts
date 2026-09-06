import { createSession, hashPassword } from '@/lib/auth';
import { config } from '@/lib/config';
import { sql, sqlOne } from '@/lib/db';
import { handle, HttpError, json, readJson } from '@/lib/http';
import { clientIp, rateLimit } from '@/lib/ratelimit';
import {
  avatarColorFor,
  parseDisplayName,
  parseGrade,
  parsePassword,
  parseUsername,
} from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = handle(async (request) => {
  await rateLimit(`register:${clientIp(request)}`, {
    limit: config.rateLimits.registrationsPerHourPerIp,
    windowSeconds: 60 * 60,
    message: 'Слишком много регистраций с этого адреса. Попробуйте через час.',
  });

  const body = await readJson(request);
  const username = parseUsername(body.username);
  const password = parsePassword(body.password);
  const grade = parseGrade(body.grade);

  // Отображаемое имя при регистрации не спрашиваем — на входе только логин,
  // пароль и класс. Пока человек не заполнит имя в профиле, его показывают
  // по логину.
  const displayName =
    body.displayName === undefined || body.displayName === ''
      ? username
      : parseDisplayName(body.displayName);

  // В закрытом режиме нужен действующий код-приглашение.
  if (config.inviteOnly) {
    const code = typeof body.inviteCode === 'string' ? body.inviteCode.trim().toUpperCase() : '';
    if (!code) throw new HttpError(403, 'Регистрация только по приглашению. Попросите код у администратора.');

    const invite = await sqlOne<{ code: string }>`
      UPDATE invites
      SET uses = uses + 1
      WHERE code = ${code}
        AND uses < max_uses
        AND (expires_at IS NULL OR expires_at > now())
      RETURNING code
    `;
    if (!invite) throw new HttpError(403, 'Код приглашения недействителен или уже использован.');
  }

  const taken = await sqlOne<{ id: number }>`SELECT id FROM users WHERE username = ${username}`;
  if (taken) throw new HttpError(409, 'Такое имя пользователя уже занято.');

  // Первый зарегистрировавшийся становится администратором — иначе им некому стать.
  const existing = await sqlOne<{ count: number }>`SELECT count(*)::int AS count FROM users`;
  const isFirstUser = (existing?.count ?? 0) === 0;
  const role = isFirstUser || (config.adminUsername && config.adminUsername === username) ? 'admin' : 'member';

  const created = await sqlOne<{ id: number }>`
    INSERT INTO users (username, display_name, grade, password_hash, avatar_color, role)
    VALUES (
      ${username}, ${displayName}, ${grade},
      ${await hashPassword(password)}, ${avatarColorFor(username)}, ${role}
    )
    RETURNING id
  `;
  if (!created) throw new HttpError(500, 'Не удалось создать аккаунт.');

  await createSession(created.id, request.headers.get('user-agent') ?? '');

  return json({
    user: { id: created.id, username, displayName, grade, role },
  }, 201);
});
