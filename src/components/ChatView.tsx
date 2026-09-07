'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Avatar from './Avatar';
import ChatMenu from './ChatMenu';
import Composer from './Composer';
import GroupInfoDialog from './GroupInfoDialog';
import { BackIcon, CloseIcon, TrashIcon, UsersIcon } from './Icons';
import MessageItem from './MessageItem';
import { api, ApiError } from '@/lib/client';
import { formatDayLabel, formatMemberCount, formatPresence, personSubtitle } from '@/lib/format';
import type { ChatMessage, Conversation, Me, Member, ReadReceipt, TypingUser } from '@/lib/types';

interface ChatViewProps {
  me: Me;
  conversation: Conversation | null;
  messages: ChatMessage[];
  members: Member[];
  receipts: ReadReceipt[];
  typing: TypingUser[];
  connected: boolean;
  onBack: () => void;
  onMessagesChange: (updater: (list: ChatMessage[]) => ChatMessage[]) => void;
  onConversationsChange: () => void;
  onMarkRead: (conversationId: number, messageId: number) => void;
  onOpenPerson: (personId: number) => void;
}

function sameDay(a: string, b: string): boolean {
  const first = new Date(a);
  const second = new Date(b);
  return (
    first.getFullYear() === second.getFullYear() &&
    first.getMonth() === second.getMonth() &&
    first.getDate() === second.getDate()
  );
}

