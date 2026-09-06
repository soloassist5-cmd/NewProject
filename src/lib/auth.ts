import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { cookies } from 'next/headers';
import { config } from './config';
import { ConfigError, sql, sqlOne } from './db';

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

// Параметры scrypt. N=2^15 — заметная работа для перебора и всё ещё быстрый вход.
const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 96 * 1024 * 1024 };
const KEY_LENGTH = 64;

export interface SessionUser {
  id: number;
  username: string;
  display_name: string;
  grade: string;
  avatar_color: string;
  avatar_file_id: number | null;
  bio: string;
  role: string;
}

function authSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (secret && secret.length >= 16) return secret;
  if (process.env.NODE_ENV === 'production') {
    throw new ConfigError(
      'Не задана переменная AUTH_SECRET — без неё нельзя безопасно выдавать сессии. ' +
        'Добавьте её в настройках проекта (случайная строка от 32 символов) и пересоберите приложение.',
    );
  }
  // В разработке разрешаем работать без секрета, но предупреждаем.
  return 'peremena-dev-secret-not-for-production';
}

/** Хеширует пароль. Формат строки: scrypt$N$r$p$соль$хеш (обе части в base64). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, SCRYPT);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');
}

/** Сверяет пароль с хешем. Сравнение — постоянного времени. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const [, n, r, p, saltB64, hashB64] = parts;
  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(hashB64, 'base64');

  let actual: Buffer;
  try {
    actual = await scrypt(password.normalize('NFKC'), salt, expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: SCRYPT.maxmem,
    });
  } catch {
    return false;
  }

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * Хеш от случайной строки — им сверяются, когда такого логина нет.
 *
 * Без этого проверка пароля пропускалась бы для несуществующего аккаунта, и
 * ответ приходил бы в двадцать раз быстрее. По одному времени ответа можно
 * перебрать, кто зарегистрирован в гимназии, даже не имея своего аккаунта, —
 * поэтому работа выполняется одинаковая в обоих случаях.
 *
 * Считается один раз при первом входе и дальше берётся из кеша.
 */
let dummyHashPromise: Promise<string> | null = null;

export function dummyPasswordHash(): Promise<string> {
  if (!dummyHashPromise) {
    dummyHashPromise = hashPassword(randomBytes(32).toString('hex'));
  }
  return dummyHashPromise;
}

/** В базе лежит не сам токен, а HMAC от него: утечка таблицы не даёт готовых кук. */
function tokenFingerprint(token: string): string {
  return createHmac('sha256', authSecret()).update(token).digest('hex');
}

/** Создаёт сессию и ставит куку. Возвращает сырой токен (он больше нигде не хранится). */
export async function createSession(userId: number, userAgent: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + config.session.maxAgeSeconds * 1000);

  await sql`
    INSERT INTO sessions (token_hash, user_id, expires_at, user_agent)
    VALUES (${tokenFingerprint(token)}, ${userId}, ${expiresAt.toISOString()}, ${userAgent.slice(0, 300)})
  `;

  const store = await cookies();
  store.set(config.session.cookieName, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: config.session.maxAgeSeconds,
  });

  return token;
}

/** Читает текущего пользователя из куки. null — значит гость. */
export async function currentUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(config.session.cookieName)?.value;
  if (!token) return null;

  const user = await sqlOne<SessionUser>`
    SELECT u.id, u.username, u.display_name, u.grade, u.avatar_color, u.avatar_file_id, u.bio, u.role
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ${tokenFingerprint(token)}
      AND s.expires_at > now()
  `;

  return user;
}

/** Завершает текущую сессию и стирает куку. */
export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(config.session.cookieName)?.value;
  if (token) {
    await sql`DELETE FROM sessions WHERE token_hash = ${tokenFingerprint(token)}`;
  }
  store.delete(config.session.cookieName);
}

/** Отмечает, что человек сейчас в сети. Вызывается из SSE-потока. */
export async function touchPresence(userId: number): Promise<void> {
  await sql`UPDATE users SET last_seen_at = now() WHERE id = ${userId}`;
}

/** Убирает просроченные сессии. Дёргается изредка, чтобы таблица не росла. */
export async function pruneExpiredSessions(): Promise<void> {
  await sql`DELETE FROM sessions WHERE expires_at < now()`;
}
