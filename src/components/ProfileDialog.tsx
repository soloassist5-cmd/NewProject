'use client';

import { useEffect, useRef, useState } from 'react';
import Avatar from './Avatar';
import { CloseIcon, LogoutIcon } from './Icons';
import { api, ApiError } from '@/lib/client';
import { roleLabel } from '@/lib/format';
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
            {notificationState === 'unsupported' ? (
              <span className="field-hint">Браузер не поддерживает уведомления.</span>
            ) : notificationState === 'granted' ? (
              <span className="field-hint">Включены: сообщения приходят, даже когда вкладка свёрнута.</span>
            ) : notificationState === 'denied' ? (
              <span className="field-hint">
                Запрещены в настройках браузера. Разрешите их для этого сайта, чтобы получать оповещения.
              </span>
            ) : (
              <button
                className="btn btn-quiet"
                onClick={async () => setNotificationState(await Notification.requestPermission())}
              >
                Разрешить уведомления
              </button>
            )}
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
