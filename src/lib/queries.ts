import { randomInt } from 'node:crypto';
import { config } from './config';
import { pool, sql, sqlOne, transaction } from './db';
import { HttpError } from './http';

/** Публичная карточка человека — то, что видят остальные. */
export interface PublicUser {
  id: number;
  username: string;
  displayName: string;
  /** Класс вида «9О». У сотрудников гимназии пусто. */
  grade: string;
  /** Аккаунт учителя: класса нет, вместо него рядом с именем стоит должность. */
  isTeacher: boolean;
  avatarColor: string;
  avatarFileId: number | null;
  bio: string;
  online: boolean;
  lastSeenAt: string | null;
}

export interface Attachment {
  id: number;
  name: string;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
}

export interface ReactionSummary {
  emoji: string;
  count: number;
  /** Посчитано для того, кто запрашивал. В событиях ленты полагаться нельзя — там свой получатель. */
  mine: boolean;
  users: string[];
  /** Кто поставил: по нему каждый клиент сам определяет, своя ли это реакция. */
  userIds: number[];
}

export interface Message {
  id: number;
  conversationId: number;
  senderId: number | null;
  senderName: string | null;
  senderUsername: string | null;
  senderColor: string | null;
  senderAvatarFileId: number | null;
  body: string;
  kind: string;
  createdAt: string;
  editedAt: string | null;
  deleted: boolean;
  replyTo: { id: number; senderName: string | null; body: string; deleted: boolean } | null;
  attachments: Attachment[];
  reactions: ReactionSummary[];
}

export interface ConversationSummary {
  id: number;
  kind: 'dm' | 'group';
  title: string;
  avatarColor: string;
  avatarFileId: number | null;
  memberCount: number;
  muted: boolean;
  unread: number;
  lastReadMessageId: number;
  partner: PublicUser | null;
  lastMessage: {
    id: number;
    body: string;
    kind: string;
    createdAt: string;
    senderId: number | null;
    senderName: string | null;
    deleted: boolean;
    hasAttachments: boolean;
  } | null;
}

const ONLINE_WINDOW = config.presence.onlineWindowSeconds;

function isOnline(lastSeenAt: Date | string | null): boolean {
  if (!lastSeenAt) return false;
  const seen = new Date(lastSeenAt).getTime();
  return Date.now() - seen < ONLINE_WINDOW * 1000;
}

function toIso(value: Date | string | null): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

// ─────────────────────────────── Люди ───────────────────────────────

interface UserRow {
  id: number;
  username: string;
  display_name: string;
  grade: string;
  /** Роль в гимназии: member | teacher | admin. Не путать с ролью в группе. */
  role: string;
  avatar_color: string;
  avatar_file_id: number | null;
  bio: string;
  last_seen_at: Date;
}

function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    grade: row.grade ?? '',
    isTeacher: row.role === 'teacher',
    avatarColor: row.avatar_color,
    avatarFileId: row.avatar_file_id,
    bio: row.bio,
    online: isOnline(row.last_seen_at),
    lastSeenAt: toIso(row.last_seen_at),
  };
}

/**
 * Каталог школы: все зарегистрированные, с поиском по имени и логину.
 *
 * Ищем по обоим полям сразу — человека помнят то по имени («Иванов»), то по
 * логину («ivanov_i»). Ведущая «собачка» срезается: «@ivanov» и «ivanov» —
 * один и тот же запрос.
 *
 * Порядок выдачи важнее, чем кажется: сначала точное совпадение логина, потом
 * начало имени или логина, и только потом совпадение в середине. Иначе при
 * вводе «ivan» первым окажется «Марина Иванова», а не «ivan».
 */
