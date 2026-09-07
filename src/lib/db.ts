import { Pool, types } from 'pg';

// BIGINT (oid 20) драйвер по умолчанию отдаёт строкой, чтобы не потерять точность.
// Идентификаторы у нас далеко от 2^53, поэтому читаем их числами — так удобнее и
// на сервере, и в JSON для клиента.
types.setTypeParser(20, (value) => Number.parseInt(value, 10));
// NUMERIC (1700) в агрегатах вроде count(*) — тоже числом.
types.setTypeParser(1700, (value) => Number.parseFloat(value));

declare global {
  // eslint-disable-next-line no-var
  var __gimroomPool: Pool | undefined;
}

/**
 * Имена переменных, под которыми может лежать адрес базы.
 *
 * Интеграции называют её по-разному: Neon через Vercel кладёт `DATABASE_URL`,
 * Vercel Postgres — `POSTGRES_URL`, Supabase иногда `POSTGRES_PRISMA_URL`.
 * Требовать одно конкретное имя — верный способ получить пустой белый экран
 * после подключения базы «по кнопке», поэтому берём первое, что нашлось.
 * Адреса без пула (`*_UNPOOLED`, `*_NON_POOLING`) идут последними: они рабочие,
 * но на serverless быстро упираются в лимит соединений.
 */
const CONNECTION_VARIABLES = [
  'DATABASE_URL',
  'POSTGRES_URL',
  'POSTGRES_PRISMA_URL',
  'DATABASE_POSTGRES_URL',
  'DATABASE_URL_UNPOOLED',
  'POSTGRES_URL_NON_POOLING',
];

/** Ошибка настройки: приложение развёрнуто, но не сказано, куда подключаться. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export function connectionString(): string {
  for (const name of CONNECTION_VARIABLES) {
    const value = process.env[name];
    if (value && value.trim()) return value.trim();
  }
  throw new ConfigError(
    'Не задан адрес базы данных. Добавьте в настройках проекта переменную ' +
      'DATABASE_URL со строкой подключения и пересоберите приложение.',
  );
}

function createPool(): Pool {
  const connection = connectionString();

  // Локальный Postgres обычно без TLS, облачный (Neon и подобные) — с ним.
  const isLocal = /@(localhost|127\.0\.0\.1)/.test(connection);

  return new Pool({
    connectionString: connection,
    ssl: isLocal ? undefined : { rejectUnauthorized: false },
    // На serverless каждый инстанс держит свой пул, поэтому он маленький.
    max: Number(process.env.DB_POOL_MAX ?? 5),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
}

export function pool(): Pool {
  if (!global.__gimroomPool) {
    global.__gimroomPool = createPool();
    // Пул не должен ронять процесс из-за оборванного простаивающего соединения.
    global.__gimroomPool.on('error', (error) => {
      console.error('Ошибка простаивающего соединения с БД:', error.message);
    });
  }
  return global.__gimroomPool;
}

/**
 * Тегированный шаблон для параметризованных запросов:
 *
 *   const rows = await sql<User>`SELECT * FROM users WHERE id = ${id}`;
 *
 * Значения всегда уходят отдельными параметрами, так что склеить SQL-инъекцию
 * через подстановку невозможно.
 */
export async function sql<T = Record<string, unknown>>(
  strings: TemplateStringsArray,
  ...values: unknown[]
): Promise<T[]> {
  let text = strings[0];
  for (let i = 0; i < values.length; i++) {
    text += `$${i + 1}${strings[i + 1]}`;
  }
  const result = await pool().query(text, values);
  return result.rows as T[];
}

/** То же самое, но возвращает первую строку или null. */
export async function sqlOne<T = Record<string, unknown>>(
  strings: TemplateStringsArray,
  ...values: unknown[]
): Promise<T | null> {
  const rows = await sql<T>(strings, ...values);
  return rows[0] ?? null;
}

/** Выполняет несколько запросов в одной транзакции на одном соединении. */
export async function transaction<T>(
  run: (query: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>) => Promise<T>,
): Promise<T> {
  const client = await pool().connect();
  try {
    await client.query('BEGIN');
    const result = await run(async (text, params) => {
      const res = await client.query(text, params);
      return res.rows;
    });
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
