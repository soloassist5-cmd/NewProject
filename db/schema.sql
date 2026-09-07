-- ГимРум — схема базы данных.
-- Скрипт идемпотентный: его можно прогонять поверх существующей базы (npm run db:push).

CREATE TABLE IF NOT EXISTS users (
  id             BIGSERIAL PRIMARY KEY,
  username       TEXT        NOT NULL UNIQUE,          -- в нижнем регистре, латиница/цифры/_
  display_name   TEXT        NOT NULL,
  password_hash  TEXT        NOT NULL,
  grade          TEXT        NOT NULL DEFAULT '',      -- «9О», «11Э» или пусто у сотрудников
  avatar_color   TEXT        NOT NULL DEFAULT 'violet',
  avatar_file_id BIGINT,                               -- FK добавляется ниже, после files
  bio            TEXT        NOT NULL DEFAULT '',
  role           TEXT        NOT NULL DEFAULT 'member', -- member | teacher | admin
  blocked_at     TIMESTAMPTZ,                           -- заполнено — вход закрыт
  blocked_reason TEXT        NOT NULL DEFAULT '',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Колонки появились позже таблицы: дописываем их в уже существующих базах.
ALTER TABLE users ADD COLUMN IF NOT EXISTS grade TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS blocked_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS blocked_reason TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS users_last_seen_idx ON users (last_seen_at DESC);
CREATE INDEX IF NOT EXISTS users_display_name_idx ON users (lower(display_name));
CREATE INDEX IF NOT EXISTS users_grade_idx ON users (grade);

-- Сессии. В куке лежит случайный токен, в базе — только его SHA-256.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT        PRIMARY KEY,
  user_id     BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  user_agent  TEXT        NOT NULL DEFAULT ''
);

-- Когда сессией пользовались в последний раз. По ней сессия продлевается,
-- пока человек заходит, и по ней же он видит в профиле свои устройства.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Запоминать ли вход. false — «чужой компьютер»: кука живёт до закрытия
-- браузера, сессия короткая и не продлевается. Так следующий, кто сядет за
-- этот компьютер, не окажется в чужой переписке.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS persistent BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions (expires_at);

