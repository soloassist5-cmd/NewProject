'use client';

import { useEffect, useState } from 'react';
import Avatar from './Avatar';
import { CloseIcon, PlusIcon, SearchIcon } from './Icons';
import { api, ApiError } from '@/lib/client';
import { formatMemberCount, formatPresence } from '@/lib/format';
import type { Conversation, Me, Member, Person } from '@/lib/types';

interface GroupInfoDialogProps {
  conversation: Conversation;
  members: Member[];
  me: Me;
  onClose: () => void;
  onChanged: () => void;
  onOpenPerson: (personId: number) => void;
}

export default function GroupInfoDialog({
  conversation,
  members,
  me,
  onClose,
  onChanged,
  onOpenPerson,
}: GroupInfoDialogProps) {
  const [title, setTitle] = useState(conversation.title);
  const [muted, setMuted] = useState(conversation.muted);
  const [adding, setAdding] = useState(false);
  const [candidates, setCandidates] = useState<Person[]>([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState<string | null>(null);
  const [codeCopied, setCodeCopied] = useState(false);

  const myMembership = members.find((member) => member.id === me.id);
  const canManage = myMembership?.role === 'owner' || me.role === 'admin';

  // Код группы виден только участникам, поэтому запрашиваем его при открытии.
  useEffect(() => {
    let cancelled = false;
    api
      .get<{ code: string | null }>(`/api/conversations/${conversation.id}/code`)
      .then((data) => {
        if (!cancelled) setJoinCode(data.code);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [conversation.id]);

  async function copyCode() {
    if (!joinCode) return;
    try {
      await navigator.clipboard.writeText(joinCode);
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 2000);
    } catch {
      // Буфер обмена доступен не везде (нужен https) — код и так виден на экране.
      setError('Не удалось скопировать. Перепишите код вручную.');
    }
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (!adding) return;
    const timer = setTimeout(async () => {
      try {
        const data = await api.get<{ people: Person[] }>(
          `/api/users?search=${encodeURIComponent(search)}`,
        );
        // Тех, кто уже в группе, не предлагаем.
        const present = new Set(members.map((member) => member.id));
        setCandidates(data.people.filter((person) => !present.has(person.id)));
      } catch {
        setCandidates([]);
      }
    }, search ? 220 : 0);
    return () => clearTimeout(timer);
  }, [adding, search, members]);

  async function act(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      onChanged();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Не получилось выполнить действие.');
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal
        aria-label="О группе"
      >
        <div className="modal-header">
          <Avatar name={conversation.title} color={conversation.avatarColor} size={38} />
          <h2 className="modal-title">{conversation.title}</h2>
          <button className="btn-ghost" onClick={onClose} aria-label="Закрыть">
            <CloseIcon />
          </button>
        </div>

        <div className="modal-body">
          {error ? <div className="error-banner">{error}</div> : null}

          {canManage ? (
            <label className="field">
              <span className="field-label">Название</span>
              <div className="rename-row">
                <input
                  className="input"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                />
                <button
                  className="btn"
                  disabled={title.trim() === conversation.title || title.trim().length === 0}
                  onClick={() =>
                    void act(() =>
                      api.patch(`/api/conversations/${conversation.id}`, { title: title.trim() }),
                    )
                  }
                >
                  Переименовать
                </button>
              </div>
            </label>
          ) : null}

          <div className="field">
            <span className="field-label">Код группы</span>
            <div className="join-code-row">
              <code className="join-code">{joinCode ?? '······'}</code>
              <button
                className="btn btn-quiet"
                onClick={() => void copyCode()}
                disabled={!joinCode}
              >
                {codeCopied ? 'Скопировано' : 'Копировать'}
              </button>
            </div>
            <span className="field-hint">
              Передайте код тем, кого зовёте: по нему они сами войдут в группу.
            </span>
            {canManage ? (
              <button
                className="btn-ghost"
                style={{ alignSelf: 'flex-start' }}
                onClick={() => {
                  if (!window.confirm('Выдать новый код? Старый перестанет работать.')) return;
                  void act(async () => {
                    const data = await api.post<{ code: string }>(
                      `/api/conversations/${conversation.id}/code`,
                    );
                    setJoinCode(data.code);
                  });
                }}
              >
                Сменить код
              </button>
            ) : null}
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={muted}
              onChange={(event) => {
                const next = event.target.checked;
                setMuted(next);
                void act(() => api.patch(`/api/conversations/${conversation.id}`, { muted: next }));
              }}
            />
            <span>Без звука — не показывать уведомления из этой группы</span>
          </label>

          <div className="field">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="field-label" style={{ flex: 1 }}>
                {formatMemberCount(members.length)}
              </span>
              <button className="btn-ghost" onClick={() => setAdding((open) => !open)}>
                <PlusIcon size={16} /> Добавить
              </button>
            </div>

            {adding ? (
              <>
                <div className="search-box" style={{ marginBottom: 8 }}>
                  <SearchIcon />
                  <input
                    className="input"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Кого добавить"
                    type="search"
                  />
                </div>
                <div className="people-list" style={{ maxHeight: 180 }}>
                  {candidates.length === 0 ? (
                    <p className="list-section-title">Некого добавить</p>
                  ) : (
                    candidates.map((person) => (
                      <button
                        key={person.id}
                        className="person-row"
                        onClick={() =>
                          void act(async () => {
                            await api.post(`/api/conversations/${conversation.id}/members`, {
                              userIds: [person.id],
                            });
                            setAdding(false);
                            setSearch('');
                          })
                        }
                      >
                        <Avatar
                          name={person.displayName}
                          color={person.avatarColor}
                          fileId={person.avatarFileId}
                          size={32}
                        />
                        <div className="person-body">
                          <div className="person-name">{person.displayName}</div>
                          <div className="person-handle">@{person.username}</div>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </>
            ) : null}

            <div className="people-list">
              {members.map((member) => (
                <div key={member.id} className="person-row">
                  <Avatar
                    name={member.displayName}
                    color={member.avatarColor}
                    fileId={member.avatarFileId}
                    size={36}
                    online={member.online}
                  />
                  <button
                    className="person-body"
                    style={{ textAlign: 'left', background: 'none' }}
                    onClick={() => {
                      if (member.id !== me.id) {
                        onOpenPerson(member.id);
                        onClose();
                      }
                    }}
                  >
                    <div className="person-name">
                      {member.displayName}
                      {member.id === me.id ? ' (вы)' : ''}
                      {member.role === 'owner' ? (
                        <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}> · создатель</span>
                      ) : null}
                    </div>
                    <div className="person-handle">
                      {formatPresence(member.online, member.lastSeenAt)}
                    </div>
                  </button>
                  {canManage && member.id !== me.id ? (
                    <button
                      className="btn-ghost"
                      title="Убрать из группы"
                      aria-label={`Убрать ${member.displayName}`}
                      onClick={() =>
                        void act(() =>
                          api.delete(
                            `/api/conversations/${conversation.id}/members?userId=${member.id}`,
                          ),
                        )
                      }
                    >
                      <CloseIcon size={15} />
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          </div>

          <button
            className="btn btn-danger"
            onClick={() => {
              if (!window.confirm('Выйти из группы?')) return;
              void act(async () => {
                await api.delete(`/api/conversations/${conversation.id}`);
                onClose();
              });
            }}
          >
            Покинуть группу
          </button>
        </div>
      </div>
    </div>
  );
}
