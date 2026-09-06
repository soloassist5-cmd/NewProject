'use client';

import { useEffect, useState } from 'react';
import Avatar from './Avatar';
import { CloseIcon, SearchIcon } from './Icons';
import { api, ApiError } from '@/lib/client';
import type { Person } from '@/lib/types';

interface NewChatDialogProps {
  onClose: () => void;
  onStartDirect: (personId: number) => Promise<void>;
  onCreateGroup: (title: string, memberIds: number[]) => Promise<void>;
  onJoinByCode: (code: string) => Promise<void>;
}

export default function NewChatDialog({
  onClose,
  onStartDirect,
  onCreateGroup,
  onJoinByCode,
}: NewChatDialogProps) {
  const [mode, setMode] = useState<'direct' | 'group' | 'code'>('direct');
  const [code, setCode] = useState('');
  const [people, setPeople] = useState<Person[]>([]);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Person[]>([]);
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (mode === 'code') return;

    const timer = setTimeout(async () => {
      try {
        const data = await api.get<{ people: Person[] }>(
          `/api/users?search=${encodeURIComponent(search)}`,
        );
        setPeople(data.people);
      } catch {
        setPeople([]);
      }
    }, search ? 220 : 0);

    return () => clearTimeout(timer);
  }, [search, mode]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  function togglePerson(person: Person) {
    setSelected((prev) =>
      prev.some((item) => item.id === person.id)
        ? prev.filter((item) => item.id !== person.id)
        : [...prev, person],
    );
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Не получилось. Попробуйте ещё раз.');
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal
        aria-label="Новый чат"
      >
        <div className="modal-header">
          <h2 className="modal-title">Новый чат</h2>
          <button className="btn-ghost" onClick={onClose} aria-label="Закрыть">
            <CloseIcon />
          </button>
        </div>

        <div className="modal-body">
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className={mode === 'direct' ? 'btn' : 'btn btn-quiet'}
              onClick={() => setMode('direct')}
            >
              Личный
            </button>
            <button
              className={mode === 'group' ? 'btn' : 'btn btn-quiet'}
              onClick={() => setMode('group')}
            >
              Группа
            </button>
            <button
              className={mode === 'code' ? 'btn' : 'btn btn-quiet'}
              onClick={() => setMode('code')}
            >
              По коду
            </button>
          </div>

          {error ? <div className="error-banner">{error}</div> : null}

          {mode === 'group' ? (
            <label className="field">
              <span className="field-label">Название группы</span>
              <input
                className="input"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="9О, редколлегия, поход…"
              />
              <span className="field-hint">
                Участников можно не выбирать: после создания появится код, по
                которому остальные войдут сами.
              </span>
            </label>
          ) : null}

          {mode === 'group' && selected.length > 0 ? (
            <div className="chip-row">
              {selected.map((person) => (
                <span className="chip" key={person.id}>
                  {person.displayName}
                  <button onClick={() => togglePerson(person)} aria-label={`Убрать ${person.displayName}`}>
                    <CloseIcon size={13} />
                  </button>
                </span>
              ))}
            </div>
          ) : null}

          {mode === 'code' ? (
            <label className="field">
              <span className="field-label">Код группы</span>
              <input
                className="input join-code-input"
                value={code}
                onChange={(event) => setCode(event.target.value.toUpperCase())}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && code.trim()) {
                    void run(() => onJoinByCode(code.trim()));
                  }
                }}
                placeholder="CFH6QK"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                maxLength={12}
                aria-label="Код группы"
              />
              <span className="field-hint">
                Шесть символов от того, кто создал группу. Регистр и пробелы не важны.
              </span>
            </label>
          ) : (
            <>
              <div className="search-box">
                <SearchIcon />
                <input
                  className="input"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Найти человека"
                  type="search"
                  aria-label="Найти человека"
                />
              </div>

              <div className="people-list">
                {people.length === 0 ? (
                  <p className="list-section-title">
                    {search ? 'Никого не нашлось' : 'Кроме вас тут пока никого нет'}
                  </p>
                ) : (
                  people.map((person) => {
                    const isSelected = selected.some((item) => item.id === person.id);
                    return (
                      <button
                        key={person.id}
                        className={`person-row${isSelected ? ' is-selected' : ''}`}
                        disabled={busy}
                        onClick={() => {
                          if (mode === 'group') togglePerson(person);
                          else void run(() => onStartDirect(person.id));
                        }}
                      >
                        <Avatar
                          name={person.displayName}
                          color={person.avatarColor}
                          fileId={person.avatarFileId}
                          size={36}
                          online={person.online}
                        />
                        <div className="person-body">
                          <div className="person-name">{person.displayName}</div>
                          <div className="person-handle">
                            @{person.username}
                            {person.grade ? ` · ${person.grade}` : ''}
                          </div>
                        </div>
                        {isSelected ? <span aria-hidden>✓</span> : null}
                      </button>
                    );
                  })
                )}
              </div>
            </>
          )}
        </div>

        {mode === 'group' ? (
          <div className="modal-footer">
            <button className="btn btn-quiet" onClick={onClose}>
              Отмена
            </button>
            <button
              className="btn"
              disabled={busy || title.trim().length === 0}
              onClick={() => void run(() => onCreateGroup(title.trim(), selected.map((p) => p.id)))}
            >
              {busy ? <span className="spinner" /> : null}
              Создать группу
            </button>
          </div>
        ) : mode === 'code' ? (
          <div className="modal-footer">
            <button className="btn btn-quiet" onClick={onClose}>
              Отмена
            </button>
            <button
              className="btn"
              disabled={busy || code.trim().length === 0}
              onClick={() => void run(() => onJoinByCode(code.trim()))}
            >
              {busy ? <span className="spinner" /> : null}
              Присоединиться
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
