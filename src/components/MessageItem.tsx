'use client';

import { useEffect, useRef, useState } from 'react';
import Avatar from './Avatar';
import { CheckDoubleIcon, CheckIcon, EditIcon, FileIcon, ReplyIcon, SmileIcon, TrashIcon } from './Icons';
import { api } from '@/lib/client';
import { formatFileSize, formatTime, linkify } from '@/lib/format';
import type { Attachment, ChatMessage, Conversation, Me } from '@/lib/types';

const QUICK_REACTIONS = ['👍', '❤️', '😂', '🔥', '👏', '😮', '😢'];

interface MessageItemProps {
  message: ChatMessage;
  me: Me;
  conversation: Conversation;
  isGroupStart: boolean;
  isRead: boolean;
  onReply: () => void;
  onEdit: () => void;
  onMessagesChange: (updater: (list: ChatMessage[]) => ChatMessage[]) => void;
  onOpenPerson: (personId: number) => void;
}

export default function MessageItem({
  message,
  me,
  conversation,
  isGroupStart,
  isRead,
  onReply,
  onEdit,
  onMessagesChange,
  onOpenPerson,
}: MessageItemProps) {
  const [showEmoji, setShowEmoji] = useState(false);
  // На тач-экранах наведения нет, поэтому действия открываются касанием.
  const [actionsOpen, setActionsOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const rowRef = useRef<HTMLDivElement | null>(null);

  // Закрываем выбор эмодзи и панель действий по нажатию мимо и по Escape.
  useEffect(() => {
    if (!showEmoji && !actionsOpen) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) setShowEmoji(false);
      if (!rowRef.current?.contains(event.target as Node)) setActionsOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowEmoji(false);
        setActionsOpen(false);
      }
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [showEmoji, actionsOpen]);

  if (message.kind === 'system') {
    return <div className="system-message">{message.body}</div>;
  }

  const isMine = message.senderId === me.id;
  const showAvatar = conversation.kind === 'group' && !isMine;

  async function toggleReaction(emoji: string) {
    setShowEmoji(false);
    try {
      const data = await api.post<{ reactions: ChatMessage['reactions'] }>(
        `/api/messages/${message.id}/reactions`,
        { emoji },
      );
      onMessagesChange((list) =>
        list.map((item) => (item.id === message.id ? { ...item, reactions: data.reactions } : item)),
      );
    } catch {
      // Реакция не поставилась — оставляем как было.
    }
  }

  async function remove() {
    if (!window.confirm('Удалить это сообщение?')) return;
    try {
      await api.delete(`/api/messages/${message.id}`);
      onMessagesChange((list) =>
        list.map((item) =>
          item.id === message.id
            ? { ...item, deleted: true, body: '', attachments: [], reactions: [] }
            : item,
        ),
      );
    } catch {
      // Тот же результат придёт событием, если удаление всё же прошло.
    }
  }

  return (
    <div
      ref={rowRef}
      className={[
        'message-row',
        isMine ? 'is-mine' : '',
        isGroupStart ? 'message-group-start' : '',
        actionsOpen ? 'is-open' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {showAvatar ? (
        <div className="message-avatar-slot">
          {isGroupStart ? (
            <button
              onClick={() => message.senderId && onOpenPerson(message.senderId)}
              title={message.senderName ?? ''}
              aria-label={`Написать: ${message.senderName ?? ''}`}
            >
              <Avatar
                name={message.senderName ?? '?'}
                color={message.senderColor ?? 'violet'}
                fileId={message.senderAvatarFileId}
                size={30}
              />
            </button>
          ) : null}
        </div>
      ) : null}

      <div
        className={`bubble${isGroupStart ? (isMine ? ' bubble-tail-out' : ' bubble-tail-in') : ''}`}
        onClick={(event) => {
          // Нажатие по ссылке, картинке или кнопке внутри пузыря — это
          // самостоятельное действие, панель показывать не нужно.
          if ((event.target as HTMLElement).closest('a, button')) return;
          setActionsOpen((open) => !open);
        }}
      >
        {showAvatar && isGroupStart ? (
          <div className="bubble-sender" style={{ color: 'var(--accent)' }}>
            {message.senderName}
          </div>
        ) : null}

        {message.replyTo ? (
          <div className="bubble-reply">
            <span className="bubble-reply-name">{message.replyTo.senderName ?? 'Неизвестный'}</span>
            <span className="bubble-reply-text">
              {message.replyTo.deleted ? 'Сообщение удалено' : message.replyTo.body || 'Вложение'}
            </span>
          </div>
        ) : null}

        {message.deleted ? (
          <div className="bubble-deleted">Сообщение удалено</div>
        ) : (
          <>
            {message.attachments.length > 0 ? (
              <div className="attachments">
                {message.attachments.map((attachment) => (
                  <AttachmentView key={attachment.id} attachment={attachment} />
                ))}
              </div>
            ) : null}

            {message.body ? <div className="bubble-text">{linkify(message.body)}</div> : null}
          </>
        )}

        <span className="bubble-meta">
          {message.editedAt ? <span title="Отредактировано">изм.</span> : null}
          {formatTime(message.createdAt)}
          {isMine && !message.pending ? (
            isRead ? (
              <CheckDoubleIcon />
            ) : (
              <CheckIcon />
            )
          ) : null}
          {message.pending ? <span title="Отправляется">⏳</span> : null}
          {message.failed ? <span title="Не отправлено">⚠️</span> : null}
        </span>

        {message.reactions.length > 0 ? (
          <div className="reactions">
            {message.reactions.map((reaction) => (
              <button
                key={reaction.emoji}
                className={`reaction${reaction.mine ? ' is-mine' : ''}`}
                onClick={() => void toggleReaction(reaction.emoji)}
                title={reaction.users.join(', ')}
              >
                <span>{reaction.emoji}</span>
                <span>{reaction.count}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {!message.deleted && !message.pending ? (
        <div className="message-actions">
          <div style={{ position: 'relative' }} ref={pickerRef}>
            <button
              className="message-action"
              onClick={() => setShowEmoji((open) => !open)}
              title="Реакция"
              aria-label="Поставить реакцию"
            >
              <SmileIcon />
            </button>
            {showEmoji ? (
              <div className="emoji-picker" style={isMine ? { right: 0 } : { left: 0 }}>
                {QUICK_REACTIONS.map((emoji) => (
                  <button key={emoji} onClick={() => void toggleReaction(emoji)} title={emoji}>
                    {emoji}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <button className="message-action" onClick={onReply} title="Ответить" aria-label="Ответить">
            <ReplyIcon />
          </button>

          {isMine ? (
            <button className="message-action" onClick={onEdit} title="Изменить" aria-label="Изменить">
              <EditIcon />
            </button>
          ) : null}

          {isMine || me.role === 'admin' ? (
            <button
              className="message-action"
              onClick={() => void remove()}
              title="Удалить"
              aria-label="Удалить"
            >
              <TrashIcon />
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function AttachmentView({ attachment }: { attachment: Attachment }) {
  const href = `/api/files/${attachment.id}`;

  if (attachment.mime.startsWith('image/') && attachment.mime !== 'image/svg+xml') {
    // Место под картинку резервируем заранее — иначе лента прыгает при загрузке.
    const ratio =
      attachment.width && attachment.height ? attachment.width / attachment.height : undefined;

    return (
      <a className="attachment-image" href={href} target="_blank" rel="noopener noreferrer">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={href}
          alt={attachment.name}
          loading="lazy"
          style={ratio ? { aspectRatio: String(ratio) } : undefined}
        />
      </a>
    );
  }

  return (
    <a className="attachment-file" href={href} target="_blank" rel="noopener noreferrer" download>
      <FileIcon />
      <span style={{ minWidth: 0 }}>
        <span className="attachment-file-name">{attachment.name}</span>
        <span className="attachment-file-size"> · {formatFileSize(attachment.size)}</span>
      </span>
    </a>
  );
}
