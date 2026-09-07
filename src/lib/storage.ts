/**
 * Учёт места, занятого файлами.
 *
 * Вложения хранятся прямо в Postgres, а база бесплатная — полгигабайта на всё.
 * Если её забить фотографиями, перестанут проходить и обычные сообщения:
 * кончившееся место в базе останавливает любую запись, не только загрузку.
 * Поэтому перед каждой загрузкой считаем три числа и отказываем заранее — с
 * объяснением, сколько осталось и когда освободится.
 */

import { config } from './config';
import { sqlOne } from './db';
import { HttpError } from './http';

export interface StorageUsage {
  /** Занято этим человеком за всё время. */
  usedBytes: number;
  /** Его же предел. */
  quotaBytes: number;
  /** Загружено за последние сутки. */
  todayBytes: number;
  /** Сколько ещё можно загрузить прямо сейчас — меньшее из всех пределов. */
  freeBytes: number;
}

/** «12,4 МБ» — размер так, как его пишут людям, а не в байтах. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  const megabytes = bytes / (1024 * 1024);
  // До десяти мегабайт десятая доля ещё что-то значит, дальше — уже нет.
  return `${megabytes < 10 ? megabytes.toFixed(1).replace('.', ',') : Math.round(megabytes)} МБ`;
}

/**
 * Чья это квота.
 *
 * Учителю и администратору отведено больше: им раздавать классу материалы,
 * а не пересылать картинки. Считается по роли из базы, не по слову клиента.
 */
function quotaFor(role: string) {
  return role === 'member' ? config.storage.student : config.storage.staff;
}

/** Занятое и свободное место — одним запросом. */
async function measure(userId: number) {
  const row = await sqlOne<{ used: string; today: string; total: string }>`
    SELECT
      COALESCE(SUM(size) FILTER (WHERE owner_id = ${userId}), 0) AS used,
      COALESCE(SUM(size) FILTER (
        WHERE owner_id = ${userId} AND created_at > now() - interval '1 day'
      ), 0) AS today,
      COALESCE(SUM(size), 0) AS total
    FROM files
  `;

  return {
    used: Number(row?.used ?? 0),
    today: Number(row?.today ?? 0),
    total: Number(row?.total ?? 0),
  };
}

export async function storageUsage(userId: number, role: string): Promise<StorageUsage> {
  const { used, today, total } = await measure(userId);
  const { perUserBytes, perDayBytes } = quotaFor(role);
  const { totalBytes } = config.storage;

  return {
    usedBytes: used,
    quotaBytes: perUserBytes,
    todayBytes: today,
    freeBytes: Math.max(
      0,
      Math.min(perUserBytes - used, perDayBytes - today, totalBytes - total),
    ),
  };
}

/**
 * Пропускает загрузку или объясняет, почему нет.
 *
 * Проверка идёт до записи файла в базу: сказать «не поместилось» после того,
 * как файл уже занял место, — значит не ограничить ничего.
 */
export async function assertCanUpload(userId: number, role: string, size: number): Promise<void> {
  const { used, today, total } = await measure(userId);
  const { perUserBytes, perDayBytes } = quotaFor(role);
  const { totalBytes } = config.storage;

  if (total + size > totalBytes) {
    throw new HttpError(
      507,
      'В общем хранилище гимназии закончилось место. Загрузку файлов придётся отложить — сообщите администратору.',
    );
  }

  if (today + size > perDayBytes) {
    throw new HttpError(
      507,
      `За сутки можно отправить ${formatBytes(perDayBytes)} файлов, и этот предел уже выбран. Остальное получится отправить завтра.`,
    );
  }

  if (used + size > perUserBytes) {
    throw new HttpError(
      507,
      `Ваши файлы занимают ${formatBytes(used)} из ${formatBytes(perUserBytes)} — это весь отведённый объём. Место общее на всю гимназию, поэтому дальше картинки лучше сжимать, а большое отправлять ссылкой.`,
    );
  }
}