export async function listPeople(viewerId: number, search: string): Promise<PublicUser[]> {
  const trimmed = search.trim().toLowerCase().replace(/^@+/, '');
  if (!trimmed) {
    const rows = await sql<UserRow>`
      SELECT id, username, display_name, grade, role, avatar_color, avatar_file_id, bio, last_seen_at
      FROM users
      WHERE id <> ${viewerId}
        AND blocked_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM blocks b
          WHERE (b.blocker_id = ${viewerId} AND b.blocked_id = users.id)
             OR (b.blocker_id = users.id AND b.blocked_id = ${viewerId})
        )
      ORDER BY last_seen_at DESC
      LIMIT 50
    `;
    return rows.map(toPublicUser);
  }

  const rows = await sql<UserRow>`
    SELECT id, username, display_name, grade, role, avatar_color, avatar_file_id, bio, last_seen_at
    FROM users
    WHERE id <> ${viewerId}
      AND blocked_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM blocks b
        WHERE (b.blocker_id = ${viewerId} AND b.blocked_id = users.id)
           OR (b.blocker_id = users.id AND b.blocked_id = ${viewerId})
      )
      AND (lower(display_name) LIKE ${`%${trimmed}%`} OR username LIKE ${`%${trimmed}%`})
    ORDER BY
      (username = ${trimmed}) DESC,
      (username LIKE ${`${trimmed}%`}) DESC,
      (lower(display_name) LIKE ${`${trimmed}%`}) DESC,
      lower(display_name)
    LIMIT 50
  `;
  return rows.map(toPublicUser);
}

export async function getUser(userId: number): Promise<PublicUser | null> {
  const row = await sqlOne<UserRow>`
    SELECT id, username, display_name, grade, role, avatar_color, avatar_file_id, bio, last_seen_at
    FROM users WHERE id = ${userId}
  `;
  return row ? toPublicUser(row) : null;
}

/**
 * Чёрный список.
 *
 * Блокировка односторонняя и молчаливая: заблокированный не получает об этом
 * сообщения, он просто больше не может писать. Так и задумано — уведомление
 * «вас заблокировали» в школьном чате само по себе повод для ссоры.
 */
export async function blockUser(blockerId: number, blockedId: number): Promise<void> {
  if (blockerId === blockedId) throw new HttpError(400, 'Себя заблокировать нельзя.');

  const target = await sqlOne<{ role: string }>`SELECT role FROM users WHERE id = ${blockedId}`;
  if (!target) throw new HttpError(404, 'Пользователь не найден.');

  await sql`
    INSERT INTO blocks (blocker_id, blocked_id)
    VALUES (${blockerId}, ${blockedId})
    ON CONFLICT DO NOTHING
  `;
}

export async function unblockUser(blockerId: number, blockedId: number): Promise<void> {
  await sql`
    DELETE FROM blocks WHERE blocker_id = ${blockerId} AND blocked_id = ${blockedId}
  `;
}

/** Заблокирован ли один другим — в любую сторону. */
export async function blockedBetween(
  userId: number,
  otherId: number,
): Promise<{ iBlocked: boolean; blockedMe: boolean }> {
  const rows = await sql<{ blocker_id: string }>`
    SELECT blocker_id FROM blocks
    WHERE (blocker_id = ${userId} AND blocked_id = ${otherId})
       OR (blocker_id = ${otherId} AND blocked_id = ${userId})
  `;
  return {
    iBlocked: rows.some((row) => Number(row.blocker_id) === userId),
    blockedMe: rows.some((row) => Number(row.blocker_id) === otherId),
  };
}

/**
 * Меняет логин.
 *
 * Три проверки, и каждая закрывает свой способ выдать себя за другого:
 * логин не должен быть занят сейчас; он не должен быть чужим прежним логином,
 * который ещё в резерве; и менять его можно не чаще, чем раз в несколько дней —
 * иначе человека невозможно найти по логину, который он носил вчера.
 *
 * Прежний логин уходит в резерв, но за самим хозяином: вернуться к нему он
 * может в любой момент.
 */