export default function ChatView({
  me,
  conversation,
  messages,
  members,
  receipts,
  typing,
  onBack,
  onMessagesChange,
  onConversationsChange,
  onMarkRead,
  onOpenPerson,
}: ChatViewProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [reachedStart, setReachedStart] = useState(false);
  const [showGroupInfo, setShowGroupInfo] = useState(false);
  // Режим выбора: пока он включён, нажатие по сообщению отмечает его, а не
  // открывает ответ. null — обычный режим.
  const [selection, setSelection] = useState<Set<number> | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);

  // Куда прокручивать после отрисовки: вниз или на прежнее место при подгрузке.
  const pendingScroll = useRef<'bottom' | { fromHeight: number } | null>('bottom');
  const lastConversationId = useRef<number | null>(null);
  const lastMessageId = messages.length > 0 ? messages[messages.length - 1].id : 0;

  // Смена диалога: сбрасываем состояние и уезжаем вниз.
  useEffect(() => {
    if (conversation?.id !== lastConversationId.current) {
      lastConversationId.current = conversation?.id ?? null;
      setReplyTo(null);
      setEditing(null);
      setReachedStart(false);
      setSelection(null);
      setNotice(null);
      pendingScroll.current = 'bottom';
    }
  }, [conversation?.id]);

  // Заблокирован ли собеседник — от этого зависит пункт меню.
  useEffect(() => {
    const partnerId = conversation?.kind === 'dm' ? conversation.partner?.id : null;
    if (!partnerId) {
      setBlocked(false);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const data = await api.get<{ blocked: boolean }>(`/api/users/${partnerId}`);
        if (!cancelled) setBlocked(data.blocked);
      } catch {
        // Не узнали — покажем пункт «Заблокировать», он безопаснее по умолчанию.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [conversation?.kind, conversation?.partner?.id]);

  const isNearBottom = useCallback(() => {
    const node = scrollRef.current;
    if (!node) return true;
    return node.scrollHeight - node.scrollTop - node.clientHeight < 150;
  }, []);

  // Новое сообщение прокручивает ленту, только если человек и так внизу:
  // иначе он читает историю, и дёргать её нельзя.
  useEffect(() => {
    if (lastMessageId && isNearBottom()) pendingScroll.current = 'bottom';
  }, [lastMessageId, isNearBottom]);

  useLayoutEffect(() => {
    const node = scrollRef.current;
    const target = pendingScroll.current;
    if (!node || !target) return;

    if (target === 'bottom') {
      node.scrollTop = node.scrollHeight;
    } else {
      // Подгрузили историю сверху — оставляем взгляд на том же сообщении.
      node.scrollTop = node.scrollHeight - target.fromHeight;
    }
    pendingScroll.current = null;
  });

  const loadOlder = useCallback(async () => {
    const node = scrollRef.current;
    if (!conversation || loadingOlder || reachedStart || messages.length === 0 || !node) return;

    setLoadingOlder(true);
    const fromHeight = node.scrollHeight;

    try {
      const data = await api.get<{ messages: ChatMessage[] }>(
        `/api/conversations/${conversation.id}/messages?before=${messages[0].id}`,
      );
      if (data.messages.length === 0) {
        setReachedStart(true);
      } else {
        pendingScroll.current = { fromHeight };
        onMessagesChange((list) => [...data.messages, ...list]);
      }
    } catch {
      // Молча: попробуем ещё раз при следующей прокрутке.
    } finally {
      setLoadingOlder(false);
    }
  }, [conversation, loadingOlder, reachedStart, messages, onMessagesChange]);

  /** Общая обёртка для действий меню: одна ошибка — одна строчка сверху. */
  async function run(action: () => Promise<void>, failure: string) {
    try {
      await action();
    } catch (caught) {
      setNotice(caught instanceof ApiError ? caught.message : failure);
    }
  }

  function toggleSelected(messageId: number) {
    setSelection((prev) => {
      const next = new Set(prev ?? []);
      if (next.has(messageId)) next.delete(messageId);
      else next.add(messageId);
      return next;
    });
  }

  /** Убирает выбранные сообщения. Чужие пропускает — их убрать нельзя. */
  async function removeSelected() {
    if (!selection || selection.size === 0) return;

    const mine = messages.filter(
      (message) => selection.has(message.id) && message.senderId === me.id && !message.deleted,
    );
    if (mine.length === 0) {
      setNotice('Убрать можно только свои сообщения.');
      return;
    }

    setSelection(null);
    for (const message of mine) {
      try {
        await api.delete(`/api/messages/${message.id}`);
        onMessagesChange((list) => list.filter((item) => item.id !== message.id));
      } catch {
        setNotice('Не всё получилось убрать. Попробуйте ещё раз.');
      }
    }
    onConversationsChange();
  }

  async function changeGroupPhoto(file: File) {
    if (!conversation) return;

    await run(async () => {
      const form = new FormData();
      form.append('file', file);
      const uploaded = await api.post<{ file: { id: number } }>('/api/files', form);
      await api.patch(`/api/conversations/${conversation.id}`, { avatarFileId: uploaded.file.id });
      onConversationsChange();
    }, 'Не удалось поставить картинку.');
  }

  function handleScroll() {
    const node = scrollRef.current;
    if (!node) return;
    if (node.scrollTop < 120) void loadOlder();

    // Долистали до низа — считаем всё прочитанным.
    if (conversation && isNearBottom() && conversation.unread > 0 && lastMessageId) {
      onMarkRead(conversation.id, lastMessageId);
    }
  }

  if (!conversation) {
    return (
      <section className="chat">
        <div className="empty-state">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="empty-emblem" src="/emblem.png" alt="" width={96} height={96} />
          <h2>Выберите чат</h2>
          <p>Слева — список переписок. Или начните новую, нажав «плюс» вверху панели.</p>
        </div>
      </section>
    );
  }

  const typingNames = typing.map((user) => user.displayName);
  const status = typingNames.length > 0
    ? typingNames.length === 1
      ? `${typingNames[0]} печатает…`
      : `${typingNames.slice(0, 2).join(', ')} печатают…`
    : conversation.kind === 'dm'
      ? formatPresence(conversation.partner?.online ?? false, conversation.partner?.lastSeenAt ?? null)
      : formatMemberCount(conversation.memberCount);

  const isPartnerOnline = conversation.kind === 'dm' && (conversation.partner?.online ?? false);
  const isOwner = members.some((member) => member.id === me.id && member.role === 'owner');

  // До какого сообщения дочитали все остальные — для второй галочки.
  const readUpTo = receipts.length > 0
    ? Math.min(...receipts.map((receipt) => receipt.lastReadMessageId))
    : 0;

  // Граница непрочитанного: показываем её один раз, по состоянию на открытие чата.
  const firstUnreadId = messages.find(
    (message) => message.id > conversation.lastReadMessageId && message.senderId !== me.id,
  )?.id;

  return (
    <section className="chat">
      <header className="chat-header">
        <button className="back-button" onClick={onBack} aria-label="Назад к списку чатов">
          <BackIcon />
        </button>
        <Avatar
          name={conversation.title}
          color={conversation.avatarColor}
          fileId={conversation.avatarFileId}
          size={38}
          online={isPartnerOnline}
        />
        <div className="chat-header-body">
          <div className="chat-header-title">{conversation.title}</div>
          <div className={`chat-header-status${isPartnerOnline && typingNames.length === 0 ? ' is-online' : ''}`}>
            {status}
          </div>
        </div>
        {conversation.kind === 'group' ? (
          <button
            className="btn-ghost"
            onClick={() => setShowGroupInfo(true)}
            title="Участники группы"
            aria-label="Участники группы"
          >
            <UsersIcon />
          </button>
        ) : null}

        <ChatMenu
          conversation={conversation}
          me={me}
          isOwner={isOwner}
          blocked={blocked}
          onOpenGroupInfo={() => setShowGroupInfo(true)}
          onOpenPartner={() => {
            if (conversation.partner) onOpenPerson(conversation.partner.id);
          }}
          onToggleMute={() =>
            void run(async () => {
              await api.patch(`/api/conversations/${conversation.id}`, { muted: !conversation.muted });
              onConversationsChange();
            }, 'Не удалось изменить уведомления.')
          }
          onSelectMessages={() => setSelection(new Set())}
          onChangePhoto={() => photoInputRef.current?.click()}
          onClearHistory={() => {
            if (!confirm('Очистить переписку у себя? У собеседника она останется.')) return;
            void run(async () => {
              await api.post(`/api/conversations/${conversation.id}/clear`);
              onMessagesChange(() => []);
              onConversationsChange();
            }, 'Не удалось очистить переписку.');
          }}
          onToggleBlock={() => {
            const partnerId = conversation.partner?.id;
            if (!partnerId) return;
            if (!blocked && !confirm(`Заблокировать ${conversation.title}? Он больше не сможет вам писать.`)) {
              return;
            }
            void run(async () => {
              await api.post(`/api/users/${partnerId}${blocked ? '?action=unblock' : ''}`);
              setBlocked(!blocked);
            }, 'Не удалось изменить блокировку.');
          }}
          onLeaveGroup={() => {
            if (!confirm(`Выйти из группы «${conversation.title}»?`)) return;
            void run(async () => {
              await api.delete(`/api/conversations/${conversation.id}`);
              onConversationsChange();
              onBack();
            }, 'Не удалось выйти из группы.');
          }}
        />
      </header>

      {/* Выбор картинки группы. Скрытое поле — чтобы кнопка была в меню. */}
      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void changeGroupPhoto(file);
        }}
      />

      {notice ? <div className="chat-notice">{notice}</div> : null}

      {selection ? (
        <div className="selection-bar">
          <button className="btn-ghost" onClick={() => setSelection(null)} aria-label="Отменить выбор">
            <CloseIcon />
          </button>
          <span className="selection-count">
            {selection.size === 0 ? 'Выберите сообщения' : `Выбрано: ${selection.size}`}
          </span>
          <button
            className="btn btn-small btn-quiet"
            disabled={selection.size === 0}
            onClick={() => {
              const text = messages
                .filter((message) => selection.has(message.id) && !message.deleted)
                .map((message) => `${message.senderName ?? ''}: ${message.body}`)
                .join('\n');
              void navigator.clipboard?.writeText(text).catch(() => {});
              setSelection(null);
            }}
          >
            Скопировать
          </button>
          <button
            className="btn btn-small btn-danger"
            disabled={selection.size === 0}
            onClick={() => void removeSelected()}
          >
            <TrashIcon size={15} /> Убрать
          </button>
        </div>
      ) : null}

      <div className="messages" ref={scrollRef} onScroll={handleScroll}>
        <div className="messages-spacer" />
        {loadingOlder ? <div className="messages-top">Загружаем историю…</div> : null}

        {/* Начало переписки: показываем, с кем говорим. Раньше на этом месте
            была пустота в пол-экрана. Условие про длину — на случай, когда
            вся история уместилась в одну страницу и догружать нечего. */}
        {reachedStart || (messages.length > 0 && messages.length < 40) ? (
          <div className="chat-intro">
            <Avatar
              name={conversation.title}
              color={conversation.avatarColor}
              fileId={conversation.avatarFileId}
              size={64}
            />
            <div>
              <div className="chat-intro-name">{conversation.title}</div>
              <div className="chat-intro-meta">
                {conversation.kind === 'group'
                  ? formatMemberCount(conversation.memberCount)
                  : conversation.partner
                    ? `@${conversation.partner.username}${
                        personSubtitle(conversation.partner)
                          ? ` · ${personSubtitle(conversation.partner)}`
                          : ''
                      }`
                    : ''}
              </div>
            </div>
            <div className="chat-intro-note">
              {conversation.kind === 'group' ? 'Начало общего чата' : 'Начало переписки'}
            </div>
          </div>
        ) : null}

        {messages.map((message, index) => {
          const previous = index > 0 ? messages[index - 1] : null;
          const needsDayDivider = !previous || !sameDay(previous.createdAt, message.createdAt);

          // Подряд идущие сообщения одного автора склеиваются в группу.
          const groupStart =
            !previous ||
            needsDayDivider ||
            previous.senderId !== message.senderId ||
            previous.kind === 'system' ||
            message.kind === 'system' ||
            new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime() > 5 * 60_000;

          const picked = selection?.has(message.id) ?? false;

          return (
            <div key={message.id}>
              {needsDayDivider ? (
                <div className="day-divider">
                  <span>{formatDayLabel(message.createdAt)}</span>
                </div>
              ) : null}

              {message.id === firstUnreadId ? (
                <div className="unread-divider">Непрочитанные</div>
              ) : null}

              {selection ? (
                // В режиме выбора вся строка — переключатель: попасть пальцем в
                // маленькую галочку на телефоне почти невозможно.
                <div
                  className={`message-pick${picked ? ' is-picked' : ''}`}
                  onClick={() => toggleSelected(message.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') toggleSelected(message.id);
                  }}
                >
                  <span className={`pick-box${picked ? ' is-picked' : ''}`} aria-hidden>
                    {picked ? '✓' : ''}
                  </span>
                  <div className="message-pick-body">
                    <MessageItem
                      message={message}
                      me={me}
                      conversation={conversation}
                      isGroupStart={groupStart}
                      isRead={message.id <= readUpTo}
                      onReply={() => {}}
                      onEdit={() => {}}
                      onMessagesChange={onMessagesChange}
                      onOpenPerson={onOpenPerson}
                    />
                  </div>
                </div>
              ) : (
                <MessageItem
                  message={message}
                  me={me}
                  conversation={conversation}
                  isGroupStart={groupStart}
                  isRead={message.id <= readUpTo}
                  onReply={() => setReplyTo(message)}
                  onEdit={() => setEditing(message)}
                  onMessagesChange={onMessagesChange}
                  onOpenPerson={onOpenPerson}
                />
              )}
            </div>
          );
        })}
      </div>

      <Composer
        conversation={conversation}
        me={me}
        replyTo={replyTo}
        editing={editing}
        onCancelReply={() => setReplyTo(null)}
        onCancelEdit={() => setEditing(null)}
        onMessagesChange={onMessagesChange}
        onScrollToBottom={() => {
          pendingScroll.current = 'bottom';
        }}
      />

      {showGroupInfo ? (
        <GroupInfoDialog
          conversation={conversation}
          members={members}
          me={me}
          onClose={() => setShowGroupInfo(false)}
          onChanged={onConversationsChange}
          onOpenPerson={onOpenPerson}
        />
      ) : null}
    </section>
  );
}
