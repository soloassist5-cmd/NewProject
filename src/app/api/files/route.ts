import { config } from '@/lib/config';
import { sqlOne } from '@/lib/db';
import { HttpError, json, withUser } from '@/lib/http';
import { imageSize } from '@/lib/imagesize';
import { rateLimit } from '@/lib/ratelimit';
import { assertCanUpload, storageUsage } from '@/lib/storage';
import { isAllowedMime } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Загрузка вложения. Файл кладётся в Postgres и получает id, который потом
 * передаётся при отправке сообщения.
 */
/** Сколько места занято — для строки в профиле. */
export const GET = withUser(async (user) =>
  json({ storage: await storageUsage(user.id, user.role) }),
);

export const POST = withUser(async (user, request) => {
  await rateLimit(`upload:${user.id}`, {
    limit: 60,
    windowSeconds: 10 * 60,
    message: 'Слишком много загрузок подряд. Немного подождите.',
  });

  // Отсекаем заведомо слишком большое до чтения тела: иначе гигабайтная
  // «загрузка» сначала целиком окажется в памяти и только потом будет отвергнута.
  // Заголовку доверять нельзя, поэтому настоящий размер проверяется и ниже.
  const declaredSize = Number(request.headers.get('content-length') ?? 0);
  if (declaredSize > config.limits.fileSizeBytes * 1.2) {
    const megabytes = Math.round(config.limits.fileSizeBytes / (1024 * 1024));
    throw new HttpError(413, `Файл больше ${megabytes} МБ.`);
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) throw new HttpError(400, 'Файл не приложен.');

  if (file.size === 0) throw new HttpError(400, 'Файл пустой.');
  if (file.size > config.limits.fileSizeBytes) {
    const megabytes = Math.round(config.limits.fileSizeBytes / (1024 * 1024));
    throw new HttpError(413, `Файл больше ${megabytes} МБ.`);
  }

  const mime = file.type || 'application/octet-stream';
  if (!isAllowedMime(mime)) throw new HttpError(415, 'Такой тип файла загружать нельзя.');

  const buffer = Buffer.from(await file.arrayBuffer());
  // Доверять заявленному размеру нельзя — проверяем то, что реально пришло.
  if (buffer.length > config.limits.fileSizeBytes) throw new HttpError(413, 'Файл слишком большой.');

  // Место в базе не бесконечно, и кончается оно сразу у всех: см. lib/storage.
  await assertCanUpload(user.id, user.role, buffer.length);

  const dimensions = mime.startsWith('image/') ? imageSize(buffer, mime) : null;
  const name = (file.name || 'файл').slice(0, 200);

  const created = await sqlOne<{ id: number }>`
    INSERT INTO files (owner_id, name, mime, size, width, height, data)
    VALUES (
      ${user.id}, ${name}, ${mime}, ${buffer.length},
      ${dimensions?.width ?? null}, ${dimensions?.height ?? null}, ${buffer}
    )
    RETURNING id
  `;
  if (!created) throw new HttpError(500, 'Не удалось сохранить файл.');

  return json(
    {
      file: {
        id: created.id,
        name,
        mime,
        size: buffer.length,
        width: dimensions?.width ?? null,
        height: dimensions?.height ?? null,
      },
    },
    201,
  );
});
