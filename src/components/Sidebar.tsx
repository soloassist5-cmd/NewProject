'use client';

import { useEffect, useState } from 'react';
import Avatar from './Avatar';
import { BellOffIcon, MoonIcon, PlusIcon, SearchIcon, ShieldIcon, SunIcon } from './Icons';
import { api } from '@/lib/client';
import { formatListTime, highlight, personSubtitle, roleLabel } from '@/lib/format';
import type { ChatMessage, Conversation, Me, Person } from '@/lib/types';

interface SidebarProps {
  me: Me;
  schoolName: string;
  conversations: Conversation[];
  activeId: number | null;
  loading: boolean;
  connected: boolean;
  onSelect: (conversationId: number) => void;
  onNewChat: () => void;
  onOpenProfile: () => void;
  onOpenAdmin: () => void;
  onOpenPerson: (personId: number) => void;
}

export default function Sidebar({
  me,
  schoolName,
  conversations,
  activeId,
  loading,
  connected,
  onSelect,
  onNewChat,
  onOpenProfile,
  onOpenAdmin,
  onOpenPerson,
}: SidebarProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ messages: ChatMessage[]; people: Person[] } | null>(null);
  const [theme, setTheme] = useState<'light' | 'dark' | null>(null);

  // Под своим именем — класс, а у сотрудника гимназии должность.
  const meSubtitle = me.grade || roleLabel(me.role);

  useEffect(() => {
    const saved = localStorage.getItem('gimroom-theme');
    if (saved === 'dark' || saved === 'light') setTheme(saved);
  }, []);

  function toggleTheme() {
    // Если тема не выбрана вручную, отталкиваемся от текущей системной.
    const current =
      theme ?? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = current === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.dataset.theme = next;
    localStorage.setItem('gimroom-theme', next);
  }

  // Поиск с задержкой, чтобы не дёргать сервер на каждую букву.
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults(null);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const data = await api.get<{ messages: ChatMessage[]; people: Person[] }>(
          `/api/search?q=${encodeURIComponent(trimmed)}`,
        );
        setResults(data);
      } catch {
        setResults({ messages: [], people: [] });
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [query]);

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="brand-mark" src="/mark.svg" alt="" width={30} height={30} />
          <span className="brand-text">
            <span className="brand-name">ГимРум</span>
            <span className="brand-school">{schoolName}</span>
          </span>
        </div>
        {me.role === 'admin' ? (
          <button
            className="btn-ghost"
            onClick={onOpenAdmin}
            title="Администрирование"
            aria-label="Панель администратора"
          >
            <ShieldIcon />
          </button>
        ) : null}
        <button
          className="btn-ghost"
          onClick={toggleTheme}
          title="Сменить тему"
          aria-label="Сменить тему оформления"
        >
          {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
        </button>
        <button className="btn-ghost" onClick={onNewChat} title="Новый чат" aria-label="Новый чат">
          <PlusIcon />
        </button>
      </div>

      <div className="sidebar-search">
        <div className="search-box">
          <SearchIcon />
          <input
            className="input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Поиск по чатам и людям"
            type="search"
            aria-label="Поиск"
          />
        </div>
      </div>

      {!connected ? <div className="connection-banner">Нет связи с сервером — переподключаемся…</div> : null}

      <div className="conversation-list">
        {results ? (
          <SearchResults
            results={results}
            query={query}
            conversations={conversations}
            onSelectConversation={(id) => {
              setQuery('');
              onSelect(id);
            }}
            onSelectPerson={(personId) => {
              // Сначала карточка человека: по одному имени в списке не всегда
              // понятно, тот ли это Иванов, а диалог создаётся кнопкой в ней.
              setQuery('');
              onOpenPerson(personId);
            }}
          />
        ) : loading ? (
          <p className="list-section-title">Загружаем чаты…</p>
        ) : conversations.length === 0 ? (
          <div className="empty-state" style={{ padding: '32px 16px' }}>
            <p>Пока ни одного чата.</p>
            <button className="btn" onClick={onNewChat}>
              <PlusIcon size={16} /> Начать переписку
            </button>
          </div>
        ) : (
          conversations.map((conversation) => (
            <ConversationRow
              key={conversation.id}
              conversation={conversation}
              isActive={conversation.id === activeId}
              meId={me.id}
              onSelect={() => onSelect(conversation.id)}
            />
          ))
        )}
      </div>

      <div className="sidebar-footer">
        <button className="sidebar-me" onClick={onOpenProfile}>
          <Avatar name={me.displayName} color={me.avatarColor} fileId={me.avatarFileId} size={36} />
          <div style={{ minWidth: 0 }}>
            <div className="sidebar-me-name">{me.displayName}</div>
            <div className="sidebar-me-status">
              @{me.username}
              {meSubtitle ? ` · ${meSubtitle}` : ''}
            </div>
          </div>
        </button>
      </div>
    </aside>
  );
}

