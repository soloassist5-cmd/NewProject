/**
 * Недавние собеседники — история поиска.
 *
 * Раньше заход в чужой профиль заводил диалог, и тот навсегда оставался в
 * списке чатов, даже если не написали ни слова. Список зарастал людьми, с
 * которыми не разговаривали. Теперь пустой диалог в списке не показывается, а
 * человек попадает сюда — чтобы вернуться к нему в один тап и убрать крестиком,
 * когда он больше не нужен.
 *
 * Хранится у человека в браузере, а не на сервере: это не переписка, а след
 * собственных нажатий. На общем компьютере он уходит вместе с сессией — там
 * браузер чистится, а на своём телефоне список переживает перезапуск.
 */

import type { Person } from './types';

const KEY = 'gimroom-recent-people';
const LIMIT = 12;

/** То немногое, что нужно, чтобы нарисовать строчку списка. */
export interface RecentPerson {
  id: number;
  username: string;
  displayName: string;
  avatarColor: string;
  avatarFileId: number | null;
}

function read(): RecentPerson[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Записи могли остаться от прежней версии — берём только целые.
    return parsed.filter(
      (item): item is RecentPerson =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as RecentPerson).id === 'number' &&
        typeof (item as RecentPerson).displayName === 'string',
    );
  } catch {
    // Испорченная запись или приватный режим — считаем, что истории нет.
    return [];
  }
}

function write(list: RecentPerson[]): RecentPerson[] {
  const next = list.slice(0, LIMIT);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Не сохранилось — список поживёт до перезагрузки, это не беда.
  }
  return next;
}

export function listRecent(): RecentPerson[] {
  return read();
}

/** Поднимает человека наверх списка (или добавляет, если его там не было). */
export function rememberRecent(person: Person | RecentPerson): RecentPerson[] {
  const entry: RecentPerson = {
    id: person.id,
    username: person.username,
    displayName: person.displayName,
    avatarColor: person.avatarColor,
    avatarFileId: person.avatarFileId,
  };
  return write([entry, ...read().filter((item) => item.id !== entry.id)]);
}

/** Убирает человека из истории. */
export function forgetRecent(personId: number): RecentPerson[] {
  return write(read().filter((item) => item.id !== personId));
}
