'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Avatar from './Avatar';
import Composer from './Composer';
import GroupInfoDialog from './GroupInfoDialog';
import { BackIcon, UsersIcon } from './Icons';
import MessageItem from './MessageItem';
import { api } from '@/lib/client';
import { formatDayLabel, formatMemberCount, formatPresence } from '@/lib/format';
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
      pendingScroll.current = 'bottom';
    }
  }, [conversation?.id]);

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
      </header>

      <div className="messages" ref={scrollRef} onScroll={handleScroll}>
        <div className="messages-spacer" />
        {loadingOlder ? <div className="messages-top">Загружаем историю…</div> : null}
        {reachedStart ? <div className="messages-top">Это начало переписки</div> : null}

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
