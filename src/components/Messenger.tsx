'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ChatView from './ChatView';
import NewChatDialog from './NewChatDialog';
import ProfileDialog from './ProfileDialog';
import Sidebar from './Sidebar';
import { api } from '@/lib/client';
import type {
  ChatMessage,
  Conversation,
  Me,
  Member,
  Person,
  ReadReceipt,
  TypingUser,
} from '@/lib/types';
import { useEventStream, type StreamEvent } from '@/lib/useStream';

/**
 * Вставляет сообщение в ленту.
 *
 * Своё сообщение сначала показывается оптимистично, с временным
 * отрицательным id. Подтверждение может прийти двумя путями — ответом на
 * отправку и событием из ленты, — поэтому склейка идёт сперва по id, а затем
 * по совпадению с ещё не подтверждённой заготовкой.
 */
function mergeMessage(list: ChatMessage[], incoming: ChatMessage, myId: number): ChatMessage[] {
  const byId = list.findIndex((message) => message.id === incoming.id);
  if (byId !== -1) {
    const next = [...list];
    next[byId] = { ...incoming };
    return next;
  }

  if (incoming.senderId === myId) {
    const pendingIndex = list.findIndex(
      (message) =>
        message.pending &&
        message.body === incoming.body &&
        message.attachments.length === incoming.attachments.length,
    );
    if (pendingIndex !== -1) {
      const next = [...list];
      next[pendingIndex] = { ...incoming };
      return next;
    }
  }

  // Сообщения хранятся по возрастанию id — держим порядок при вставке.
  const next = [...list, incoming];
  next.sort((a, b) => a.id - b.id);
  return next;
}

