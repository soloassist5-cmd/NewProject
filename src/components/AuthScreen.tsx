'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/client';
import { isMobile } from '@/lib/native';

interface AuthScreenProps {
  inviteOnly: boolean;
  schoolName: string;
  parallels: readonly number[];
  letters: readonly string[];
  /** Приложение развёрнуто, но не настроено — форму показывать бессмысленно. */
  setupProblem?: string | null;
}

/** Вход и регистрация. После успеха перезагружаем страницу — сессия уже в куке. */
export default function AuthScreen({
  inviteOnly,
  schoolName,
  parallels,
  letters,
  setupProblem = null,
}: AuthScreenProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [parallel, setParallel] = useState<string>('');
  const [letter, setLetter] = useState<string>(letters[0] ?? '');
  const [inviteCode, setInviteCode] = useState('');
  // По умолчанию вход запоминается: со своего телефона пароль каждый раз
  // вводить незачем. Галочку ставят на общем компьютере.
  const [sharedComputer, setSharedComputer] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Вопрос про чужое устройство уместен только за компьютером: телефон —
  // вещь личная, и лишний флажок на маленьком экране только мешает.
  const [sharedOffered, setSharedOffered] = useState(false);

  useEffect(() => setSharedOffered(!isMobile()), []);

  const isRegister = mode === 'register';

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
          grade: `${parallel}${letter}`,
          inviteCode,
          sharedComputer,
        });
      } else {
        await api.post('/api/auth/login', { username, password, sharedComputer });
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
        {/* Герб гимназии — картинкой, а не буквой в цветном квадрате. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="auth-emblem" src="/emblem.png" alt="" width={84} height={84} />

        <div className="auth-heading">
          <h1 className="auth-title">ГимРум</h1>
          <p className="auth-school">{schoolName}</p>
          <div className="auth-rule" />
          <p className="auth-subtitle">
            {isRegister
              ? 'Придумайте логин и пароль и выберите свой класс.'
              : 'Свой чат гимназии. Войдите, чтобы продолжить.'}
          </p>
        </div>

        {setupProblem ? (
          <div className="setup-notice">
            <strong>Приложение ещё не настроено</strong>
            <p>{setupProblem}</p>
            <p className="setup-notice-hint">
              Переменные подхватывает только новая сборка: если вы их уже добавили, сделайте
              Redeploy.
            </p>
          </div>
        ) : (
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
                  required
                >
                  <option value="" disabled>
                    Параллель
                  </option>
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
                {parallel === ''
                  ? 'Выберите параллель и литеру.'
                  : `Ваш класс: ${parallel}${letter}`}
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

          {sharedOffered ? (
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={sharedComputer}
              onChange={(event) => setSharedComputer(event.target.checked)}
            />
            <span>
              Чужой компьютер
              <span className="field-hint">
                {sharedComputer
                  ? 'Выход произойдёт сам, когда браузер закроют.'
                  : 'Отметьте в компьютерном классе — иначе следующий за этим компьютером попадёт в вашу переписку.'}
              </span>
            </span>
          </label>
          ) : null}

          <button className="btn" type="submit" disabled={busy}>
            {busy ? <span className="spinner" /> : null}
            {isRegister ? 'Создать аккаунт' : 'Войти'}
          </button>
        </form>
        )}

        {setupProblem ? null : (
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
        )}
      </div>
    </main>
  );
}
