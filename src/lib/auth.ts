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
  return 'gimroom-dev-secret-not-for-production';
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

/**
 * Создаёт сессию и ставит куку. Возвращает сырой токен (он больше нигде не хранится).
 *
 * `persistent` — «запомнить вход». По умолчанию да: человек заходит со своего
 * телефона и не должен вводить пароль каждый день. Если выбран чужой
 * компьютер, кука ставится без срока жизни — браузер удалит её при закрытии, —
 * и сама сессия живёт всего несколько часов.
 */
export async function createSession(
  userId: number,
  userAgent: string,
  persistent = true,
): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  const maxAge = persistent ? config.session.maxAgeSeconds : config.session.sharedMaxAgeSeconds;
  const expiresAt = new Date(Date.now() + maxAge * 1000);

  await sql`
    INSERT INTO sessions (token_hash, user_id, expires_at, user_agent, persistent)
    VALUES (
      ${tokenFingerprint(token)}, ${userId}, ${expiresAt.toISOString()},
      ${userAgent.slice(0, 300)}, ${persistent}
    )
  `;

  const store = await cookies();
  store.set(config.session.cookieName, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    // Без maxAge получается кука сеанса: браузер выбросит её, как только его
    // закроют. Ровно это и нужно на общем компьютере.
    ...(persistent ? { maxAge } : {}),
  });

  return token;
}

/**
 * Продлевает запомненный вход, если пора.
 *
 * Без этого сессия истекала бы ровно через месяц после входа, даже у того, кто
 * заходит каждый день, — и целый класс разом встретил бы форму входа. Здесь
 * срок отодвигается, пока человек пользуется мессенджером.
 *
 * Вызывается из обработчиков маршрутов: только там можно переставить куку.
 * Сессии «чужого компьютера» не продлеваются никогда — в этом их смысл.
 */
export async function renewSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(config.session.cookieName)?.value;
  if (!token) return;

  const fingerprint = tokenFingerprint(token);

  const row = await sqlOne<{ persistent: boolean; stale: boolean }>`
    SELECT persistent,
           last_used_at < now() - ${`${config.session.renewAfterSeconds} seconds`}::interval AS stale
    FROM sessions
    WHERE token_hash = ${fingerprint} AND expires_at > now()
  `;
  if (!row || !row.persistent || !row.stale) return;

  const expiresAt = new Date(Date.now() + config.session.maxAgeSeconds * 1000);
  await sql`
    UPDATE sessions
    SET expires_at = ${expiresAt.toISOString()}, last_used_at = now()
    WHERE token_hash = ${fingerprint}
  `;

  store.set(config.session.cookieName, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: config.session.maxAgeSeconds,
  });
}

/**
 * Читает текущего пользователя из куки. null — значит гость.
 *
 * Заблокированный аккаунт сюда не проходит. Сессии при блокировке и так
 * удаляются, но проверка стоит и здесь: если блокировка случится в ту же
 * секунду, что и запрос, открытая вкладка не должна доработать до конца дня.
 */
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
      AND u.blocked_at IS NULL
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

export interface DeviceSession {
  id: string;
  device: string;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  persistent: boolean;
  /** Та самая, из которой пришёл запрос. Её нельзя закрыть «за компанию». */
  current: boolean;
}

/**
 * Понятное название устройства из строки User-Agent.
 *
 * Показывать её целиком бессмысленно: это две строки технических подробностей,
 * по которым школьник всё равно не поймёт, его это телефон или чужой.
 */
function deviceName(userAgent: string): string {
  const ua = userAgent.toLowerCase();

  const system = ua.includes('android')
    ? 'Android'
    : /iphone|ipad|ipod/.test(ua)
      ? 'iPhone или iPad'
      : ua.includes('windows')
        ? 'Windows'
        : ua.includes('mac os')
          ? 'Mac'
          : ua.includes('linux')
            ? 'Linux'
            : 'Неизвестное устройство';

  // Порядок важен: Edge и Opera представляются ещё и Chrome, Chrome — Safari.
  const browser = ua.includes('edg/')
    ? 'Edge'
    : /opr\/|opera/.test(ua)
      ? 'Opera'
      : ua.includes('yabrowser')
        ? 'Яндекс.Браузер'
        : ua.includes('firefox')
          ? 'Firefox'
          : ua.includes('chrome')
            ? 'Chrome'
            : ua.includes('safari')
              ? 'Safari'
              : '';

  return browser ? `${system}, ${browser}` : system;
}

/** Устройства, на которых открыт аккаунт. */
export async function listSessions(userId: number): Promise<DeviceSession[]> {
  const store = await cookies();
  const token = store.get(config.session.cookieName)?.value;
  const currentFingerprint = token ? tokenFingerprint(token) : '';

  const rows = await sql<{
    token_hash: string;
    user_agent: string;
    created_at: Date;
    last_used_at: Date;
    expires_at: Date;
    persistent: boolean;
  }>`
    SELECT token_hash, user_agent, created_at, last_used_at, expires_at, persistent
    FROM sessions
    WHERE user_id = ${userId} AND expires_at > now()
    ORDER BY last_used_at DESC
    LIMIT 50
  `;

  return rows.map((row) => ({
    // Наружу уходит не сам отпечаток, а его начало: этого хватает, чтобы
    // отличить строки друг от друга, и мало, чтобы что-то подобрать.
    id: row.token_hash.slice(0, 16),
    device: deviceName(row.user_agent),
    createdAt: row.created_at.toISOString(),
    lastUsedAt: row.last_used_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
    persistent: row.persistent,
    current: row.token_hash === currentFingerprint,
  }));
}

/**
 * Закрывает все сессии, кроме текущей.
 *
 * Это кнопка «я забыл выйти на школьном компьютере»: чужая открытая вкладка
 * перестаёт работать сразу, а тот, кто нажал, остаётся в аккаунте.
 */
export async function destroyOtherSessions(userId: number): Promise<number> {
  const store = await cookies();
  const token = store.get(config.session.cookieName)?.value;
  const keep = token ? tokenFingerprint(token) : '';

  const removed = await sql<{ token_hash: string }>`
    DELETE FROM sessions
    WHERE user_id = ${userId} AND token_hash <> ${keep}
    RETURNING token_hash
  `;
  return removed.length;
}

/** Отмечает, что человек сейчас в сети. Вызывается из SSE-потока. */
export async function touchPresence(userId: number): Promise<void> {
  await sql`UPDATE users SET last_seen_at = now() WHERE id = ${userId}`;
}

/** Убирает просроченные сессии. Дёргается изредка, чтобы таблица не росла. */
export async function pruneExpiredSessions(): Promise<void> {
  await sql`DELETE FROM sessions WHERE expires_at < now()`;
}
