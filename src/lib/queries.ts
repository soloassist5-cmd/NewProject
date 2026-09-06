import { randomInt } from 'node:crypto';
import { config } from './config';
import { pool, sql, sqlOne } from './db';
import { HttpError } from './http';

/** Публичная карточка человека — то, что видят остальные. */
export interface PublicUser {
  id: number;
  username: string;
  displayName: string;
  /** Класс вида «9О». У сотрудников гимназии пусто. */
  grade: string;
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
    avatarColor: row.avatar_color,
    avatarFileId: row.avatar_file_id,
    bio: row.bio,
    online: isOnline(row.last_seen_at),
    lastSeenAt: toIso(row.last_seen_at),
  };
}

/** Каталог школы: все зарегистрированные, с поиском по имени и username. */
export async function listPeople(viewerId: number, search: string): Promise<PublicUser[]> {
  const pattern = `%${search.trim().toLowerCase()}%`;
  const rows = search.trim()
    ? await sql<UserRow>`
        SELECT id, username, display_name, grade, avatar_color, avatar_file_id, bio, last_seen_at
        FROM users
        WHERE id <> ${viewerId}
          AND (lower(display_name) LIKE ${pattern} OR username LIKE ${pattern})
        ORDER BY last_seen_at DESC
        LIMIT 50
      `
    : await sql<UserRow>`
        SELECT id, username, display_name, grade, avatar_color, avatar_file_id, bio, last_seen_at
        FROM users
        WHERE id <> ${viewerId}
        ORDER BY last_seen_at DESC
        LIMIT 50
      `;
  return rows.map(toPublicUser);
}

export async function getUser(userId: number): Promise<PublicUser | null> {
  const row = await sqlOne<UserRow>`
    SELECT id, username, display_name, grade, avatar_color, avatar_file_id, bio, last_seen_at
    FROM users WHERE id = ${userId}
  `;
  return row ? toPublicUser(row) : null;
}

// ──────────────────────────── Диалоги ────────────────────────────

interface ConversationRow {
  id: number;
  kind: 'dm' | 'group';
  title: string | null;
  avatar_color: string;
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
  partner_avatar_color: string | null;
  partner_avatar_file_id: number | null;
  partner_bio: string | null;
  partner_last_seen_at: Date | null;
}

const CONVERSATION_SELECT = `
  SELECT
    c.id, c.kind, c.title, c.avatar_color,
    cm.muted, cm.last_read_message_id,
    (SELECT count(*) FROM conversation_members x WHERE x.conversation_id = c.id) AS member_count,
    (SELECT count(*) FROM messages um
      WHERE um.conversation_id = c.id
        AND um.id > cm.last_read_message_id
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
    p.avatar_color AS partner_avatar_color,
    p.avatar_file_id AS partner_avatar_file_id,
    p.bio AS partner_bio,
    p.last_seen_at AS partner_last_seen_at
  FROM conversation_members cm
  JOIN conversations c ON c.id = cm.conversation_id
  LEFT JOIN LATERAL (
    SELECT m.* FROM messages m
    WHERE m.conversation_id = c.id
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
    avatarFileId: row.kind === 'dm' ? (partner?.avatarFileId ?? null) : null,
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
  const result = await pool().query(
    `${CONVERSATION_SELECT} WHERE cm.user_id = $1 ORDER BY COALESCE(lm.created_at, c.created_at) DESC LIMIT 200`,
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
  const rows = await sql<UserRow & { role: string }>`
    SELECT u.id, u.username, u.display_name, u.grade, u.avatar_color, u.avatar_file_id, u.bio, u.last_seen_at, cm.role
    FROM conversation_members cm
    JOIN users u ON u.id = cm.user_id
    WHERE cm.conversation_id = ${conversationId}
    ORDER BY cm.role = 'owner' DESC, lower(u.display_name)
  `;
  return rows.map((row) => ({ ...toPublicUser(row), role: row.role }));
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

  let rows: MessageRow[];
  if (options.after) {
    const result = await pool().query(
      `${MESSAGE_SELECT} WHERE m.conversation_id = $1 AND m.id > $2 ORDER BY m.id ASC LIMIT $3`,
      [conversationId, options.after, limit],
    );
    rows = result.rows as MessageRow[];
  } else if (options.before) {
    const result = await pool().query(
      `${MESSAGE_SELECT} WHERE m.conversation_id = $1 AND m.id < $2 ORDER BY m.id DESC LIMIT $3`,
      [conversationId, options.before, limit],
    );
    rows = (result.rows as MessageRow[]).reverse();
  } else {
    const result = await pool().query(
      `${MESSAGE_SELECT} WHERE m.conversation_id = $1 ORDER BY m.id DESC LIMIT $2`,
      [conversationId, limit],
    );
    rows = (result.rows as MessageRow[]).reverse();
  }

  return decorate(rows, viewerId);
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
         WHERE cm.conversation_id = m.conversation_id AND cm.user_id = $1
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
