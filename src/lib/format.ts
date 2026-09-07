import type { ReactNode } from 'react';
import { createElement, Fragment } from 'react';

/**
 * Подпись роли в гимназии. У ученика её нет — рядом с именем он показывается
 * классом, а не должностью.
 */
export function roleLabel(role: string): string {
  if (role === 'teacher') return 'Учитель';
  if (role === 'admin') return 'Администратор';
  return '';
}

/**
 * Что писать рядом с именем: класс у ученика, должность у сотрудника.
 * Возвращает пустую строку, если сказать нечего.
 */
export function personSubtitle(person: { grade: string; isTeacher?: boolean }): string {
  if (person.grade) return person.grade;
  return person.isTeacher ? roleLabel('teacher') : '';
}

const MONTHS_GENITIVE = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

/** «14:35» */
export function formatTime(iso: string): string {
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Заголовок-разделитель дня: «Сегодня», «Вчера», «5 сентября». */
export function formatDayLabel(iso: string): string {
  const date = new Date(iso);
  const days = Math.round((startOfDay(new Date()) - startOfDay(date)) / 86_400_000);

  if (days === 0) return 'Сегодня';
  if (days === 1) return 'Вчера';

  const label = `${date.getDate()} ${MONTHS_GENITIVE[date.getMonth()]}`;
  return date.getFullYear() === new Date().getFullYear() ? label : `${label} ${date.getFullYear()}`;
}

/** Компактная отметка времени в списке чатов. */
export function formatListTime(iso: string): string {
  const date = new Date(iso);
  const days = Math.round((startOfDay(new Date()) - startOfDay(date)) / 86_400_000);

  if (days === 0) return formatTime(iso);
  if (days === 1) return 'вчера';
  if (days < 7) return date.toLocaleDateString('ru-RU', { weekday: 'short' });
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'numeric' });
}

/** Русские окончания: 1 минуту, 2 минуты, 5 минут. */
function plural(count: number, one: string, few: string, many: string): string {
  const mod100 = count % 100;
  const mod10 = count % 10;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

/** «в сети», «был(а) 5 минут назад», «был(а) вчера». */
export function formatPresence(online: boolean, lastSeenAt: string | null): string {
  if (online) return 'в сети';
  if (!lastSeenAt) return 'не в сети';

  const seconds = Math.floor((Date.now() - new Date(lastSeenAt).getTime()) / 1000);
  if (seconds < 60) return 'был(а) только что';

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `был(а) ${minutes} ${plural(minutes, 'минуту', 'минуты', 'минут')} назад`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `был(а) ${hours} ${plural(hours, 'час', 'часа', 'часов')} назад`;

  const days = Math.floor(hours / 24);
  if (days === 1) return 'был(а) вчера';
  if (days < 7) return `был(а) ${days} ${plural(days, 'день', 'дня', 'дней')} назад`;

  return `был(а) ${formatDayLabel(lastSeenAt).toLowerCase()}`;
}

/** «5 участников» */
export function formatMemberCount(count: number): string {
  return `${count} ${plural(count, 'участник', 'участника', 'участников')}`;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

/** Инициалы для аватара без картинки. */
export function initials(name: string): string {
  // Кавычки и знаки препинания в инициалы не годятся: название вроде
  // «9 "Б"» должно давать «9Б», а не «9"».
  const parts = name
    .split(/\s+/)
    .map((part) => part.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean);

  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

// Ссылки распознаём по http(s):// и по началу с www. — без экзотики,
// чтобы случайный текст в скобках не утаскивался в адрес.
const LINK_RE = /(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+)/gi;

/**
 * Превращает ссылки в кликабельные.
 *
 * Возвращает узлы React, а не HTML-строку: так текст сообщения физически не
 * может стать разметкой, и никакая вставка от пользователя не выполнится.
 */
export function linkify(text: string): ReactNode {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;

  for (const match of text.matchAll(LINK_RE)) {
    const index = match.index ?? 0;
    if (index > lastIndex) nodes.push(text.slice(lastIndex, index));

    let url = match[0];
    // Знак препинания в конце — почти всегда часть предложения, а не адреса.
    let trailing = '';
    while (url.length > 0 && '.,;:!?)]}»'.includes(url[url.length - 1])) {
      trailing = url[url.length - 1] + trailing;
      url = url.slice(0, -1);
    }

    const href = url.startsWith('http') ? url : `https://${url}`;
    nodes.push(
      createElement(
        'a',
        { key: `link-${key++}`, href, target: '_blank', rel: 'noopener noreferrer nofollow' },
        url,
      ),
    );
    if (trailing) nodes.push(trailing);

    lastIndex = index + match[0].length;
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  if (nodes.length === 0) return text;

  return createElement(Fragment, null, ...nodes);
}

/** Подсветка найденного фрагмента в результатах поиска. */
export function highlight(text: string, query: string): ReactNode {
  const needle = query.trim().toLowerCase();
  if (!needle) return text;

  const nodes: ReactNode[] = [];
  const haystack = text.toLowerCase();
  let from = 0;
  let key = 0;

  for (;;) {
    const index = haystack.indexOf(needle, from);
    if (index === -1) break;
    if (index > from) nodes.push(text.slice(from, index));
    nodes.push(
      createElement('mark', { key: `hit-${key++}` }, text.slice(index, index + needle.length)),
    );
    from = index + needle.length;
  }

  if (nodes.length === 0) return text;
  if (from < text.length) nodes.push(text.slice(from));
  return createElement(Fragment, null, ...nodes);
}