export async function changeUsername(userId: number, next: string): Promise<PublicUser> {
  const me = await sqlOne<{ username: string; username_changed_at: Date | null }>`
    SELECT username, username_changed_at FROM users WHERE id = ${userId}
  `;
  if (!me) throw new HttpError(404, 'Аккаунт не найден.');
  if (me.username === next) return (await getUser(userId))!;

  const { minDaysBetween, holdDays } = config.usernameChange;

  if (me.username_changed_at) {
    const nextAllowed = new Date(me.username_changed_at).getTime() + minDaysBetween * 86400_000;
    if (Date.now() < nextAllowed) {
      const daysLeft = Math.ceil((nextAllowed - Date.now()) / 86400_000);
      throw new HttpError(
        429,
        `Логин можно менять раз в ${minDaysBetween} дней. Следующая смена — через ${daysLeft} дн.`,
      );
    }
  }

  const taken = await sqlOne<{ id: number }>`SELECT id FROM users WHERE username = ${next}`;
  if (taken) throw new HttpError(409, 'Такой логин уже занят.');

  const reserved = await sqlOne<{ user_id: number | null }>`
    SELECT user_id FROM released_usernames
    WHERE username = ${next} AND released_at > now() - ${`${holdDays} days`}::interval
  `;
  if (reserved && reserved.user_id !== userId) {
    throw new HttpError(409, 'Этот логин недавно освободился и пока закреплён за прежним владельцем.');
  }

  await transaction(async (query) => {
    await query(
      `INSERT INTO released_usernames (username, user_id, released_at)
       VALUES ($1, $2, now())
       ON CONFLICT (username) DO UPDATE SET user_id = EXCLUDED.user_id, released_at = now()`,
      [me.username, userId],
    );
    // Логин, к которому вернулись, больше не «освободившийся».
    await query(`DELETE FROM released_usernames WHERE username = $1`, [next]);
    await query(`UPDATE users SET username = $1, username_changed_at = now() WHERE id = $2`, [
      next,
      userId,
    ]);
  });

  return (await getUser(userId))!;
}

// ──────────────────────────── Диалоги ────────────────────────────

interface ConversationRow {
  id: number;
  kind: 'dm' | 'group';
  title: string | null;
  avatar_color: string;
  avatar_file_id: number | null;
  muted: boolean;
  last_read_message_id: number;
  member_count: number;
  unread: number;
  last_message_id: number | null;
  last_message_body: string | null;
  last_message_kind: string | null;
  last_message_created_at: Date | null;
  last_message_sender_id: number | null;
  last_message_sender_name: string | null;
  last_message_deleted: Date | null;
  last_message_has_files: boolean;
  partner_id: number | null;
  partner_username: string | null;
  partner_display_name: string | null;
  partner_grade: string | null;
  partner_role: string | null;
  partner_avatar_color: string | null;
  partner_avatar_file_id: number | null;
  partner_bio: string | null;
  partner_last_seen_at: Date | null;
}

const CONVERSATION_SELECT = `
  SELECT
    c.id, c.kind, c.title, c.avatar_color, c.avatar_file_id,
    cm.muted, cm.last_read_message_id,
    (SELECT count(*) FROM conversation_members x WHERE x.conversation_id = c.id) AS member_count,
    (SELECT count(*) FROM messages um
      WHERE um.conversation_id = c.id
        AND um.id > cm.last_read_message_id
        AND um.id > cm.cleared_before_message_id
        AND um.sender_id IS DISTINCT FROM cm.user_id
        AND um.deleted_at IS NULL) AS unread,
    lm.id AS last_message_id,
    lm.body AS last_message_body,
    lm.kind AS last_message_kind,
    lm.created_at AS last_message_created_at,
    lm.sender_id AS last_message_sender_id,
    lm.deleted_at AS last_message_deleted,
    ls.display_name AS last_message_sender_name,
    EXISTS (SELECT 1 FROM message_attachments ma WHERE ma.message_id = lm.id) AS last_message_has_files,
    p.id AS partner_id,
    p.username AS partner_username,
    p.display_name AS partner_display_name,
    p.grade AS partner_grade,
    p.role AS partner_role,
    p.avatar_color AS partner_avatar_color,
    p.avatar_file_id AS partner_avatar_file_id,
    p.bio AS partner_bio,
    p.last_seen_at AS partner_last_seen_at
  FROM conversation_members cm
  JOIN conversations c ON c.id = cm.conversation_id
  LEFT JOIN LATERAL (
    -- Очищенное «у себя» в списке не показывается: после очистки диалог
    -- выглядит так, будто в нём ничего и не было. Убранные сообщения тоже:
    -- строчка «сообщение удалено» в списке чатов — след, которого не должно
    -- остаться, поэтому берётся последнее уцелевшее.
    SELECT m.* FROM messages m
    WHERE m.conversation_id = c.id
      AND m.id > cm.cleared_before_message_id
      AND m.deleted_at IS NULL
    ORDER BY m.id DESC LIMIT 1
  ) lm ON true
  LEFT JOIN users ls ON ls.id = lm.sender_id
  LEFT JOIN LATERAL (
    SELECT u.* FROM conversation_members other
    JOIN users u ON u.id = other.user_id
    WHERE other.conversation_id = c.id AND other.user_id <> cm.user_id AND c.kind = 'dm'
    LIMIT 1
  ) p ON true
`;

