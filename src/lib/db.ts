import { Pool, types } from 'pg';

// BIGINT (oid 20) драйвер по умолчанию отдаёт строкой, чтобы не потерять точность.
// Идентификаторы у нас далеко от 2^53, поэтому читаем их числами — так удобнее и
// на сервере, и в JSON для клиента.
types.setTypeParser(20, (value) => Number.parseInt(value, 10));
// NUMERIC (1700) в агрегатах вроде count(*) — тоже числом.
types.setTypeParser(1700, (value) => Number.parseFloat(value));

declare global {
  // eslint-disable-next-line no-var
  var __peremenaPool: Pool | undefined;
}

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      'Не задана переменная окружения DATABASE_URL. Скопируйте .env.example в .env.local и укажите адрес базы.',
    );
  }

  // Локальный Postgres обычно без TLS, облачный (Neon и подобные) — с ним.
  const isLocal = /@(localhost|127\.0\.0\.1)/.test(connectionString);

  return new Pool({
    connectionString,
    ssl: isLocal ? undefined : { rejectUnauthorized: false },
    // На serverless каждый инстанс держит свой пул, поэтому он маленький.
    max: Number(process.env.DB_POOL_MAX ?? 5),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
}

export function pool(): Pool {
  if (!global.__peremenaPool) {
    global.__peremenaPool = createPool();
    // Пул не должен ронять процесс из-за оборванного простаивающего соединения.
    global.__peremenaPool.on('error', (error) => {
      console.error('Ошибка простаивающего соединения с БД:', error.message);
    });
  }
  return global.__peremenaPool;
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
