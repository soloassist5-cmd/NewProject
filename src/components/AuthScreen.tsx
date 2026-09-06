'use client';

import { useState } from 'react';
import { api, ApiError } from '@/lib/client';

interface AuthScreenProps {
  inviteOnly: boolean;
  schoolName: string;
  parallels: readonly number[];
  letters: readonly string[];
  staffLabel: string;
}

/** Вход и регистрация. После успеха перезагружаем страницу — сессия уже в куке. */
export default function AuthScreen({
  inviteOnly,
  schoolName,
  parallels,
  letters,
  staffLabel,
}: AuthScreenProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [parallel, setParallel] = useState<string>('');
  const [letter, setLetter] = useState<string>(letters[0] ?? '');
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isRegister = mode === 'register';
  const isStaff = parallel === '';

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    setError(null);

    try {
      if (isRegister) {
        await api.post('/api/auth/register', {
          username,
          password,
          grade: isStaff ? '' : `${parallel}${letter}`,
          inviteCode,
        });
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
            <p className="auth-school">{schoolName}</p>
          </div>
        </div>
        <p className="auth-subtitle">
          {isRegister
            ? 'Придумайте логин и пароль и выберите свой класс.'
            : 'Мессенджер для своих. Войдите, чтобы продолжить.'}
        </p>

        <form className="auth-form" onSubmit={submit}>
          {error ? <div className="error-banner">{error}</div> : null}

          <label className="field">
            <span className="field-label">Логин</span>
            <input
              className="input"
              value={username}
              onChange={(event) => setUsername(event.target.value.toLowerCase())}
              placeholder="anya"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              inputMode="text"
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

          {isRegister ? (
            <div className="field">
              <span className="field-label">Класс</span>
              <div className="grade-picker">
                <select
                  className="input"
                  value={parallel}
                  onChange={(event) => setParallel(event.target.value)}
                  aria-label="Параллель"
                >
                  <option value="">{staffLabel}</option>
                  {parallels.map((value) => (
                    <option key={value} value={value}>
                      {value} класс
                    </option>
                  ))}
                </select>

                <select
                  className="input"
                  value={letter}
                  onChange={(event) => setLetter(event.target.value)}
                  disabled={isStaff}
                  aria-label="Литера класса"
                >
                  {letters.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </div>
              <span className="field-hint">
                {isStaff ? 'Класс не указывается.' : `Ваш класс: ${parallel}${letter}`}
              </span>
            </div>
          ) : null}

          {isRegister && inviteOnly ? (
            <label className="field">
              <span className="field-label">Код приглашения</span>
              <input
                className="input"
                value={inviteCode}
                onChange={(event) => setInviteCode(event.target.value.toUpperCase())}
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
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