function toConversationSummary(row: ConversationRow): ConversationSummary {
  const partner: PublicUser | null =
    row.partner_id != null
      ? {
          id: row.partner_id,
          username: row.partner_username ?? '',
          displayName: row.partner_display_name ?? '',
          grade: row.partner_grade ?? '',
          isTeacher: row.partner_role === 'teacher',
          avatarColor: row.partner_avatar_color ?? 'violet',
          avatarFileId: row.partner_avatar_file_id,
          bio: row.partner_bio ?? '',
          online: isOnline(row.partner_last_seen_at),
          lastSeenAt: toIso(row.partner_last_seen_at),
        }
      : null;

  return {
    id: row.id,
    kind: row.kind,
    // У личного диалога заголовок — имя собеседника; у группы — её название.
    title: row.kind === 'dm' ? (partner?.displayName ?? 'Диалог') : (row.title ?? 'Группа'),
    avatarColor: row.kind === 'dm' ? (partner?.avatarColor ?? 'violet') : row.avatar_color,
    avatarFileId: row.kind === 'dm' ? (partner?.avatarFileId ?? null) : row.avatar_file_id,
    memberCount: row.member_count,
    muted: row.muted,
    unread: row.unread,
    lastReadMessageId: row.last_read_message_id,
    partner,
    lastMessage:
      row.last_message_id != null
        ? {
            id: row.last_message_id,
            body: row.last_message_body ?? '',
            kind: row.last_message_kind ?? 'text',
            createdAt: toIso(row.last_message_created_at) ?? new Date().toISOString(),
            senderId: row.last_message_sender_id,
            senderName: row.last_message_sender_name,
            deleted: row.last_message_deleted != null,
            hasAttachments: row.last_message_has_files,
          }
        : null,
  };
}

export async function listConversations(userId: number): Promise<ConversationSummary[]> {
  // Личный диалог без единого сообщения в списке не показываем: он заводится
  // от одного захода в чужой профиль, и список быстро зарастает людьми, с
  // которыми так и не поговорили. Такой диалог никуда не пропадает — он
  // появится в списке с первым сообщением, а до тех пор человек остаётся в
  // недавних. У групп иначе: туда вступают осознанно, и пустая группа
  // (в неё только что вошли по коду) должна быть видна сразу.
  const result = await pool().query(
    `${CONVERSATION_SELECT}
     WHERE cm.user_id = $1 AND (c.kind <> 'dm' OR lm.id IS NOT NULL)
     ORDER BY COALESCE(lm.created_at, c.created_at) DESC LIMIT 200`,
    [userId],
  );
  return (result.rows as ConversationRow[]).map(toConversationSummary);
}

export async function getConversationSummary(
  userId: number,
  conversationId: number,
): Promise<ConversationSummary | null> {
  const result = await pool().query(
    `${CONVERSATION_SELECT} WHERE cm.user_id = $1 AND c.id = $2 LIMIT 1`,
    [userId, conversationId],
  );
  const row = (result.rows as ConversationRow[])[0];
  return row ? toConversationSummary(row) : null;
}

export async function listMembers(conversationId: number): Promise<(PublicUser & { role: string })[]> {
  // Ролей две, и они про разное: u.role — кто человек в гимназии, cm.role —
  // кто он в этой группе. Наружу как `role` уходит вторая.
  const rows = await sql<UserRow & { member_role: string }>`
    SELECT u.id, u.username, u.display_name, u.grade, u.role,
           u.avatar_color, u.avatar_file_id, u.bio, u.last_seen_at,
           cm.role AS member_role
    FROM conversation_members cm
    JOIN users u ON u.id = cm.user_id
    WHERE cm.conversation_id = ${conversationId}
    ORDER BY cm.role = 'owner' DESC, lower(u.display_name)
  `;
  return rows.map((row) => ({ ...toPublicUser(row), role: row.member_role }));
}

