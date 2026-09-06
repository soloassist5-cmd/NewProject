import { sqlOne } from './db';
import { HttpError } from './http';

/**
 * Счётчик попыток на скользящем окне, хранится в Postgres.
 *
 * На serverless память между запросами не переживает, поэтому лимиты держим в
 * базе — один UPSERT на попытку.
 */
export async function rateLimit(
  bucket: string,
  { limit, windowSeconds, message }: { limit: number; windowSeconds: number; message?: string },
): Promise<void> {
  const row = await sqlOne<{ hits: number }>`
    INSERT INTO rate_limits (bucket, hits, window_start)
    VALUES (${bucket}, 1, now())
    ON CONFLICT (bucket) DO UPDATE SET
      hits = CASE
        WHEN rate_limits.window_start < now() - make_interval(secs => ${windowSeconds})
        THEN 1 ELSE rate_limits.hits + 1 END,
      window_start = CASE
        WHEN rate_limits.window_start < now() - make_interval(secs => ${windowSeconds})
        THEN now() ELSE rate_limits.window_start END
    RETURNING hits
  `;

  if ((row?.hits ?? 0) > limit) {
    throw new HttpError(429, message ?? 'Слишком много попыток. Подождите немного и попробуйте снова.');
  }
}

/** Достаёт адрес клиента из заголовков прокси — для ключа лимита. */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return request.headers.get('x-real-ip') ?? 'unknown';
}