-- Файлы хранятся прямо в Postgres: на Vercel нет постоянного диска, а объёмы
-- школьного чата небольшие. Лимит на размер задаётся в src/lib/config.ts.
CREATE TABLE IF NOT EXISTS files (
  id         BIGSERIAL PRIMARY KEY,
  owner_id   BIGINT      REFERENCES users(id) ON DELETE SET NULL,
  name       TEXT        NOT NULL,
  mime       TEXT        NOT NULL,
  size       INTEGER     NOT NULL,
  width      INTEGER,
  height     INTEGER,
  data       BYTEA       NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE users
    ADD CONSTRAINT users_avatar_file_fk
    FOREIGN KEY (avatar_file_id) REFERENCES files(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Диалоги: личные (dm) и групповые (group).
CREATE TABLE IF NOT EXISTS conversations (
  id              BIGSERIAL PRIMARY KEY,
  kind            TEXT        NOT NULL CHECK (kind IN ('dm', 'group')),
  title           TEXT,                                  -- только для групп
  avatar_color    TEXT        NOT NULL DEFAULT 'blue',
  created_by      BIGINT      REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 'меньший_id:больший_id' — гарантирует единственность личного диалога между двумя людьми
  dm_key          TEXT        UNIQUE,
  -- Код приглашения в группу: по нему присоединяются, не дожидаясь, пока добавят вручную
  join_code       TEXT        UNIQUE
);

-- Колонка появилась позже таблицы: дописываем её в уже существующих базах.
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS join_code TEXT;

DO $$ BEGIN
  ALTER TABLE conversations ADD CONSTRAINT conversations_join_code_key UNIQUE (join_code);
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS conversations_last_message_idx ON conversations (last_message_at DESC);

CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id      BIGINT      NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id              BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role                 TEXT        NOT NULL DEFAULT 'member', -- owner | member
  joined_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_read_message_id BIGINT      NOT NULL DEFAULT 0,
  muted                BOOLEAN     NOT NULL DEFAULT false,
  PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS conversation_members_user_idx ON conversation_members (user_id);

CREATE TABLE IF NOT EXISTS messages (
  id              BIGSERIAL PRIMARY KEY,
  conversation_id BIGINT      NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id       BIGINT      REFERENCES users(id) ON DELETE SET NULL,
  body            TEXT        NOT NULL DEFAULT '',
  reply_to_id     BIGINT      REFERENCES messages(id) ON DELETE SET NULL,
  kind            TEXT        NOT NULL DEFAULT 'text',   -- text | system
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  edited_at       TIMESTAMPTZ,
  deleted_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS messages_conversation_idx ON messages (conversation_id, id DESC);
CREATE INDEX IF NOT EXISTS messages_search_idx
  ON messages USING GIN (to_tsvector('russian', body));

CREATE TABLE IF NOT EXISTS message_attachments (
  message_id BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  file_id    BIGINT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  position   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (message_id, file_id)
);

CREATE TABLE IF NOT EXISTS reactions (
  message_id BIGINT      NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id    BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji      TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id, emoji)
);

CREATE INDEX IF NOT EXISTS reactions_message_idx ON reactions (message_id);

-- Журнал событий — основа realtime. Клиенты читают его через SSE по курсору id.
CREATE TABLE IF NOT EXISTS events (
  id              BIGSERIAL PRIMARY KEY,
  conversation_id BIGINT,      -- NULL = событие не привязано к диалогу
  user_id         BIGINT,      -- NULL = всем участникам диалога; иначе — конкретному человеку
  type            TEXT        NOT NULL,
  payload         JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS events_created_idx ON events (created_at);

-- Кто сейчас печатает. Строки живут несколько секунд и переписываются поверх.
CREATE TABLE IF NOT EXISTS typing_state (
  conversation_id BIGINT      NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);

-- Коды приглашений (используются, когда включён режим INVITE_ONLY).
CREATE TABLE IF NOT EXISTS invites (
  code       TEXT        PRIMARY KEY,
  created_by BIGINT      REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  max_uses   INTEGER     NOT NULL DEFAULT 1,
  uses       INTEGER     NOT NULL DEFAULT 0
);

-- Освободившиеся логины.
--
-- Логин можно менять, и без этой таблицы вышло бы так: человек сменил «ivanov»
-- на «ivanov_i», а через минуту «ivanov» занял кто-то другой — и пишет от его
-- имени тем, кто помнит старый логин. Поэтому прежний логин держится в резерве
-- (см. config.usernameHoldDays) и вернуть его может только сам хозяин.
CREATE TABLE IF NOT EXISTS released_usernames (
  username    TEXT        PRIMARY KEY,
  user_id     BIGINT      REFERENCES users(id) ON DELETE CASCADE,
  released_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS released_usernames_time_idx ON released_usernames (released_at);

-- Когда логин меняли в последний раз: по нему считается пауза между сменами.
ALTER TABLE users ADD COLUMN IF NOT EXISTS username_changed_at TIMESTAMPTZ;

-- Простой счётчик попыток для защиты входа и регистрации от перебора.
CREATE TABLE IF NOT EXISTS rate_limits (
  bucket      TEXT        PRIMARY KEY,
  hits        INTEGER     NOT NULL DEFAULT 0,
  window_start TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Очистка переписки «у себя».
--
-- Удалять чужие сообщения по нажатию одной кнопки нельзя: это чужие слова, и
-- собеседник вправе видеть свой разговор. Поэтому очистка ставит границу — всё,
-- что было до неё, для этого человека больше не показывается. У собеседника
-- переписка остаётся целой.
ALTER TABLE conversation_members
  ADD COLUMN IF NOT EXISTS cleared_before_message_id BIGINT NOT NULL DEFAULT 0;

-- Чёрный список.
--
-- Заблокированный не может писать в личку тому, кто его заблокировал, и не
-- видит его в поиске. Список личный: блокировка в одну сторону.
CREATE TABLE IF NOT EXISTS blocks (
  blocker_id BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id)
);

CREATE INDEX IF NOT EXISTS blocks_blocked_idx ON blocks (blocked_id);

-- Место, занятое файлами, считается по владельцу и по дате: и то и другое
-- нужно на каждой загрузке, поэтому индекс, а не перебор всей таблицы.
CREATE INDEX IF NOT EXISTS files_owner_idx ON files (owner_id, created_at DESC);

-- Картинка группы. Личным диалогам не нужна: там аватар собеседника.
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS avatar_file_id BIGINT;

DO $$ BEGIN
  ALTER TABLE conversations
    ADD CONSTRAINT conversations_avatar_file_fk
    FOREIGN KEY (avatar_file_id) REFERENCES files(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
