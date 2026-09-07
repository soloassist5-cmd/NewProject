'use client';

import { useEffect, useRef, useState } from 'react';
import Avatar from './Avatar';
import { CloseIcon, LogoutIcon } from './Icons';
import { api, ApiError } from '@/lib/client';
import { formatFileSize, formatListTime, roleLabel } from '@/lib/format';
import { currentSurface, type Surface } from '@/lib/native';
import type { GradesConfig } from './Messenger';
import type { Attachment, Me } from '@/lib/types';

const COLORS = ['violet', 'blue', 'teal', 'green', 'amber', 'orange', 'rose', 'plum'];

interface ProfileDialogProps {
  me: Me;
  grades: GradesConfig;
  onClose: () => void;
  onUpdated: (me: Me) => void;
}

export default function ProfileDialog({ me, grades, onClose, onUpdated }: ProfileDialogProps) {
  const [displayName, setDisplayName] = useState(me.displayName);
  const [username, setUsername] = useState(me.username);
  const [bio, setBio] = useState(me.bio);
  // Класс хранится строкой «9О», а выбирается двумя списками.
  const [parallel, setParallel] = useState(me.grade ? me.grade.replace(/\D+$/, '') : '');
  const [letter, setLetter] = useState(
    me.grade ? me.grade.replace(/^\d+/, '') : (grades.letters[0] ?? ''),
  );
  const [avatarColor, setAvatarColor] = useState(me.avatarColor);
  const [avatarFileId, setAvatarFileId] = useState(me.avatarFileId);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [notificationState, setNotificationState] = useState<NotificationPermission | 'unsupported'>(
    'default',
  );
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Сотрудник гимназии: класса нет и выбирать его незачем. Первый
  // зарегистрировавшийся становится администратором, оставаясь учеником, —
  // поэтому смотрим не только на роль, но и на класс.
  const staffTitle = roleLabel(me.role);
  const isStaff = staffTitle !== '' && me.grade === '';

  useEffect(() => {
    setNotificationState(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  async function uploadAvatar(file: File) {
    const form = new FormData();
    form.append('file', file);
    try {
      const data = await api.post<{ file: Attachment }>('/api/files', form);
      setAvatarFileId(data.file.id);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Не удалось загрузить картинку.');
    }
  }

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);

    const payload: Record<string, unknown> = {
      displayName,
      bio,
      avatarColor,
      avatarFileId,
      grade: parallel === '' ? '' : `${parallel}${letter}`,
    };
    // Логин шлём, только если его действительно поменяли: иначе каждое
    // сохранение профиля упиралось бы в паузу между сменами.
    if (username !== me.username) payload.username = username;
    if (newPassword) {
      payload.newPassword = newPassword;
      payload.currentPassword = currentPassword;
    }

    try {
      const data = await api.patch<{ user: Me }>('/api/users/me', payload);
      onUpdated({ ...me, ...data.user });
      setCurrentPassword('');
      setNewPassword('');
      setSaved(true);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Не удалось сохранить профиль.');
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await api.post('/api/auth/logout').catch(() => {});
    window.location.reload();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal
        aria-label="Профиль"
      >
        <div className="modal-header">
          <h2 className="modal-title">Профиль</h2>
          <button className="btn-ghost" onClick={onClose} aria-label="Закрыть">
            <CloseIcon />
          </button>
        </div>

        <div className="modal-body">
          {error ? <div className="error-banner">{error}</div> : null}

          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <Avatar name={displayName} color={avatarColor} fileId={avatarFileId} size={64} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <button className="btn btn-quiet" onClick={() => fileInputRef.current?.click()}>
                {avatarFileId ? 'Заменить фото' : 'Выбрать из галереи'}
              </button>
              {avatarFileId ? (
                <button className="btn-ghost" onClick={() => setAvatarFileId(null)}>
                  Убрать фото
                </button>
              ) : null}
            </div>
            {/* Одна картинка: без multiple и без capture — телефон предложит
                галерею, а не сразу камеру. */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void uploadAvatar(file);
                event.target.value = '';
              }}
            />
          </div>

          {!avatarFileId ? (
            <div className="field">
              <span className="field-label">Цвет аватара</span>
              <div className="color-grid">
                {COLORS.map((color) => (
                  <button
                    key={color}
                    className={`avatar avatar-${color} color-swatch${color === avatarColor ? ' is-selected' : ''}`}
                    onClick={() => setAvatarColor(color)}
                    aria-label={`Цвет ${color}`}
                  />
                ))}
              </div>
            </div>
          ) : null}

          <label className="field">
            <span className="field-label">Имя</span>
            <input
              className="input"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </label>

          <label className="field">
            <span className="field-label">О себе</span>
            <input
              className="input"
              value={bio}
              onChange={(event) => setBio(event.target.value)}
              placeholder="Например: редколлегия, волейбол"
            />
          </label>

          {/* У учителя класса нет — вместо выбора показываем, кто он. */}
          {isStaff ? (
            <div className="field">
              <span className="field-label">Статус</span>
              <input className="input" value={staffTitle} disabled />
              <span className="field-hint">Аккаунт завёл администратор гимназии.</span>
            </div>
          ) : (
            <div className="field">
              <span className="field-label">Класс</span>
              <div className="grade-picker">
                <select
                  className="input"
                  value={parallel}
                  onChange={(event) => setParallel(event.target.value)}
                  aria-label="Параллель"
                >
                  <option value="" disabled>
                    Параллель
                  </option>
                  {grades.parallels.map((value) => (
                    <option key={value} value={value}>
                      {value} класс
                    </option>
                  ))}
                </select>
                <select
                  className="input"
                  value={letter}
                  onChange={(event) => setLetter(event.target.value)}
                  aria-label="Литера класса"
                >
                  {grades.letters.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          <label className="field">
            <span className="field-label">Логин</span>
            <div className="input-prefix">
              <span aria-hidden>@</span>
              <input
                className="input"
                value={username}
                onChange={(event) =>
                  setUsername(event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))
                }
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                aria-label="Логин"
              />
            </div>
            <span className="field-hint">
              По нему вас находят в поиске. Менять можно раз в неделю; прежний логин на два
              месяца остаётся закреплён за вами, чужим он не достанется.
            </span>
          </label>

          <div className="field">
            <span className="field-label">Уведомления</span>
            <NotificationSettings state={notificationState} onChange={setNotificationState} />
          </div>

          <details>
            <summary style={{ cursor: 'pointer', color: 'var(--text-muted)', fontSize: 14 }}>
              Сменить пароль
            </summary>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
              <label className="field">
                <span className="field-label">Текущий пароль</span>
                <input
                  className="input"
                  type="password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  autoComplete="current-password"
                />
              </label>
              <label className="field">
                <span className="field-label">Новый пароль</span>
                <input
                  className="input"
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  autoComplete="new-password"
                />
                <span className="field-hint">
                  После смены со всех остальных устройств придётся войти заново.
                </span>
              </label>
            </div>
          </details>

          <StorageMeter />

          <DeviceList />

          <button className="btn btn-danger" onClick={() => void logout()}>
            <LogoutIcon /> Выйти из аккаунта
          </button>
        </div>

        <div className="modal-footer">
          {saved ? (
            <span style={{ marginRight: 'auto', color: 'var(--text-muted)', fontSize: 13 }}>
              Сохранено
            </span>
          ) : null}
          <button className="btn btn-quiet" onClick={onClose}>
            Закрыть
          </button>
          <button className="btn" onClick={() => void save()} disabled={busy}>
            {busy ? <span className="spinner" /> : null}
            Сохранить
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Сколько места занимают отправленные файлы.
 *
 * Картинки и документы лежат в той же базе, что и переписка, и места там
 * немного — одно на всю гимназию. Пока полоски нет, отказ «место кончилось»
 * приходит неожиданно; с ней видно заранее, к чему идёт дело.
 */
function StorageMeter() {
  const [usage, setUsage] = useState<{
    usedBytes: number;
    quotaBytes: number;
    freeBytes: number;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await api.get<{ storage: typeof usage }>('/api/files');
        if (!cancelled) setUsage(data.storage);
      } catch {
        // Не показать полоску не страшно — это справка, а не настройка.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!usage) return null;

  const share = Math.min(100, Math.round((usage.usedBytes / usage.quotaBytes) * 100));

  return (
    <div className="field">
      <span className="field-label">Файлы</span>
      <div className="storage-bar" role="img" aria-label={`Занято ${share} процентов`}>
        <div className="storage-bar-fill" style={{ width: `${Math.max(share, 1)}%` }} />
      </div>
      <span className="field-hint">
        {formatFileSize(usage.usedBytes)} из {formatFileSize(usage.quotaBytes)}. Картинки и
        документы хранятся в той же базе, что и переписка, поэтому места немного — и оно общее на
        всю гимназию.
      </span>
    </div>
  );
}

interface DeviceSession {
  id: string;
  device: string;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  persistent: boolean;
  current: boolean;
}

/**
 * Где ещё открыт мой аккаунт.
 *
 * Смысл раздела — не статистика, а одна кнопка: «я забыл выйти на школьном
 * компьютере». Пока такого списка нет, человек об этом даже не узнает.
 */
function DeviceList() {
  const [sessions, setSessions] = useState<DeviceSession[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ sessions: DeviceSession[] }>('/api/sessions')
      .then((data) => setSessions(data.sessions))
      .catch(() => setSessions([]));
  }, []);

  async function closeOthers() {
    setBusy(true);
    try {
      const data = await api.delete<{ closed: number; sessions: DeviceSession[] }>('/api/sessions');
      setSessions(data.sessions);
      setNotice(
        data.closed === 0
          ? 'Других устройств и не было.'
          : `Закрыто устройств: ${data.closed}. Там придётся войти заново.`,
      );
    } catch {
      setNotice('Не удалось закрыть другие устройства.');
    } finally {
      setBusy(false);
    }
  }

  if (!sessions) return null;

  const others = sessions.filter((item) => !item.current).length;

  return (
    <details>
      <summary style={{ cursor: 'pointer', color: 'var(--text-muted)', fontSize: 14 }}>
        Устройства{others > 0 ? ` (ещё ${others})` : ''}
      </summary>

      <div style={{ marginTop: 12 }}>
        {notice ? <div className="notice-banner">{notice}</div> : null}

        <div className="device-list">
          {sessions.map((item) => (
            <div key={item.id} className="device-row">
              <div>
                <div className="device-name">
                  {item.device}
                  {item.current ? <span className="admin-tag">это устройство</span> : null}
                  {!item.persistent ? <span className="admin-tag">до закрытия браузера</span> : null}
                </div>
                <div className="device-meta">
                  Вход: {formatListTime(item.createdAt)} · последняя активность:{' '}
                  {formatListTime(item.lastUsedAt)}
                </div>
              </div>
            </div>
          ))}
        </div>

        {others > 0 ? (
          <button
            className="btn btn-quiet btn-small"
            style={{ marginTop: 10 }}
            onClick={() => void closeOthers()}
            disabled={busy}
          >
            {busy ? <span className="spinner" /> : null}
            Выйти на других устройствах
          </button>
        ) : (
          <p className="field-hint" style={{ marginTop: 10 }}>
            Аккаунт открыт только здесь.
          </p>
        )}
      </div>
    </details>
  );
}

/**
 * Раздел «Уведомления».
 *
 * Подсказка должна вести туда, где настройка действительно есть. Раньше во всех
 * случаях писали «разрешите в настройках браузера» — а в приложении браузера
 * нет, и человек упирался в тупик: сделать по такой подсказке нечего.
 *
 * Мест, где живёт эта настройка, три, и они не похожи друг на друга:
 * в окне на Windows уведомления показывает само приложение и разрешение ему не
 * нужно вовсе; в приложении для Android настройка лежит в системных настройках
 * телефона; в браузере — в его собственных разрешениях для сайта.
 */
function NotificationSettings({
  state,
  onChange,
}: {
  state: NotificationPermission | 'unsupported';
  onChange: (next: NotificationPermission) => void;
}) {
  const [surface, setSurface] = useState<Surface>('browser');

  // Определяем окружение уже в браузере: на сервере ни window, ни document нет.
  useEffect(() => setSurface(currentSurface()), []);

  // Своё окно на Windows: уведомления показывает приложение, а не страница, —
  // значок в панели задач мигает. Разрешение браузера тут ни при чём, и его
  // отказ (WebView2 всегда отвечает «запрещено») ничего не меняет.
  if (surface === 'windows-app') {
    return (
      <span className="field-hint">
        Включены: при новом сообщении значок «ГимРума» мигает в панели задач. Отдельное
        разрешение не нужно.
      </span>
    );
  }

  if (state === 'granted') {
    return (
      <span className="field-hint">
        Включены: сообщения приходят, даже когда мессенджер свёрнут.
      </span>
    );
  }

  if (state === 'unsupported') {
    return <span className="field-hint">Здесь уведомления не поддерживаются.</span>;
  }

  if (state === 'denied') {
    return (
      <span className="field-hint">
        {surface === 'android-app'
          ? 'Запрещены в настройках телефона. Настройки → Приложения → ГимРум → Уведомления — и включите их там.'
          : surface === 'android-browser'
            ? 'Запрещены для этого сайта. Нажмите на замок слева от адреса → Разрешения → Уведомления.'
            : 'Запрещены для этого сайта. Нажмите на замок слева от адреса и разрешите уведомления.'}
      </span>
    );
  }

  return (
    <>
      <button
        className="btn btn-quiet"
        onClick={async () => onChange(await Notification.requestPermission())}
      >
        Разрешить уведомления
      </button>
      {surface === 'android-app' ? (
        <span className="field-hint">Телефон спросит разрешение — подтвердите его.</span>
      ) : null}
    </>
  );
}
