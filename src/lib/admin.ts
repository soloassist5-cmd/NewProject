/**
 * Админ-панель гимназии: список аккаунтов, блокировка, смена пароля и
 * заведение учётных записей учителям.
 *
 * Что здесь важно помнить. Права администратора выдаются не отсюда: их
 * получает первый зарегистрировавшийся и тот, чьё имя указано в
 * ADMIN_USERNAME. Панель умеет заводить учеников и учителей, но не
 * администраторов — иначе одна забытая открытая вкладка превращалась бы в
 * полный доступ навсегда.
 */

import { hashPassword } from './auth';
import type { SessionUser } from './auth';
import { sql, sqlOne } from './db';
import { HttpError } from './http';

export interface AdminUser {
  id: number;
  username: string;
  displayName: string;
  grade: string;
  role: string;
  avatarColor: string;
  blocked: boolean;
  blockedAt: string | null;
  blockedReason: string;
  createdAt: string;
  lastSeenAt: string | null;
}

interface AdminUserRow {
  id: number;
  username: string;
  display_name: string;
  grade: string;
  role: string;
  avatar_color: string;
  blocked_at: Date | null;
  blocked_reason: string;
  created_at: Date;
  last_seen_at: Date | null;
}

function toIso(value: Date | string | null): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toAdminUser(row: AdminUserRow): AdminUser {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    grade: row.grade ?? '',
    role: row.role,
    avatarColor: row.avatar_color,
    blocked: row.blocked_at != null,
    blockedAt: toIso(row.blocked_at),
    blockedReason: row.blocked_reason ?? '',
    createdAt: toIso(row.created_at) ?? '',
    lastSeenAt: toIso(row.last_seen_at),
  };
}

/** Пропускает дальше только администратора. */
export function requireAdmin(user: SessionUser): void {
  if (user.role !== 'admin') {
    throw new HttpError(403, 'Раздел доступен только администратору гимназии.');
  }
}

/** Список аккаунтов с поиском по имени и логину. */
export async function listAccounts(search: string): Promise<AdminUser[]> {
  const trimmed = search.trim().toLowerCase();
  const pattern = `%${trimmed}%`;

  const rows = trimmed
    ? await sql<AdminUserRow>`
        SELECT id, username, display_name, grade, role, avatar_color,
               blocked_at, blocked_reason, created_at, last_seen_at
        FROM users
        WHERE lower(display_name) LIKE ${pattern} OR username LIKE ${pattern}
        ORDER BY blocked_at IS NOT NULL DESC, lower(display_name)
        LIMIT 100
      `
    : await sql<AdminUserRow>`
        SELECT id, username, display_name, grade, role, avatar_color,
               blocked_at, blocked_reason, created_at, last_seen_at
        FROM users
        ORDER BY blocked_at IS NOT NULL DESC, lower(display_name)
        LIMIT 100
      `;

  return rows.map(toAdminUser);
}

export async function getAccount(userId: number): Promise<AdminUser | null> {
  const row = await sqlOne<AdminUserRow>`
    SELECT id, username, display_name, grade, role, avatar_color,
           blocked_at, blocked_reason, created_at, last_seen_at
    FROM users WHERE id = ${userId}
  `;
  return row ? toAdminUser(row) : null;
}

/**
 * Аккаунт, который трогает администратор.
 *
 * Чужие администраторские записи панель не меняет: блокировки и смены пароля
 * между администраторами — это способ отобрать друг у друга доступ, а разбирать
 * такое должен человек, а не интерфейс. Свой пароль администратор меняет в
 * профиле, где спрашивают текущий.
 */
async function targetAccount(actor: SessionUser, userId: number): Promise<AdminUser> {
  const target = await getAccount(userId);
  if (!target) throw new HttpError(404, 'Аккаунт не найден.');

  if (target.id === actor.id) {
    throw new HttpError(400, 'Свой аккаунт через панель не меняют — это делается в профиле.');
  }
  if (target.role === 'admin') {
    throw new HttpError(403, 'Аккаунт другого администратора через панель не меняют.');
  }

  return target;
}

/** Закрывает вход и обрывает все сессии — вкладка, открытая сейчас, тоже умрёт. */
export async function blockAccount(
  actor: SessionUser,
  userId: number,
  reason: string,
): Promise<AdminUser> {
  const target = await targetAccount(actor, userId);

  await sql`
    UPDATE users
    SET blocked_at = now(), blocked_reason = ${reason.slice(0, 200)}
    WHERE id = ${target.id}
  `;
  await sql`DELETE FROM sessions WHERE user_id = ${target.id}`;

  return (await getAccount(target.id))!;
}

export async function unblockAccount(actor: SessionUser, userId: number): Promise<AdminUser> {
  const target = await targetAccount(actor, userId);

  await sql`
    UPDATE users SET blocked_at = NULL, blocked_reason = '' WHERE id = ${target.id}
  `;

  return (await getAccount(target.id))!;
}

/**
 * Ставит новый пароль вместо забытого.
 *
 * Текущий пароль не спрашивается — в том и смысл: человек его не помнит.
 * Поэтому все сессии этого аккаунта закрываются: если войти успел кто-то
 * чужой, новый пароль должен его выставить.
 */
export async function setAccountPassword(
  actor: SessionUser,
  userId: number,
  password: string,
): Promise<AdminUser> {
  const target = await targetAccount(actor, userId);

  await sql`
    UPDATE users SET password_hash = ${await hashPassword(password)} WHERE id = ${target.id}
  `;
  await sql`DELETE FROM sessions WHERE user_id = ${target.id}`;

  return (await getAccount(target.id))!;
}

/** Заводит аккаунт вручную: так в гимназии появляются учителя. */
export async function createAccount(input: {
  username: string;
  displayName: string;
  password: string;
  grade: string;
  role: 'member' | 'teacher';
  avatarColor: string;
}): Promise<AdminUser> {
  const taken = await sqlOne<{ id: number }>`
    SELECT id FROM users WHERE username = ${input.username}
  `;
  if (taken) throw new HttpError(409, 'Такое имя пользователя уже занято.');

  const created = await sqlOne<{ id: number }>`
    INSERT INTO users (username, display_name, grade, password_hash, avatar_color, role)
    VALUES (
      ${input.username}, ${input.displayName}, ${input.grade},
      ${await hashPassword(input.password)}, ${input.avatarColor}, ${input.role}
    )
    RETURNING id
  `;
  if (!created) throw new HttpError(500, 'Не удалось создать аккаунт.');

  return (await getAccount(created.id))!;
}