/** Находит личный диалог с человеком или создаёт его. */
export async function ensureDm(userId: number, otherId: number): Promise<number> {
  if (userId === otherId) throw new HttpError(400, 'Нельзя начать диалог с самим собой.');

  const other = await sqlOne<{ id: number }>`SELECT id FROM users WHERE id = ${otherId}`;
  if (!other) throw new HttpError(404, 'Пользователь не найден.');

  const dmKey = [userId, otherId].sort((a, b) => a - b).join(':');

  const existing = await sqlOne<{ id: number }>`
    SELECT id FROM conversations WHERE dm_key = ${dmKey}
  `;
  if (existing) return existing.id;

  // Гонку двух одновременных «написать первым» ловим через уникальный dm_key.
  const created = await sqlOne<{ id: number }>`
    INSERT INTO conversations (kind, dm_key, created_by)
    VALUES ('dm', ${dmKey}, ${userId})
    ON CONFLICT (dm_key) DO NOTHING
    RETURNING id
  `;

  if (!created) {
    const race = await sqlOne<{ id: number }>`SELECT id FROM conversations WHERE dm_key = ${dmKey}`;
    if (!race) throw new HttpError(500, 'Не удалось открыть диалог.');
    return race.id;
  }

  await sql`
    INSERT INTO conversation_members (conversation_id, user_id, role)
    VALUES (${created.id}, ${userId}, 'member'), (${created.id}, ${otherId}, 'member')
    ON CONFLICT DO NOTHING
  `;

  return created.id;
}

/** Случайный код приглашения из алфавита без похожих друг на друга символов. */
function randomJoinCode(): string {
  const { length, alphabet } = config.joinCode;
  let code = '';
  for (let i = 0; i < length; i++) {
    code += alphabet[randomInt(alphabet.length)];
  }
  return code;
}

/**
 * Присваивает группе свободный код.
 *
 * Уникальность гарантирует ограничение в базе, поэтому при столкновении просто
 * пробуем следующий код, а не проверяем занятость заранее — между проверкой и
 * записью код мог бы успеть занять кто-то другой.
 */
async function assignJoinCode(conversationId: number): Promise<string> {
  for (let attempt = 0; attempt < 12; attempt++) {
    const code = randomJoinCode();
    const updated = await sqlOne<{ join_code: string }>`
      UPDATE conversations SET join_code = ${code}
      WHERE id = ${conversationId}
        AND NOT EXISTS (SELECT 1 FROM conversations other WHERE other.join_code = ${code})
      RETURNING join_code
    `;
    if (updated) return updated.join_code;
  }
  throw new HttpError(500, 'Не удалось подобрать свободный код. Попробуйте ещё раз.');
}

/** Выдаёт группе новый код: старый перестаёт работать. */
export async function regenerateJoinCode(conversationId: number): Promise<string> {
  return assignJoinCode(conversationId);
}

export async function createGroup(
  ownerId: number,
  title: string,
  memberIds: number[],
): Promise<number> {
  const unique = [...new Set(memberIds.filter((id) => id !== ownerId))];
  if (unique.length + 1 > config.limits.groupMembers) {
    throw new HttpError(400, `В группе не может быть больше ${config.limits.groupMembers} участников.`);
  }

  const known = await sql<{ id: number }>`SELECT id FROM users WHERE id = ANY(${unique}::bigint[])`;
  if (known.length !== unique.length) throw new HttpError(400, 'Кто-то из участников не найден.');

  const created = await sqlOne<{ id: number }>`
    INSERT INTO conversations (kind, title, created_by, avatar_color)
    VALUES ('group', ${title}, ${ownerId}, ${config.avatarColors[title.length % config.avatarColors.length]})
    RETURNING id
  `;
  if (!created) throw new HttpError(500, 'Не удалось создать группу.');

  const ids = [ownerId, ...unique];
  const values = ids
    .map((_, index) => `($1, $${index + 2}, ${index === 0 ? `'owner'` : `'member'`})`)
    .join(', ');
  await pool().query(
    `INSERT INTO conversation_members (conversation_id, user_id, role) VALUES ${values}`,
    [created.id, ...ids],
  );

  // Код выдаётся сразу: по нему в группу заходят, не дожидаясь приглашения.
  await assignJoinCode(created.id);

  return created.id;
}