export default function Messenger({ me: initialMe }: { me: Me }) {
  const [me, setMe] = useState(initialMe);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Record<number, ChatMessage[]>>({});
  const [members, setMembers] = useState<Member[]>([]);
  const [receipts, setReceipts] = useState<ReadReceipt[]>([]);
  const [typing, setTyping] = useState<TypingUser[]>([]);
  const [connected, setConnected] = useState(true);
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [showNewChat, setShowNewChat] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [mobileView, setMobileView] = useState<'list' | 'chat'>('list');

  // Читаются внутри обработчиков событий, которые не должны пересоздаваться.
  const activeIdRef = useRef<number | null>(null);
  const windowFocused = useRef(true);

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  useEffect(() => {
    const onFocus = () => {
      windowFocused.current = true;
    };
    const onBlur = () => {
      windowFocused.current = false;
    };
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === activeId) ?? null,
    [conversations, activeId],
  );

  const totalUnread = useMemo(
    () => conversations.reduce((sum, conversation) => sum + (conversation.muted ? 0 : conversation.unread), 0),
    [conversations],
  );

  // Счётчик непрочитанных в заголовке вкладки.
  useEffect(() => {
    document.title = totalUnread > 0 ? `(${totalUnread}) Перемена` : 'Перемена — школьный мессенджер';
  }, [totalUnread]);

  const refreshConversations = useCallback(async () => {
    try {
      const data = await api.get<{ conversations: Conversation[] }>('/api/conversations');
      setConversations(data.conversations);
    } catch {
      // Молчим: список подтянется при следующем событии или обновлении.
    } finally {
      setLoadingConversations(false);
    }
  }, []);

  useEffect(() => {
    void refreshConversations();
  }, [refreshConversations]);

  // Пока висит соединение, статусы «в сети» стареют — обновляем список,
  // чтобы «был(а) 2 минуты назад» не застывал на месте.
  useEffect(() => {
    const timer = setInterval(() => void refreshConversations(), 60_000);
    return () => clearInterval(timer);
  }, [refreshConversations]);

  const markRead = useCallback(async (conversationId: number, messageId: number) => {
    setConversations((prev) =>
      prev.map((conversation) =>
        conversation.id === conversationId
          ? { ...conversation, unread: 0, lastReadMessageId: Math.max(conversation.lastReadMessageId, messageId) }
          : conversation,
      ),
    );
    try {
      await api.post(`/api/conversations/${conversationId}/read`, { messageId });
    } catch {
      // Не критично: отметка уйдёт при следующем открытии диалога.
    }
  }, []);

  const openConversation = useCallback(
    async (conversationId: number) => {
      setActiveId(conversationId);
      setMobileView('chat');
      setTyping([]);

      try {
        const [history, details] = await Promise.all([
          api.get<{ messages: ChatMessage[] }>(`/api/conversations/${conversationId}/messages`),
          api.get<{ members: Member[]; receipts: ReadReceipt[]; typing: TypingUser[] }>(
            `/api/conversations/${conversationId}`,
          ),
        ]);

        setMessages((prev) => ({ ...prev, [conversationId]: history.messages }));
        setMembers(details.members);
        setReceipts(details.receipts);
        setTyping(details.typing);

        const last = history.messages[history.messages.length - 1];
        if (last) void markRead(conversationId, last.id);
      } catch {
        setMessages((prev) => ({ ...prev, [conversationId]: prev[conversationId] ?? [] }));
      }
    },
    [markRead],
  );

  /** Уведомление о сообщении, пока окно свёрнуто или открыт другой чат. */
  const notify = useCallback(
    (message: ChatMessage, conversation: Conversation | undefined) => {
      if (message.senderId === me.id) return;
      if (conversation?.muted) return;
      if (windowFocused.current && activeIdRef.current === message.conversationId) return;
      if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;

      const title = conversation?.kind === 'group'
        ? `${message.senderName} · ${conversation.title}`
        : (message.senderName ?? 'Новое сообщение');

      const body = message.attachments.length > 0 && !message.body ? 'Вложение' : message.body;

      try {
        const notification = new Notification(title, {
          body: body.slice(0, 140),
          // Тег схлопывает подряд идущие уведомления из одного чата в одно.
          tag: `peremena-${message.conversationId}`,
          icon: '/icon.svg',
        });
        notification.onclick = () => {
          window.focus();
          void openConversation(message.conversationId);
          notification.close();
        };
      } catch {
        // Некоторые браузеры запрещают конструктор — не беда.
      }
    },
    [me.id, openConversation],
  );

  const handleEvent = useCallback(
    (type: StreamEvent, data: Record<string, unknown>) => {
      const conversationId = Number(data.conversationId ?? 0);

      switch (type) {
        case 'message.new': {
          const message = data.message as ChatMessage | undefined;
          if (!message) return;

          setMessages((prev) => {
            const list = prev[message.conversationId];
            // Чат ещё не открывали — история подтянется при открытии.
            if (!list) return prev;
            return { ...prev, [message.conversationId]: mergeMessage(list, message, me.id) };
          });

          let target: Conversation | undefined;
          setConversations((prev) => {
            const index = prev.findIndex((conversation) => conversation.id === message.conversationId);
            if (index === -1) {
              // Диалог новый для нас — перечитаем список целиком.
              void refreshConversations();
              return prev;
            }

            const conversation = prev[index];
            target = conversation;
            const isMine = message.senderId === me.id;
            const isOpen = activeIdRef.current === message.conversationId && windowFocused.current;

            const updated: Conversation = {
              ...conversation,
              unread: isMine || isOpen ? 0 : conversation.unread + 1,
              lastMessage: {
                id: message.id,
                body: message.body,
                kind: message.kind,
                createdAt: message.createdAt,
                senderId: message.senderId,
                senderName: message.senderName,
                deleted: message.deleted,
                hasAttachments: message.attachments.length > 0,
              },
            };

            // Свежий диалог поднимается наверх списка.
            const next = [...prev];
            next.splice(index, 1);
            return [updated, ...next];
          });

          // Пришедшее в открытый чат сразу считается прочитанным.
          if (activeIdRef.current === message.conversationId && windowFocused.current) {
            void markRead(message.conversationId, message.id);
          }

          // Печатавший только что отправил — убираем «печатает…».
          setTyping((prev) => prev.filter((user) => user.userId !== message.senderId));

          notify(message, target);
          return;
        }

        case 'message.edited': {
          const message = data.message as ChatMessage | undefined;
          if (!message) return;
          setMessages((prev) => {
            const list = prev[message.conversationId];
            if (!list) return prev;
            return {
              ...prev,
              [message.conversationId]: list.map((item) => (item.id === message.id ? message : item)),
            };
          });
          return;
        }

        case 'message.deleted': {
          const messageId = Number(data.messageId);
          setMessages((prev) => {
            const list = prev[conversationId];
            if (!list) return prev;
            return {
              ...prev,
              [conversationId]: list.map((item) =>
                item.id === messageId
                  ? { ...item, deleted: true, body: '', attachments: [], reactions: [] }
                  : item,
              ),
            };
          });
          return;
        }

        case 'reaction.changed': {
          const messageId = Number(data.messageId);
          const reactions = data.reactions as ChatMessage['reactions'] | undefined;
          if (!reactions) return;
          setMessages((prev) => {
            const list = prev[conversationId];
            if (!list) return prev;
            return {
              ...prev,
              [conversationId]: list.map((item) =>
                item.id === messageId
                  ? {
                      ...item,
                      // Флаг mine в событии посчитан для того, кто нажал, а не для нас,
                      // поэтому определяем по списку авторов реакции.
                      reactions: reactions.map((reaction) => ({
                        ...reaction,
                        mine: reaction.userIds.includes(me.id),
                      })),
                    }
                  : item,
              ),
            };
          });
          return;
        }

        case 'message.read': {
          const userId = Number(data.userId);
          const lastReadMessageId = Number(data.lastReadMessageId);
          if (conversationId !== activeIdRef.current) return;
          setReceipts((prev) => {
            const index = prev.findIndex((receipt) => receipt.userId === userId);
            if (index === -1) return prev;
            const next = [...prev];
            next[index] = { ...next[index], lastReadMessageId };
            return next;
          });
          return;
        }

        case 'typing': {
          const userId = Number(data.userId);
          if (userId === me.id || conversationId !== activeIdRef.current) return;
          const displayName = String(data.displayName ?? '');
          setTyping((prev) =>
            prev.some((user) => user.userId === userId) ? prev : [...prev, { userId, displayName }],
          );
          return;
        }

        case 'presence': {
          const person = data.user as Person | undefined;
          if (!person) return;
          // Обновляем карточку человека везде, где она показана.
          setConversations((prev) =>
            prev.map((conversation) =>
              conversation.partner?.id === person.id
                ? {
                    ...conversation,
                    partner: person,
                    title: person.displayName,
                    avatarColor: person.avatarColor,
                    avatarFileId: person.avatarFileId,
                  }
                : conversation,
            ),
          );
          setMembers((prev) =>
            prev.map((member) => (member.id === person.id ? { ...member, ...person } : member)),
          );
          return;
        }

        case 'conversation.created':
        case 'conversation.updated':
        case 'conversation.members': {
          void refreshConversations();
          if (conversationId && conversationId === activeIdRef.current) {
            void api
              .get<{ members: Member[] }>(`/api/conversations/${conversationId}/members`)
              .then((data) => setMembers(data.members))
              .catch(() => {});
          }
          return;
        }
      }
    },
    [markRead, me.displayName, me.id, notify, refreshConversations],
  );

  useEventStream({ onEvent: handleEvent, onStatusChange: setConnected });

  // «Печатает…» гаснет само: сервер шлёт сигнал раз в несколько секунд,
  // и если он перестал приходить — надпись убирается.
  useEffect(() => {
    if (typing.length === 0) return;
    const timer = setTimeout(() => setTyping([]), 5_000);
    return () => clearTimeout(timer);
  }, [typing]);

  const activeMessages = activeId ? (messages[activeId] ?? []) : [];

  const setActiveMessages = useCallback(
    (updater: (list: ChatMessage[]) => ChatMessage[]) => {
      const id = activeIdRef.current;
      if (id == null) return;
      setMessages((prev) => ({ ...prev, [id]: updater(prev[id] ?? []) }));
    },
    [],
  );

  /** Открывает личный диалог с человеком, создавая его при необходимости. */
  const startDirectChat = useCallback(
    async (personId: number) => {
      const data = await api.post<{ conversation: Conversation }>('/api/conversations', {
        kind: 'dm',
        userId: personId,
      });
      await refreshConversations();
      setShowNewChat(false);
      await openConversation(data.conversation.id);
    },
    [openConversation, refreshConversations],
  );

  const createGroup = useCallback(
    async (title: string, memberIds: number[]) => {
      const data = await api.post<{ conversation: Conversation }>('/api/conversations', {
        kind: 'group',
        title,
        memberIds,
      });
      await refreshConversations();
      setShowNewChat(false);
      await openConversation(data.conversation.id);
    },
    [openConversation, refreshConversations],
  );

  return (
    <div className="app" data-mobile-view={mobileView}>
      <Sidebar
        me={me}
        conversations={conversations}
        activeId={activeId}
        loading={loadingConversations}
        connected={connected}
        onSelect={openConversation}
        onNewChat={() => setShowNewChat(true)}
        onOpenProfile={() => setShowProfile(true)}
      />

      <ChatView
        me={me}
        conversation={activeConversation}
        messages={activeMessages}
        members={members}
        receipts={receipts}
        typing={typing}
        connected={connected}
        onBack={() => setMobileView('list')}
        onMessagesChange={setActiveMessages}
        onConversationsChange={refreshConversations}
        onMarkRead={markRead}
        onOpenPerson={startDirectChat}
      />

      {showNewChat ? (
        <NewChatDialog
          onClose={() => setShowNewChat(false)}
          onStartDirect={startDirectChat}
          onCreateGroup={createGroup}
        />
      ) : null}

      {showProfile ? (
        <ProfileDialog me={me} onClose={() => setShowProfile(false)} onUpdated={setMe} />
      ) : null}
    </div>
  );
}
