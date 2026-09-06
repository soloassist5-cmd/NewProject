#!/usr/bin/env node
// Применяет db/schema.sql к базе из DATABASE_URL. Скрипт идемпотентный —
// его безопасно запускать повторно после обновления схемы.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const schemaPath = join(here, '..', 'db', 'schema.sql');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('Не задана переменная DATABASE_URL.');
  console.error('Пример: DATABASE_URL="postgresql://..." npm run db:push');
  process.exit(1);
}

const isLocal = /@(localhost|127\.0\.0\.1)/.test(connectionString);
const client = new pg.Client({
  connectionString,
  ssl: isLocal ? undefined : { rejectUnauthorized: false },
});

try {
  await client.connect();
  await client.query(readFileSync(schemaPath, 'utf8'));

  const { rows } = await client.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' ORDER BY table_name
  `);
  console.log(`Схема применена. Таблиц в базе: ${rows.length}`);
  console.log(rows.map((row) => `  • ${row.table_name}`).join('\n'));
} catch (error) {
  console.error('Не удалось применить схему:', error.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
