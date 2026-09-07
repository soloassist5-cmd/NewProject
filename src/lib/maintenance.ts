import { sql } from './db';

/**
 * Периодическая уборка служебных таблиц.
 *
 * Отдельного планировщика в проекте нет — уборка запускается изредка из
 * долгоживущего SSE-соединения. Запросы дешёвые и работают по индексам, так
 * что заметной нагрузки это не создаёт.
 */
export async function runMaintenance(): Promise<void> {
  await Promise.all([
    // Журнал событий нужен только «здесь и сейчас»: история переписки живёт
    // в messages, а events — лента уведомлений.
    //
    // Полчаса вместо двух часов: событие весит вчетверо больше самого
    // сообщения (внутри копия текста), а «печатает…» пишется каждые несколько
    // секунд у каждого, кто набирает текст. На бесплатной базе в полгигабайта
    // журнал за два часа перемены — это уже мегабайты, которых потом не хватит
    // переписке. Соединение живёт под минуту, так что отстать на полчаса может
    // только вкладка, которую свернули надолго, — она и так перечитывает всё
    // при возвращении.
    sql`DELETE FROM events WHERE created_at < now() - interval '30 minutes'`,

    // Просроченные сессии.
    sql`DELETE FROM sessions WHERE expires_at < now()`,

    // Счётчики попыток: окно давно закрылось, строка больше ни на что не влияет.
    sql`DELETE FROM rate_limits WHERE window_start < now() - interval '1 day'`,

    // Брошенные загрузки: файл выбрали, но сообщение так и не отправили.
    // Аватарки и вложения настоящих сообщений не трогаем.
    sql`
      DELETE FROM files f
      WHERE f.created_at < now() - interval '1 day'
        AND NOT EXISTS (SELECT 1 FROM message_attachments ma WHERE ma.file_id = f.id)
        AND NOT EXISTS (SELECT 1 FROM users u WHERE u.avatar_file_id = f.id)
    `,

    // Отметки «печатает…» живут секунды; всё, что старше, — мусор после обрывов.
    sql`DELETE FROM typing_state WHERE updated_at < now() - interval '5 minutes'`,
  ]);
}
