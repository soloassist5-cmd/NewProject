import { createSession, hashPassword, verifyPassword } from '@/lib/auth';
import { config } from '@/lib/config';
import { sql, sqlOne } from '@/lib/db';
import { publish } from '@/lib/events';
import { HttpError, json, readJson, withUser } from '@/lib/http';
import { changeUsername, getUser } from '@/lib/queries';
import { rateLimit } from '@/lib/ratelimit';
import {
  parseBio,
  parseDisplayName,
  parseGrade,
  parseId,
  parsePassword,
  parseStudentGrade,
  parseUsername,
} from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Правка своего профиля: имя, описание, цвет и картинка аватара, пароль. */
export const PATCH = withUser(async (user, request) => {
  const body = await readJson(request);

  if (body.displayName !== undefined) {
    const displayName = parseDisplayName(body.displayName);
    await sql`UPDATE users SET display_name = ${displayName} WHERE id = ${user.id}`;
  }

  if (body.bio !== undefined) {
    await sql`UPDATE users SET bio = ${parseBio(body.bio)} WHERE id = ${user.id}`;
  }

  if (body.username !== undefined) {
    // Перебирать свободные логины через смену своего — дешёвый способ узнать,
    // кто зарегистрирован в гимназии. Поэтому попытки ограничены.
    await rateLimit(`username-change:${user.id}`, {
      limit: 10,
      windowSeconds: 60 * 60,
      message: 'Слишком много попыток сменить логин. Попробуйте через час.',
    });
    await changeUsername(user.id, parseUsername(body.username));
  }

  if (body.avatarColor !== undefined) {
    const color = String(body.avatarColor);
    if (!(config.avatarColors as readonly string[]).includes(color)) {
      throw new HttpError(400, 'Неизвестный цвет аватара.');
    }
    await sql`UPDATE users SET avatar_color = ${color} WHERE id = ${user.id}`;
  }

  if (body.grade !== undefined) {
    // Ученик класс меняет, но не стирает: «без класса» — признак аккаунта,
    // который завёл администратор. Сотрудникам менять тут нечего.
    const grade = user.role === 'member' ? parseStudentGrade(body.grade) : parseGrade(body.grade);
    await sql`UPDATE users SET grade = ${grade} WHERE id = ${user.id}`;
  }

  if (body.avatarFileId !== undefined) {
    // Аватарка у человека одна: прежнюю картинку удаляем сразу, а не оставляем
    // висеть в базе до ночной уборки.
    const previousId = user.avatar_file_id;

    if (body.avatarFileId === null) {
      await sql`UPDATE users SET avatar_file_id = NULL WHERE id = ${user.id}`;
    } else {
      const fileId = parseId(body.avatarFileId, 'идентификатор файла');
      const file = await sqlOne<{ id: number; mime: string }>`
        SELECT id, mime FROM files WHERE id = ${fileId} AND owner_id = ${user.id}
      `;
      if (!file) throw new HttpError(404, 'Картинка не найдена.');
      if (!file.mime.startsWith('image/')) throw new HttpError(400, 'Аватар должен быть картинкой.');
      await sql`UPDATE users SET avatar_file_id = ${fileId} WHERE id = ${user.id}`;
    }

    if (previousId && previousId !== Number(body.avatarFileId)) {
      // Ту же картинку могли приложить к сообщению — тогда она не только аватарка
      // и удалять её нельзя.
      await sql`
        DELETE FROM files f
        WHERE f.id = ${previousId}
          AND f.owner_id = ${user.id}
          AND NOT EXISTS (SELECT 1 FROM message_attachments ma WHERE ma.file_id = f.id)
      `;
    }
  }

  // Смена пароля требует подтверждения текущим — на случай чужого открытого окна.
  if (body.newPassword !== undefined) {
    // Именно этот случай и надо ограничивать: добравшись до незапертого
    // ноутбука, текущий пароль можно перебирать, чтобы сменить его и забрать
    // аккаунт себе насовсем. Хозяин потом даже не войдёт.
    await rateLimit(`password-change:${user.id}`, {
      limit: 5,
      windowSeconds: 15 * 60,
      message: 'Слишком много попыток сменить пароль. Подождите 15 минут.',
    });

    const newPassword = parsePassword(body.newPassword);
    const stored = await sqlOne<{ password_hash: string }>`
      SELECT password_hash FROM users WHERE id = ${user.id}
    `;
    const currentOk =
      typeof body.currentPassword === 'string' &&
      stored != null &&
      (await verifyPassword(body.currentPassword, stored.password_hash));
    if (!currentOk) throw new HttpError(403, 'Текущий пароль указан неверно.');

    await sql`UPDATE users SET password_hash = ${await hashPassword(newPassword)} WHERE id = ${user.id}`;
    // Смена пароля должна отсекать чужие устройства, поэтому гасим все сессии
    // и тут же выдаём новую тому, кто сейчас в окне — иначе выкинуло бы и его.
    await sql`DELETE FROM sessions WHERE user_id = ${user.id}`;
    await createSession(user.id, request.headers.get('user-agent') ?? '');
  }

  const updated = await getUser(user.id);

  // Обновлённое имя и аватар должны разъехаться по чужим спискам чатов.
  await publish({ type: 'presence', payload: { actorId: user.id, user: updated } });

  return json({ user: updated });
});