/**
 * Присоединяет к группе по коду.
 *
 * Возвращает и признак того, что человек уже состоял в группе: тогда его надо
 * просто открыть, не объявляя о новом участнике.
 */
export async function joinByCode(
  userId: number,
  code: string,
): Promise<{ conversationId: number; alreadyMember: boolean; title: string }> {
  const group = await sqlOne<{ id: number; title: string | null }>`
    SELECT id, title FROM conversations WHERE join_code = ${code} AND kind = 'group'
  `;
  if (!group) throw new HttpError(404, 'Группа с таким кодом не найдена. Проверьте код.');

  const existing = await sqlOne<{ user_id: number }>`
    SELECT user_id FROM conversation_members
    WHERE conversation_id = ${group.id} AND user_id = ${userId}
  `;
  if (existing) {
    return { conversationId: group.id, alreadyMember: true, title: group.title ?? 'Группа' };
  }

  const size = await sqlOne<{ count: number }>`
    SELECT count(*)::int AS count FROM conversation_members WHERE conversation_id = ${group.id}
  `;
  if ((size?.count ?? 0) >= config.limits.groupMembers) {
    throw new HttpError(400, 'В группе уже максимум участников.');
  }

  await sql`
    INSERT INTO conversation_members (conversation_id, user_id, role)
    VALUES (${group.id}, ${userId}, 'member')
    ON CONFLICT DO NOTHING
  `;

  return { conversationId: group.id, alreadyMember: false, title: group.title ?? 'Группа' };
}

/** Код группы виден только тем, кто в ней состоит. */
export async function getJoinCode(conversationId: number): Promise<string | null> {
  const row = await sqlOne<{ join_code: string | null }>`
    SELECT join_code FROM conversations WHERE id = ${conversationId}
  `;
  // У групп, созданных до появления кодов, его ещё нет — выдаём при первом запросе.
  if (row && !row.join_code) return assignJoinCode(conversationId);
  return row?.join_code ?? null;
}

// ──────────────────────────── Сообщения ────────────────────────────

interface MessageRow {
  id: number;
  conversation_id: number;
  sender_id: number | null;
  sender_name: string | null;
  sender_username: string | null;
  sender_color: string | null;
  sender_avatar_file_id: number | null;
  body: string;
  kind: string;
  created_at: Date;
  edited_at: Date | null;
  deleted_at: Date | null;
  reply_to_id: number | null;
  reply_body: string | null;
  reply_sender_name: string | null;
  reply_deleted: Date | null;
}

const MESSAGE_SELECT = `
  SELECT
    m.id, m.conversation_id, m.sender_id, m.body, m.kind,
    m.created_at, m.edited_at, m.deleted_at, m.reply_to_id,
    u.display_name AS sender_name,
    u.username AS sender_username,
    u.avatar_color AS sender_color,
    u.avatar_file_id AS sender_avatar_file_id,
    r.body AS reply_body,
    r.deleted_at AS reply_deleted,
    ru.display_name AS reply_sender_name
  FROM messages m
  LEFT JOIN users u ON u.id = m.sender_id
  LEFT JOIN messages r ON r.id = m.reply_to_id
  LEFT JOIN users ru ON ru.id = r.sender_id
`;

