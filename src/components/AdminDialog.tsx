'use client';

import { useCallback, useEffect, useState } from 'react';
import Avatar from './Avatar';
import { CheckIcon, CloseIcon, KeyIcon, LockIcon, SearchIcon } from './Icons';
import { api, ApiError } from '@/lib/client';
import { roleLabel } from '@/lib/format';
import type { GradesConfig } from './Messenger';
import type { Me } from '@/lib/types';

export interface AdminUser {
  id: number;
  username: string;
  displayName: string;
  grade: string;
  role: string;
  avatarColor: string;
  blocked: boolean;
  blockedAt: string | null;
  blockedReason: string;
  createdAt: string;
  lastSeenAt: string | null;
}

interface AdminDialogProps {
  me: Me;
  grades: GradesConfig;
  onClose: () => void;
}

/**
 * Панель администратора: кто есть в гимназии, блокировка, новый пароль
 * взамен забытого и заведение аккаунтов учителям.
 */
export default function AdminDialog({ me, grades, onClose }: AdminDialogProps) {
  const [tab, setTab] = useState<'people' | 'create'>('people');
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const load = useCallback(async (search: string) => {
    setError(null);
    try {
      const data = await api.get<{ users: AdminUser[] }>(
        `/api/admin/users?q=${encodeURIComponent(search.trim())}`,
      );
      setUsers(data.users);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Не удалось получить список.');
    } finally {
      setLoading(false);
    }
  }, []);

  // Поиск с задержкой — как в боковой панели, чтобы не дёргать сервер на букву.
  useEffect(() => {
    const timer = setTimeout(() => void load(query), query ? 250 : 0);
    return () => clearTimeout(timer);
  }, [query, load]);

  function replaceUser(updated: AdminUser) {
    setUsers((list) => list.map((item) => (item.id === updated.id ? updated : item)));
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal modal-wide"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal
        aria-label="Панель администратора"
      >
        <div className="modal-header">
          <h2 className="modal-title">Администрирование</h2>
          <button className="btn-ghost" onClick={onClose} aria-label="Закрыть">
            <CloseIcon />
          </button>
        </div>

        <div className="tab-row" role="tablist">
          <button
            className={`tab${tab === 'people' ? ' is-active' : ''}`}
            onClick={() => setTab('people')}
            role="tab"
            aria-selected={tab === 'people'}
          >
            Аккаунты
          </button>
          <button
            className={`tab${tab === 'create' ? ' is-active' : ''}`}
            onClick={() => setTab('create')}
            role="tab"
            aria-selected={tab === 'create'}
          >
            Создать аккаунт
          </button>
        </div>

        <div className="modal-body">
          {error ? <div className="error-banner">{error}</div> : null}
          {notice ? <div className="notice-banner">{notice}</div> : null}

          {tab === 'people' ? (
            <>
              <div className="search-box">
                <SearchIcon />
                <input
                  className="input"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Поиск по имени или логину"
                  type="search"
                  aria-label="Поиск по аккаунтам"
                />
              </div>

              {loading ? (
                <p className="list-section-title">Загружаем…</p>
              ) : users.length === 0 ? (
                <p className="list-section-title">Никого не нашлось</p>
              ) : (
                <div className="admin-list">
                  {users.map((account) => (
                    <AccountRow
                      key={account.id}
                      account={account}
                      isMe={account.id === me.id}
                      onChanged={(updated, message) => {
                        replaceUser(updated);
                        setNotice(message);
                        setError(null);
                      }}
                      onFailed={(message) => {
                        setError(message);
                        setNotice(null);
                      }}
                    />
                  ))}
                </div>
              )}
            </>
          ) : (
            <CreateAccountForm
              grades={grades}
              onCreated={(created) => {
                setTab('people');
                setQuery('');
                setNotice(`Аккаунт @${created.username} создан.`);
                setError(null);
                void load('');
              }}
            />
          )}
        </div>

        <div className="modal-footer">
          <button className="btn btn-quiet" onClick={onClose}>
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}

function AccountRow({
  account,
  isMe,
  onChanged,
  onFailed,
}: {
  account: AdminUser;
  isMe: boolean;
  onChanged: (user: AdminUser, message: string) => void;
  onFailed: (message: string) => void;
}) {
  const [action, setAction] = useState<'none' | 'block' | 'password'>('none');
  const [reason, setReason] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  // Свой аккаунт и аккаунты других администраторов панель не трогает — это же
  // проверяет и сервер, здесь просто не показываем кнопки.
  const locked = isMe || account.role === 'admin';
  // Должность уже стоит ярлыком у имени — во второй строке её не повторяем.
  const subtitle = account.grade || (account.role === 'member' ? 'без класса' : '');

  async function send(payload: Record<string, unknown>, message: string) {
    setBusy(true);
    try {
      const data = await api.patch<{ user: AdminUser }>(`/api/admin/users/${account.id}`, payload);
      onChanged(data.user, message);
      setAction('none');
      setReason('');
      setPassword('');
    } catch (caught) {
      onFailed(caught instanceof ApiError ? caught.message : 'Не удалось изменить аккаунт.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`admin-row${account.blocked ? ' is-blocked' : ''}`}>
      <div className="admin-row-main">
        <Avatar name={account.displayName} color={account.avatarColor} fileId={null} size={36} />
        <div className="admin-row-body">
          <div className="admin-row-name">
            {account.displayName}
            {account.blocked ? (
              <span className="admin-tag admin-tag-blocked">
                <LockIcon /> Заблокирован
              </span>
            ) : null}
            {account.role !== 'member' ? (
              <span className="admin-tag">{roleLabel(account.role)}</span>
            ) : null}
          </div>
          <div className="admin-row-meta">
            @{account.username}
            {subtitle ? ` · ${subtitle}` : ''}
          </div>
          {account.blocked && account.blockedReason ? (
            <div className="admin-row-reason">Причина: {account.blockedReason}</div>
          ) : null}
        </div>

        {locked ? (
          <span className="admin-row-note">{isMe ? 'это вы' : 'администратор'}</span>
        ) : (
          <div className="admin-row-actions">
            <button
              className="btn btn-quiet btn-small"
              onClick={() => setAction(action === 'password' ? 'none' : 'password')}
            >
              <KeyIcon /> Пароль
            </button>
            {account.blocked ? (
              <button
                className="btn btn-quiet btn-small"
                disabled={busy}
                onClick={() => void send({ blocked: false }, `@${account.username} разблокирован.`)}
              >
                <CheckIcon /> Разблокировать
              </button>
            ) : (
              <button
                className="btn btn-danger btn-small"
                onClick={() => setAction(action === 'block' ? 'none' : 'block')}
              >
                <LockIcon /> Заблокировать
              </button>
            )}
          </div>
        )}
      </div>

      {action === 'block' ? (
        <form
          className="admin-row-form"
          onSubmit={(event) => {
            event.preventDefault();
            void send({ blocked: true, reason }, `@${account.username} заблокирован.`);
          }}
        >
          <input
            className="input"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Причина — её увидит человек при входе (необязательно)"
            maxLength={200}
          />
          <button className="btn btn-danger btn-small" type="submit" disabled={busy}>
            {busy ? <span className="spinner" /> : null}
            Заблокировать
          </button>
          <button className="btn btn-quiet btn-small" type="button" onClick={() => setAction('none')}>
            Отмена
          </button>
        </form>
      ) : null}

      {action === 'password' ? (
        <form
          className="admin-row-form"
          onSubmit={(event) => {
            event.preventDefault();
            void send({ password }, `Пароль @${account.username} изменён.`);
          }}
        >
          <input
            className="input"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Новый пароль, не короче 8 символов"
            autoComplete="new-password"
            minLength={8}
            required
          />
          <button className="btn btn-small" type="submit" disabled={busy}>
            {busy ? <span className="spinner" /> : null}
            Сохранить
          </button>
          <button className="btn btn-quiet btn-small" type="button" onClick={() => setAction('none')}>
            Отмена
          </button>
        </form>
      ) : null}

      {action === 'password' ? (
        <p className="admin-row-hint">
          Текущий пароль не нужен. Все устройства этого человека выйдут из аккаунта — новый
          пароль придётся продиктовать ему лично.
        </p>
      ) : null}
    </div>
  );
}

function CreateAccountForm({
  grades,
  onCreated,
}: {
  grades: GradesConfig;
  onCreated: (user: AdminUser) => void;
}) {
  const [role, setRole] = useState<'teacher' | 'member'>('teacher');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [parallel, setParallel] = useState<string>('');
  const [letter, setLetter] = useState<string>(grades.letters[0] ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    setError(null);
    try {
      const data = await api.post<{ user: AdminUser }>('/api/admin/users', {
        username,
        displayName,
        password,
        role,
        grade: role === 'teacher' ? '' : `${parallel}${letter}`,
      });
      setUsername('');
      setDisplayName('');
      setPassword('');
      setParallel('');
      onCreated(data.user);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Не удалось создать аккаунт.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      {error ? <div className="error-banner">{error}</div> : null}

      <div className="field">
        <span className="field-label">Кому заводим аккаунт</span>
        <div className="segmented">
          <button
            type="button"
            className={`segment${role === 'teacher' ? ' is-active' : ''}`}
            onClick={() => setRole('teacher')}
          >
            Учителю
          </button>
          <button
            type="button"
            className={`segment${role === 'member' ? ' is-active' : ''}`}
            onClick={() => setRole('member')}
          >
            Ученику
          </button>
        </div>
        <span className="field-hint">
          {role === 'teacher'
            ? 'Класс не указывается — рядом с именем будет «Учитель».'
            : 'Обычно ученики регистрируются сами. Здесь — если не получилось.'}
        </span>
      </div>

      <label className="field">
        <span className="field-label">Имя</span>
        <input
          className="input"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          placeholder="Мария Ивановна"
          required
        />
      </label>

      <label className="field">
        <span className="field-label">Логин</span>
        <input
          className="input"
          value={username}
          onChange={(event) => setUsername(event.target.value.toLowerCase())}
          placeholder="ivanova"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
        />
        <span className="field-hint">Латиница, цифры и знак подчёркивания. По нему входят.</span>
      </label>

      <label className="field">
        <span className="field-label">Пароль</span>
        <input
          className="input"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Не короче 8 символов"
          autoComplete="new-password"
          minLength={8}
          required
        />
        <span className="field-hint">
          Продиктуйте его лично — человек сменит пароль в профиле после первого входа.
        </span>
      </label>

      {role === 'member' ? (
        <div className="field">
          <span className="field-label">Класс</span>
          <div className="grade-picker">
            <select
              className="input"
              value={parallel}
              onChange={(event) => setParallel(event.target.value)}
              aria-label="Параллель"
              required
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
      ) : null}

      <button className="btn" type="submit" disabled={busy}>
        {busy ? <span className="spinner" /> : null}
        Создать аккаунт
      </button>
    </form>
  );
}
