import { config } from './config';

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

const USERNAME_RE = new RegExp(
  `^[a-z0-9_]{${config.limits.usernameMinLength},${config.limits.usernameLength}}$`,
);

/**
 * Приводит логин к канону и проверяет его.
 *
 * Ведущая «собачка» срезается: её набирают по привычке из других мессенджеров,
 * и отказывать из-за неё бессмысленно.
 */
export function parseUsername(raw: unknown): string {
  if (typeof raw !== 'string') throw new ValidationError('Укажите имя пользователя.');
  const username = raw.trim().toLowerCase().replace(/^@+/, '');
  if (!USERNAME_RE.test(username)) {
    throw new ValidationError(
      `Имя пользователя: от ${config.limits.usernameMinLength} до ${config.limits.usernameLength} ` +
        'символов, только латиница, цифры и знак подчёркивания.',
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

/**
 * Класс вида «9О», «11Э». Пустая строка допустима — так отмечают учителей и
 * других сотрудников гимназии, у которых класса нет.
 *
 * Сами себе такой аккаунт не заводят: при регистрации класс обязателен
 * (см. parseStudentGrade), а аккаунты сотрудников создаёт администратор.
 */
export function parseGrade(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  if (typeof raw !== 'string') throw new ValidationError('Некорректно указан класс.');

  const grade = raw.trim().toUpperCase().replace(/\s+/g, '');
  if (grade === '') return '';

  // Латинские «O», «E» и «C» выглядят как русские: приводим к кириллице,
  // иначе «9O» с латинской O не совпал бы с «9О» ни в списке, ни в поиске.
  const normalized = grade.replace(/O/g, 'О').replace(/E/g, 'Э').replace(/C/g, 'С');

  const match = normalized.match(/^(\d{1,2})([А-Я])$/);
  if (!match) throw new ValidationError('Класс указывается так: 9О, 11Э.');

  const parallel = Number(match[1]);
  const letter = match[2];

  if (!(config.grades.parallels as readonly number[]).includes(parallel)) {
    throw new ValidationError('В гимназии есть классы с 1 по 11.');
  }
  if (!(config.grades.letters as readonly string[]).includes(letter)) {
    throw new ValidationError(`Литера класса — одна из: ${config.grades.letters.join(', ')}.`);
  }

  return `${parallel}${letter}`;
}

/** Класс при регистрации: обязателен, «без класса» тут не бывает. */
export function parseStudentGrade(raw: unknown): string {
  const grade = parseGrade(raw);
  if (!grade) throw new ValidationError('Выберите свой класс.');
  return grade;
}

/**
 * Роль аккаунта, который заводит администратор.
 *
 * Администратора через панель не выдают: эта роль достаётся первому
 * зарегистрировавшемуся или тому, кто указан в ADMIN_USERNAME. Так учётная
 * запись с правами модератора не может появиться в один клик — в том числе
 * если чужой рукой открыта админская вкладка.
 */
export function parseNewUserRole(raw: unknown): 'member' | 'teacher' {
  if (raw === undefined || raw === null || raw === '') return 'member';
  if (raw === 'member' || raw === 'teacher') return raw;
  throw new ValidationError('Роль аккаунта: ученик или учитель.');
}

/** Код приглашения в группу: приводим к канону, чтобы регистр и пробелы не мешали. */
export function parseJoinCode(raw: unknown): string {
  if (typeof raw !== 'string') throw new ValidationError('Введите код группы.');

  const code = raw.trim().toUpperCase().replace(/[\s-]/g, '');
  if (code.length !== config.joinCode.length) {
    throw new ValidationError(`Код состоит из ${config.joinCode.length} символов.`);
  }
  if (![...code].every((char) => config.joinCode.alphabet.includes(char))) {
    throw new ValidationError('В коде есть символы, которых в кодах не бывает. Проверьте ещё раз.');
  }

  return code;
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

/**
 * Разбирает положительное целое из строки запроса.
 *
 * Разбор строгий: `parseInt` молча превратил бы «1 OR 1=1» в 1, а «12abc» в 12.
 * Само по себе это не давало бы доступа к чужому (запросы параметризованы, а
 * права проверяются отдельно), но такой мусор должен отвергаться сразу, а не
 * приниматься за случайно похожий идентификатор.
 */
export function parseId(raw: unknown, field = 'id'): number {
  if (typeof raw === 'number') {
    if (!Number.isSafeInteger(raw) || raw <= 0) throw new ValidationError(`Некорректный ${field}.`);
    return raw;
  }

  const text = String(raw ?? '').trim();
  if (!/^[0-9]{1,15}$/.test(text)) throw new ValidationError(`Некорректный ${field}.`);

  const id = Number(text);
  if (!Number.isSafeInteger(id) || id <= 0) throw new ValidationError(`Некорректный ${field}.`);
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
