import { currentUser } from '@/lib/auth';
import { sqlOne } from '@/lib/db';
import { fail, toResponse } from '@/lib/http';
import { parseId } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

interface FileRow {
  id: number;
  name: string;
  mime: string;
  size: number;
  data: Buffer;
}

/** Показывать в браузере безопасно только эти типы. Остальное отдаём файлом. */
const INLINE_PREFIXES = ['image/', 'video/', 'audio/'];
const INLINE_EXACT = ['application/pdf'];

function canRenderInline(mime: string): boolean {
  // SVG — это XML, из него исполняется скрипт, поэтому только скачиванием.
  if (mime === 'image/svg+xml') return false;
  return INLINE_PREFIXES.some((prefix) => mime.startsWith(prefix)) || INLINE_EXACT.includes(mime);
}

/** Отдаёт вложение или аватарку — только тем, кому она видна. */
export async function GET(request: Request, { params }: Context): Promise<Response> {
  try {
    const user = await currentUser();
    if (!user) return fail(401, 'Нужно войти в аккаунт.');

    const fileId = parseId((await params).id, 'идентификатор файла');

    // Файл виден, если это твоя загрузка, чья-то аватарка или вложение
    // в диалоге, где ты состоишь.
    const file = await sqlOne<FileRow>`
      SELECT f.id, f.name, f.mime, f.size, f.data
      FROM files f
      WHERE f.id = ${fileId}
        AND (
          f.owner_id = ${user.id}
          OR EXISTS (SELECT 1 FROM users u WHERE u.avatar_file_id = f.id)
          OR EXISTS (
            SELECT 1
            FROM message_attachments ma
            JOIN messages m ON m.id = ma.message_id
            JOIN conversation_members cm ON cm.conversation_id = m.conversation_id
            WHERE ma.file_id = f.id AND cm.user_id = ${user.id} AND m.deleted_at IS NULL
          )
        )
    `;

    if (!file) return fail(404, 'Файл не найден.');

    const inline = canRenderInline(file.mime);
    // Текст отдаём как text/plain: иначе загруженный HTML исполнился бы
    // на нашем домене и получил доступ к сессии.
    const contentType = file.mime.startsWith('text/') ? 'text/plain; charset=utf-8' : file.mime;
    const asciiName = file.name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '');
    const disposition = [
      inline ? 'inline' : 'attachment',
      `filename="${asciiName}"`,
      `filename*=UTF-8''${encodeURIComponent(file.name)}`,
    ].join('; ');

    return new Response(new Uint8Array(file.data), {
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(file.size),
        'Content-Disposition': disposition,
        'X-Content-Type-Options': 'nosniff',
        // Файл ничего не должен подгружать и никуда ходить сам.
        'Content-Security-Policy': "default-src 'none'; sandbox; frame-ancestors 'none'",
        // Содержимое по конкретному id неизменно, но приватно.
        'Cache-Control': 'private, max-age=31536000, immutable',
      },
    });
  } catch (error) {
    return toResponse(error);
  }
}
