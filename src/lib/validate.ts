import { config } from './config';

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

const USERNAME_RE = /^[a-z0-9_]{3,24}$/;

/** Приводит username к канону и проверяет его. */
export function parseUsername(raw: unknown): string {
  if (typeof raw !== 'string') throw new ValidationError('Укажите имя пользователя.');
  const username = raw.trim().toLowerCase();
  if (!USERNAME_RE.test(username)) {
    throw new ValidationError(
      'Имя пользователя: от 3 до 24 символов, только латиница, цифры и знак подчёркивания.',
    );
  }
  return username;
}

export function parseDisplayName(raw: unknown): string {
  if (typeof raw !== 'string') throw new ValidationError('Укажите отображаемое имя.');
  const name = raw.trim().replace(/\s+/g, ' ');
  if (name.length < 2) throw new ValidationError('Отображаемое имя слишком короткое.');
  if (name.length > config.limits.displayNameLength) {
    throw new ValidationError(`Отображаемое имя длиннее ${config.limits.displayNameLength} символов.`);
  }
  return name;
}

export function parsePassword(raw: unknown): string {
  if (typeof raw !== 'string') throw new ValidationError('Укажите пароль.');
  if (raw.length < 8) throw new ValidationError('Пароль должен быть не короче 8 символов.');
  if (raw.length > 200) throw new ValidationError('Пароль слишком длинный.');
  return raw;
}

/** Текст сообщения: обрезаем края, схлопываем длинные серии переводов строк. */
export function parseMessageBody(raw: unknown): string {
  if (typeof raw !== 'string') throw new ValidationError('Пустое сообщение.');
  const body = raw.replace(/\r\n/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim();
  if (body.length > config.limits.messageLength) {
    throw new ValidationError(`Сообщение длиннее ${config.limits.messageLength} символов.`);
  }
  return body;
}

export function parseGroupTitle(raw: unknown): string {
  if (typeof raw !== 'string') throw new ValidationError('Укажите название группы.');
  const title = raw.trim().replace(/\s+/g, ' ');
  if (title.length < 1) throw new ValidationError('Название группы не может быть пустым.');
  if (title.length > config.limits.groupTitleLength) {
    throw new ValidationError(`Название длиннее ${config.limits.groupTitleLength} символов.`);
  }
  return title;
}

export function parseBio(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const bio = raw.trim();
  if (bio.length > config.limits.bioLength) {
    throw new ValidationError(`О себе — не длиннее ${config.limits.bioLength} символов.`);
  }
  return bio;
}

/** Реакция — одна эмодзи, без текста и служебных символов. */
export function parseEmoji(raw: unknown): string {
  if (typeof raw !== 'string') throw new ValidationError('Некорректная реакция.');
  const emoji = raw.trim();
  // Сегментируем по графемам: эмодзи может состоять из нескольких кодовых точек.
  const segmenter = new Intl.Segmenter('ru', { granularity: 'grapheme' });
  const graphemes = [...segmenter.segment(emoji)];
  if (graphemes.length !== 1 || emoji.length > 16) {
    throw new ValidationError('Реакция должна быть одним символом эмодзи.');
  }
  if (/[\p{L}\p{N}\s]/u.test(emoji)) {
    throw new ValidationError('Реакция должна быть эмодзи, а не буквой или цифрой.');
  }
  return emoji;
}

/** Разбирает положительное целое из строки запроса. */
export function parseId(raw: unknown, field = 'id'): number {
  const id = typeof raw === 'number' ? raw : Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isInteger(id) || id <= 0) throw new ValidationError(`Некорректный ${field}.`);
  return id;
}

export function parseIdList(raw: unknown, field = 'id'): number[] {
  if (!Array.isArray(raw)) throw new ValidationError(`Ожидался список ${field}.`);
  return raw.map((value) => parseId(value, field));
}

/** Проверяет, что тип файла в списке разрешённых. */
export function isAllowedMime(mime: string): boolean {
  return config.allowedMimePrefixes.some((prefix) => mime.startsWith(prefix));
}

/** Детерминированный цвет аватарки по имени — чтобы у человека он не менялся. */
export function avatarColorFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return config.avatarColors[hash % config.avatarColors.length];
}