function ConversationRow({
  conversation,
  isActive,
  meId,
  onSelect,
}: {
  conversation: Conversation;
  isActive: boolean;
  meId: number;
  onSelect: () => void;
}) {
  const last = conversation.lastMessage;

  let preview: React.ReactNode = <em>Сообщений пока нет</em>;
  if (last) {
    if (last.deleted) {
      preview = <em>Сообщение удалено</em>;
    } else if (last.kind === 'system') {
      preview = <em>{last.body}</em>;
    } else {
      const author =
        last.senderId === meId ? 'Вы: ' : conversation.kind === 'group' ? `${last.senderName}: ` : '';
      const text = last.body || (last.hasAttachments ? 'Вложение' : '');
      preview = `${author}${text}`;
    }
  }

  return (
    <button
      className={`conversation-item${isActive ? ' is-active' : ''}`}
      onClick={onSelect}
      aria-current={isActive}
    >
      <Avatar
        name={conversation.title}
        color={conversation.avatarColor}
        fileId={conversation.avatarFileId}
        online={conversation.partner?.online}
      />
      <div className="conversation-body">
        <div className="conversation-top">
          <span className="conversation-title">{conversation.title}</span>
          {last ? <span className="conversation-time">{formatListTime(last.createdAt)}</span> : null}
        </div>
        <div className="conversation-bottom">
          <span className="conversation-preview">{preview}</span>
          {conversation.muted ? <BellOffIcon className="mute-icon" /> : null}
          {conversation.unread > 0 ? (
            <span className={`badge${conversation.muted ? ' badge-muted' : ''}`}>
              {conversation.unread > 99 ? '99+' : conversation.unread}
            </span>
          ) : null}
        </div>
      </div>
    </button>
  );
}

function SearchResults({
  results,
  query,
  conversations,
  onSelectConversation,
  onSelectPerson,
}: {
  results: { messages: ChatMessage[]; people: Person[] };
  query: string;
  conversations: Conversation[];
  onSelectConversation: (conversationId: number) => void;
  onSelectPerson: (personId: number) => void;
}) {
  const nothingFound = results.people.length === 0 && results.messages.length === 0;

  if (nothingFound) {
    return <p className="list-section-title">Ничего не нашлось</p>;
  }

  return (
    <>
      {results.people.length > 0 ? (
        <>
          <p className="list-section-title">Люди</p>
          {results.people.map((person) => (
            <button
              key={person.id}
              className="person-row"
              onClick={() => void onSelectPerson(person.id)}
            >
              <Avatar
                name={person.displayName}
                color={person.avatarColor}
                fileId={person.avatarFileId}
                size={36}
                online={person.online}
              />
              <div className="person-body">
                <div className="person-name">{highlight(person.displayName, query)}</div>
                <div className="person-handle">
                  @{person.username}
                  {personSubtitle(person) ? ` · ${personSubtitle(person)}` : ''}
                </div>
              </div>
            </button>
          ))}
        </>
      ) : null}

      {results.messages.length > 0 ? (
        <>
          <p className="list-section-title">Сообщения</p>
          {results.messages.map((message) => {
            const conversation = conversations.find((item) => item.id === message.conversationId);
            return (
              <button
                key={message.id}
                className="search-result"
                onClick={() => onSelectConversation(message.conversationId)}
              >
                <div className="search-result-top">
                  <span className="search-result-name">
                    {conversation?.title ?? message.senderName}
                  </span>
                  <span className="search-result-time">{formatListTime(message.createdAt)}</span>
                </div>
                <div className="search-result-text">{highlight(message.body, query)}</div>
              </button>
            );
          })}
        </>
      ) : null}
    </>
  );
}
