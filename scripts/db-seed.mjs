#!/usr/bin/env node
// Наполняет базу демонстрационными данными: несколько человек, личная
// переписка и общий чат класса. Удобно, чтобы посмотреть интерфейс,
// не регистрируя всех вручную.
//
// Пароль у всех демо-аккаунтов: gimroom-demo

import { randomBytes, scrypt as scryptCallback } from 'node:crypto';
import { promisify } from 'node:util';
import pg from 'pg';

const scrypt = promisify(scryptCallback);
const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 96 * 1024 * 1024 };
const PASSWORD = 'gimroom-demo';
const GROUP_CODE = 'GYMN24';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('Не задана переменная DATABASE_URL.');
  process.exit(1);
}

async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize('NFKC'), salt, 64, SCRYPT);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');
}

// Роль «teacher» — как у аккаунтов, которые заводит администратор: класса нет,
// рядом с именем показывается должность.
const PEOPLE = [
  { username: 'anya', displayName: 'Аня Смирнова', grade: '9О', role: 'member', color: 'violet', bio: 'редколлегия' },
  { username: 'petya', displayName: 'Петя Иванов', grade: '9О', role: 'member', color: 'blue', bio: '' },
  { username: 'dasha', displayName: 'Даша Орлова', grade: '9Г', role: 'member', color: 'teal', bio: 'волейбол' },
  { username: 'kostya', displayName: 'Костя Лебедев', grade: '10Э', role: 'member', color: 'amber', bio: '' },
  { username: 'ivanova', displayName: 'Мария Ивановна', grade: '', role: 'teacher', color: 'green', bio: 'алгебра' },
];

const isLocal = /@(localhost|127\.0\.0\.1)/.test(connectionString);
const client = new pg.Client({
  connectionString,
  ssl: isLocal ? undefined : { rejectUnauthorized: false },
});

try {
  await client.connect();

  const hash = await hashPassword(PASSWORD);
  const ids = {};

  for (const person of PEOPLE) {
    const { rows } = await client.query(
      `INSERT INTO users (username, display_name, grade, password_hash, avatar_color, bio, role)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (username) DO UPDATE SET
         display_name = EXCLUDED.display_name,
         grade = EXCLUDED.grade,
         role = EXCLUDED.role
       RETURNING id`,
      [person.username, person.displayName, person.grade, hash, person.color, person.bio, person.role],
    );
    ids[person.username] = Number(rows[0].id);
  }

  // Личный диалог Ани и Пети.
  const dmKey = [ids.anya, ids.petya].sort((a, b) => a - b).join(':');
  const { rows: dmRows } = await client.query(
    `INSERT INTO conversations (kind, dm_key, created_by) VALUES ('dm', $1, $2)
     ON CONFLICT (dm_key) DO UPDATE SET last_message_at = now()
     RETURNING id`,
    [dmKey, ids.anya],
  );
  const dmId = Number(dmRows[0].id);

  await client.query(
    `INSERT INTO conversation_members (conversation_id, user_id) VALUES ($1, $2), ($1, $3)
     ON CONFLICT DO NOTHING`,
    [dmId, ids.anya, ids.petya],
  );

  // Общий чат класса. Код фиксированный, чтобы его удобно было продиктовать
  // при показе; символы взяты из того же алфавита, что и у настоящих кодов
  // (без похожих друг на друга O/0 и I/1/L).
  const { rows: groupRows } = await client.query(
    `INSERT INTO conversations (kind, title, created_by, avatar_color, join_code)
     VALUES ('group', '9О', $1, 'green', $2)
     ON CONFLICT (join_code) DO UPDATE SET last_message_at = now()
     RETURNING id`,
    [ids.anya, GROUP_CODE],
  );
  const groupId = Number(groupRows[0].id);

  await client.query(
    `INSERT INTO conversation_members (conversation_id, user_id, role)
     VALUES ($1, $2, 'owner'), ($1, $3, 'member'), ($1, $4, 'member'), ($1, $5, 'member')
     ON CONFLICT DO NOTHING`,
    [groupId, ids.anya, ids.petya, ids.dasha, ids.kostya],
  );

  const script = [
    [dmId, ids.anya, 'Привет! Ты сделал задачу по геометрии?'],
    [dmId, ids.petya, 'Сделал, могу объяснить на перемене'],
    [dmId, ids.anya, 'Спасибо, выручил'],
    [groupId, ids.anya, 'Ребята, напоминаю: в пятницу контрольная по алгебре'],
    [groupId, ids.kostya, 'А что будет на контрольной?'],
    [groupId, ids.dasha, 'Квадратные уравнения и графики'],
    [groupId, ids.petya, 'Понял, спасибо'],
  ];

  // Скрипт запускают повторно, поэтому реплики не дублируем.
  for (const [conversationId, senderId, body] of script) {
    await client.query(
      `INSERT INTO messages (conversation_id, sender_id, body)
       SELECT $1, $2, $3
       WHERE NOT EXISTS (
         SELECT 1 FROM messages m WHERE m.conversation_id = $1 AND m.body = $3
       )`,
      [conversationId, senderId, body],
    );
  }

  await client.query(
    `UPDATE conversations SET last_message_at = now() WHERE id = ANY($1::bigint[])`,
    [[dmId, groupId]],
  );

  console.log('Демо-данные записаны.');
  console.log(`Аккаунты: ${PEOPLE.map((p) => p.username).join(', ')}`);
  console.log(`Пароль у всех: ${PASSWORD}`);
  console.log(`Код группы «9О» для проверки входа по коду: ${GROUP_CODE}`);
} catch (error) {
  console.error('Не удалось записать демо-данные:', error.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
