'use client';

import { useState } from 'react';
import { api, ApiError } from '@/lib/client';

/** Вход и регистрация. После успеха перезагружаем страницу — сессия уже в куке. */
export default function AuthScreen({ inviteOnly }: { inviteOnly: boolean }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isRegister = mode === 'register';

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    setError(null);

    try {
      if (isRegister) {
        await api.post('/api/auth/register', { username, displayName, password, inviteCode });
      } else {
        await api.post('/api/auth/login', { username, password });
      }
      // Полная перезагрузка: серверный компонент сам подхватит новую сессию.
      window.location.reload();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Не удалось связаться с сервером.');
      setBusy(false);
    }
  }

  return (
    <main className="auth-screen">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="brand-mark">П</span>
          <div>
            <h1 className="auth-title">Перемена</h1>
          </div>
        </div>
        <p className="auth-subtitle">
          {isRegister ? 'Создайте аккаунт, чтобы начать переписку.' : 'Школьный мессенджер. Войдите, чтобы продолжить.'}
        </p>

        <form className="auth-form" onSubmit={submit}>
          {error ? <div className="error-banner">{error}</div> : null}

          {isRegister ? (
            <label className="field">
              <span className="field-label">Как вас зовут</span>
              <input
                className="input"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="Аня Смирнова"
                autoComplete="name"
                required
              />
            </label>
          ) : null}

          <label className="field">
            <span className="field-label">Имя пользователя</span>
            <input
              className="input"
              value={username}
              onChange={(event) => setUsername(event.target.value.toLowerCase())}
              placeholder="anya"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              required
            />
            {isRegister ? (
              <span className="field-hint">Латиница, цифры и знак подчёркивания. По нему вас найдут.</span>
            ) : null}
          </label>

          <label className="field">
            <span className="field-label">Пароль</span>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={isRegister ? 'new-password' : 'current-password'}
              required
            />
            {isRegister ? <span className="field-hint">Не короче 8 символов.</span> : null}
          </label>

          {isRegister && inviteOnly ? (
            <label className="field">
              <span className="field-label">Код приглашения</span>
              <input
                className="input"
                value={inviteCode}
                onChange={(event) => setInviteCode(event.target.value.toUpperCase())}
                placeholder="ШКОЛА-2026"
                required
              />
              <span className="field-hint">Регистрация закрыта — код выдаёт администратор.</span>
            </label>
          ) : null}

          <button className="btn" type="submit" disabled={busy}>
            {busy ? <span className="spinner" /> : null}
            {isRegister ? 'Создать аккаунт' : 'Войти'}
          </button>
        </form>

        <p className="auth-switch">
          {isRegister ? 'Уже есть аккаунт? ' : 'Ещё нет аккаунта? '}
          <button
            type="button"
            onClick={() => {
              setMode(isRegister ? 'login' : 'register');
              setError(null);
            }}
          >
            {isRegister ? 'Войти' : 'Зарегистрироваться'}
          </button>
        </p>
      </div>
    </main>
  );
}
