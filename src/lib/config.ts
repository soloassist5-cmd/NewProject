/** Настройки приложения, собранные в одном месте. */

export const config = {
  appName: 'Перемена',
  appTagline: 'Школьный мессенджер',

  /** Регистрация только по коду-приглашению. Управляется переменной INVITE_ONLY. */
  get inviteOnly(): boolean {
    return process.env.INVITE_ONLY === 'true';
  },

  /** Username, который автоматически получает роль администратора. */
  get adminUsername(): string {
    return (process.env.ADMIN_USERNAME ?? '').trim().toLowerCase();
  },

  session: {
    cookieName: 'peremena_session',
    /** Сколько живёт сессия. */
    maxAgeSeconds: 60 * 60 * 24 * 30, // 30 дней
  },

  limits: {
    messageLength: 4000,
    displayNameLength: 48,
    usernameLength: 24,
    bioLength: 200,
    groupTitleLength: 64,
    /** Максимальный размер одного файла. */
    fileSizeBytes: 8 * 1024 * 1024, // 8 МБ
    /** Сколько файлов можно приложить к одному сообщению. */
    attachmentsPerMessage: 6,
    /** Размер страницы истории сообщений. */
    messagePage: 40,
    /** Максимум участников группы. */
    groupMembers: 200,
  },

  /**
   * Лимиты на попытки. Школа обычно выходит в интернет через один общий адрес,
   * поэтому пороги «на IP» здесь щедрые: иначе класс, регистрирующийся на одном
   * уроке, заблокировал бы сам себя. От подбора пароля защищает лимит на
   * конкретный аккаунт — на него общий адрес не влияет.
   */
  rateLimits: {
    get registrationsPerHourPerIp(): number {
      return Number(process.env.REGISTRATION_LIMIT ?? 60);
    },
    loginsPerQuarterHourPerIp: 300,
    loginsPerQuarterHourPerAccount: 10,
  },

  presence: {
    /** Человек считается онлайн, если отметился за последние N секунд. */
    onlineWindowSeconds: 45,
    /** «Печатает…» живёт столько секунд после последнего сигнала. */
    typingTtlSeconds: 6,
  },

  realtime: {
    /** Сколько живёт одно SSE-соединение до планового переподключения.
     *  Держим ниже лимита времени выполнения функции на Vercel. */
    streamLifetimeMs: 50_000,
    /** Опрос журнала событий: часто, пока идёт разговор, реже — в тишине. */
    pollActiveMs: 600,
    pollIdleMs: 2_000,
    /** После скольких «пустых» опросов переходим на медленный интервал. */
    idleAfterEmptyPolls: 8,
  },

  /** Разрешённые типы вложений. */
  allowedMimePrefixes: ['image/', 'video/', 'audio/', 'text/', 'application/pdf'],

  /** Палитра для автоматических аватарок. */
  avatarColors: ['violet', 'blue', 'teal', 'green', 'amber', 'orange', 'rose', 'plum'] as const,
} as const;

export type AvatarColor = (typeof config.avatarColors)[number];