/** Догружает реакции и вложения для набора сообщений одним заходом на каждую таблицу. */
async function decorate(rows: MessageRow[], viewerId: number): Promise<Message[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);

  const [reactionRows, attachmentRows] = await Promise.all([
    sql<{ message_id: number; emoji: string; user_id: number; display_name: string }>`
      SELECT re.message_id, re.emoji, re.user_id, u.display_name
      FROM reactions re
      JOIN users u ON u.id = re.user_id
      WHERE re.message_id = ANY(${ids}::bigint[])
      ORDER BY re.created_at
    `,
    sql<{ message_id: number; id: number; name: string; mime: string; size: number; width: number | null; height: number | null }>`
      SELECT ma.message_id, f.id, f.name, f.mime, f.size, f.width, f.height
      FROM message_attachments ma
      JOIN files f ON f.id = ma.file_id
      WHERE ma.message_id = ANY(${ids}::bigint[])
      ORDER BY ma.position, f.id
    `,
  ]);

  const reactionsByMessage = new Map<number, Map<string, ReactionSummary>>();
  for (const row of reactionRows) {
    let byEmoji = reactionsByMessage.get(row.message_id);
    if (!byEmoji) {
      byEmoji = new Map();
      reactionsByMessage.set(row.message_id, byEmoji);
    }
    const summary = byEmoji.get(row.emoji) ?? {
      emoji: row.emoji,
      count: 0,
      mine: false,
      users: [],
      userIds: [],
    };
    summary.count += 1;
    summary.users.push(row.display_name);
    summary.userIds.push(row.user_id);
    if (row.user_id === viewerId) summary.mine = true;
    byEmoji.set(row.emoji, summary);
  }

  const attachmentsByMessage = new Map<number, Attachment[]>();
  for (const row of attachmentRows) {
    const list = attachmentsByMessage.get(row.message_id) ?? [];
    list.push({
      id: row.id,
      name: row.name,
      mime: row.mime,
      size: row.size,
      width: row.width,
      height: row.height,
    });
    attachmentsByMessage.set(row.message_id, list);
  }

  return rows.map((row) => ({
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    senderName: row.sender_name,
    senderUsername: row.sender_username,
    senderColor: row.sender_color,
    senderAvatarFileId: row.sender_avatar_file_id,
    // Удалённое сообщение не отдаём наружу даже в теле ответа.
    body: row.deleted_at ? '' : row.body,
    kind: row.kind,
    createdAt: toIso(row.created_at) ?? new Date().toISOString(),
    editedAt: toIso(row.edited_at),
    deleted: row.deleted_at != null,
    replyTo:
      row.reply_to_id != null
        ? {
            id: row.reply_to_id,
            senderName: row.reply_sender_name,
            body: row.reply_deleted ? '' : (row.reply_body ?? ''),
            deleted: row.reply_deleted != null,
          }
        : null,
    attachments: row.deleted_at ? [] : (attachmentsByMessage.get(row.id) ?? []),
    reactions: row.deleted_at ? [] : [...(reactionsByMessage.get(row.id)?.values() ?? [])],
  }));
}

/**
 * Страница истории. `before` листает вверх, `after` подтягивает свежее
 * (используется для сверки после переподключения SSE).
 */
export async function listMessages(
  viewerId: number,
  conversationId: number,
  options: { before?: number; after?: number; limit?: number } = {},
): Promise<Message[]> {
  const limit = Math.min(options.limit ?? config.limits.messagePage, 100);
  // Всё, что было до очистки, для этого человека больше не существует.
  const from = await clearedBefore(viewerId, conversationId);

  let rows: MessageRow[];
  if (options.after) {
    const result = await pool().query(
      `${MESSAGE_SELECT} WHERE m.conversation_id = $1 AND m.id > $2 AND m.id > $4 ORDER BY m.id ASC LIMIT $3`,
      [conversationId, options.after, limit, from],
    );
    rows = result.rows as MessageRow[];
  } else if (options.before) {
    const result = await pool().query(
      `${MESSAGE_SELECT} WHERE m.conversation_id = $1 AND m.id < $2 AND m.id > $4 ORDER BY m.id DESC LIMIT $3`,
      [conversationId, options.before, limit, from],
    );
    rows = (result.rows as MessageRow[]).reverse();
  } else {
    const result = await pool().query(
      `${MESSAGE_SELECT} WHERE m.conversation_id = $1 AND m.id > $3 ORDER BY m.id DESC LIMIT $2`,
      [conversationId, limit, from],
    );
    rows = (result.rows as MessageRow[]).reverse();
  }

  return decorate(rows, viewerId);
}

