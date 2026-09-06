-- Перемена — схема базы данных.
-- Скрипт идемпотентный: его можно прогонять поверх существующей базы (npm run db:push).

CREATE TABLE IF NOT EXISTS users (
  id             BIGSERIAL PRIMARY KEY,
  username       TEXT        NOT NULL UNIQUE,          -- в нижнем регистре, латиница/цифры/_
  display_name   TEXT        NOT NULL,
  password_hash  TEXT        NOT NULL,
  avatar_color   TEXT        NOT NULL DEFAULT 'violet',
  avatar_file_id BIGINT,                               -- FK добавляется ниже, после files
  bio            TEXT        NOT NULL DEFAULT '',
  role           TEXT        NOT NULL DEFAULT 'member', -- member | admin
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS users_last_seen_idx ON users (last_seen_at DESC);
CREATE INDEX IF NOT EXISTS users_display_name_idx ON users (lower(display_name));

-- Сессии. В куке лежит случайный токен, в базе — только его SHA-256.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT        PRIMARY KEY,
  user_id     BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  user_agent  TEXT        NOT NULL DEFAULT ''
);

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
  dm_key          TEXT        UNIQUE
);

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

-- Простой счётчик попыток для защиты входа и регистрации от перебора.
CREATE TABLE IF NOT EXISTS rate_limits (
  bucket      TEXT        PRIMARY KEY,
  hits        INTEGER     NOT NULL DEFAULT 0,
  window_start TIMESTAMPTZ NOT NULL DEFAULT now()
);
