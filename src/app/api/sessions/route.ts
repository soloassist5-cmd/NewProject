import { destroyOtherSessions, listSessions } from '@/lib/auth';
import { json, withUser } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Устройства, на которых сейчас открыт мой аккаунт. */
export const GET = withUser(async (user) => {
  return json({ sessions: await listSessions(user.id) });
});

/**
 * Закрывает вход на всех устройствах, кроме этого.
 *
 * Нужна ровно для одного случая: человек вспомнил, что не вышел из аккаунта на
 * школьном компьютере. Чужая вкладка перестаёт работать сразу — сессия удалена,
 * а не помечена.
 */
export const DELETE = withUser(async (user) => {
  const closed = await destroyOtherSessions(user.id);
  return json({ closed, sessions: await listSessions(user.id) });
});