/** Граница очистки: сообщения до неё этот человек у себя больше не видит. */
async function clearedBefore(userId: number, conversationId: number): Promise<number> {
  const row = await sqlOne<{ cleared_before_message_id: string }>`
    SELECT cleared_before_message_id FROM conversation_members
    WHERE conversation_id = ${conversationId} AND user_id = ${userId}
  `;
  return Number(row?.cleared_before_message_id ?? 0);
}

/**
 * Очистка переписки «у себя».
 *
 * Чужие слова не удаляются: собеседник вправе видеть свой разговор целиком.
 * Здесь только ставится граница — для того, кто нажал кнопку, история
 * начинается заново. Личный диалог после этого исчезает из списка чатов, пока
 * в нём снова не напишут.
 */
export async function clearConversation(userId: number, conversationId: number): Promise<void> {
  await sql`
    UPDATE conversation_members
    SET cleared_before_message_id = COALESCE(
      (SELECT max(id) FROM messages WHERE conversation_id = ${conversationId}),
      cleared_before_message_id
    )
    WHERE conversation_id = ${conversationId} AND user_id = ${userId}
  `;
}

export async function getMessage(viewerId: number, messageId: number): Promise<Message | null> {
  const result = await pool().query(`${MESSAGE_SELECT} WHERE m.id = $1`, [messageId]);
  const messages = await decorate(result.rows as MessageRow[], viewerId);
  return messages[0] ?? null;
}

/** Полнотекстовый поиск по всем диалогам, где состоит пользователь. */
export async function searchMessages(viewerId: number, query: string): Promise<Message[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const result = await pool().query(
    `${MESSAGE_SELECT}
     WHERE m.deleted_at IS NULL
       AND m.kind = 'text'
       AND EXISTS (
         SELECT 1 FROM conversation_members cm
         WHERE cm.conversation_id = m.conversation_id
           AND cm.user_id = $1
           AND m.id > cm.cleared_before_message_id
       )
       AND (
         to_tsvector('russian', m.body) @@ websearch_to_tsquery('russian', $2)
         OR m.body ILIKE $3
       )
     ORDER BY m.id DESC
     LIMIT 50`,
    [viewerId, trimmed, `%${trimmed}%`],
  );

  return decorate(result.rows as MessageRow[], viewerId);
}

/** Отмечает диалог прочитанным до указанного сообщения. */
export async function markRead(userId: number, conversationId: number, messageId: number): Promise<void> {
  await sql`
    UPDATE conversation_members
    SET last_read_message_id = GREATEST(last_read_message_id, ${messageId})
    WHERE conversation_id = ${conversationId} AND user_id = ${userId}
  `;
}

/** Кто и до какого сообщения дочитал — для галочек «прочитано». */
export async function readReceipts(
  conversationId: number,
  excludeUserId: number,
): Promise<{ userId: number; displayName: string; lastReadMessageId: number }[]> {
  const rows = await sql<{ user_id: number; display_name: string; last_read_message_id: number }>`
    SELECT cm.user_id, u.display_name, cm.last_read_message_id
    FROM conversation_members cm
    JOIN users u ON u.id = cm.user_id
    WHERE cm.conversation_id = ${conversationId} AND cm.user_id <> ${excludeUserId}
  `;
  return rows.map((row) => ({
    userId: row.user_id,
    displayName: row.display_name,
    lastReadMessageId: row.last_read_message_id,
  }));
}

/** Кто сейчас печатает в диалоге (кроме самого спрашивающего). */
export async function typingUsers(
  conversationId: number,
  excludeUserId: number,
): Promise<{ userId: number; displayName: string }[]> {
  const rows = await sql<{ user_id: number; display_name: string }>`
    SELECT t.user_id, u.display_name
    FROM typing_state t
    JOIN users u ON u.id = t.user_id
    WHERE t.conversation_id = ${conversationId}
      AND t.user_id <> ${excludeUserId}
      AND t.updated_at > now() - make_interval(secs => ${config.presence.typingTtlSeconds})
  `;
  return rows.map((row) => ({ userId: row.user_id, displayName: row.display_name }));
}
