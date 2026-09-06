'use client';

import { useEffect, useRef, useState } from 'react';
import { CloseIcon, FileIcon, PaperclipIcon, SendIcon } from './Icons';
import { api, ApiError } from '@/lib/client';
import { formatFileSize } from '@/lib/format';
import type { Attachment, ChatMessage, Conversation, Me } from '@/lib/types';

interface ComposerProps {
  conversation: Conversation;
  me: Me;
  replyTo: ChatMessage | null;
  editing: ChatMessage | null;
  onCancelReply: () => void;
  onCancelEdit: () => void;
  onMessagesChange: (updater: (list: ChatMessage[]) => ChatMessage[]) => void;
  onScrollToBottom: () => void;
}

interface PendingFile {
  attachment: Attachment;
  previewUrl: string | null;
}

/** Сигнал «печатаю» шлём не чаще одного раза в этот интервал. */
const TYPING_INTERVAL_MS = 3500;

export default function Composer({
  conversation,
  me,
  replyTo,
  editing,
  onCancelReply,
  onCancelEdit,
  onMessagesChange,
  onScrollToBottom,
}: ComposerProps) {
  const [text, setText] = useState('');
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const lastTypingSent = useRef(0);
  const tempIdRef = useRef(-1);

  // Переход в режим правки подставляет текст сообщения в поле ввода.
  useEffect(() => {
    if (editing) {
      setText(editing.body);
      textareaRef.current?.focus();
    }
  }, [editing]);

  // Смена диалога очищает черновик и вложения.
  useEffect(() => {
    setText('');
    setFiles([]);
    setError(null);
  }, [conversation.id]);

  // Освобождаем объектные URL превью, чтобы не держать картинки в памяти.
  useEffect(() => {
    return () => {
      for (const file of files) {
        if (file.previewUrl) URL.revokeObjectURL(file.previewUrl);
      }
    };
  }, [files]);

  // Поле растёт вместе с текстом, но не бесконечно.
  useEffect(() => {
    const node = textareaRef.current;
    if (!node) return;
    node.style.height = 'auto';
    node.style.height = `${Math.min(node.scrollHeight, 180)}px`;
  }, [text]);

  function signalTyping() {
    const now = Date.now();
    if (now - lastTypingSent.current < TYPING_INTERVAL_MS) return;
    lastTypingSent.current = now;
    void api.post(`/api/conversations/${conversation.id}/typing`).catch(() => {});
  }

  async function uploadFiles(list: FileList | File[]) {
    const incoming = Array.from(list);
    if (incoming.length === 0) return;

    setUploading(true);
    setError(null);

    for (const file of incoming) {
      if (files.length + incoming.length > 6) {
        setError('К одному сообщению можно приложить не больше шести файлов.');
        break;
      }

      const form = new FormData();
      form.append('file', file);

      try {
        const data = await api.post<{ file: Attachment }>('/api/files', form);
        setFiles((prev) => [
          ...prev,
          {
            attachment: data.file,
            previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
          },
        ]);
      } catch (caught) {
        setError(caught instanceof ApiError ? caught.message : 'Не удалось загрузить файл.');
      }
    }

    setUploading(false);
  }

  function removeFile(fileId: number) {
    setFiles((prev) => {
      const target = prev.find((file) => file.attachment.id === fileId);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((file) => file.attachment.id !== fileId);
    });
  }

  async function send() {
    const body = text.trim();
    if (uploading) return;
    if (!body && files.length === 0) return;

    // Правка идёт отдельным путём: новое сообщение не создаётся.
    if (editing) {
      const target = editing;
      setText('');
      onCancelEdit();
      try {
        const data = await api.patch<{ message: ChatMessage }>(`/api/messages/${target.id}`, { body });
        onMessagesChange((list) =>
          list.map((item) => (item.id === target.id ? data.message : item)),
        );
      } catch (caught) {
        setError(caught instanceof ApiError ? caught.message : 'Не удалось сохранить правку.');
      }
      return;
    }

    const attachmentIds = files.map((file) => file.attachment.id);
    const tempId = tempIdRef.current--;

    // Показываем сообщение сразу — ждать ответа сервера незачем.
    const optimistic: ChatMessage = {
      id: tempId,
      conversationId: conversation.id,
      senderId: me.id,
      senderName: me.displayName,
      senderUsername: me.username,
      senderColor: me.avatarColor,
      senderAvatarFileId: me.avatarFileId,
      body,
      kind: 'text',
      createdAt: new Date().toISOString(),
      editedAt: null,
      deleted: false,
      replyTo: replyTo
        ? {
            id: replyTo.id,
            senderName: replyTo.senderName,
            body: replyTo.body,
            deleted: replyTo.deleted,
          }
        : null,
      attachments: files.map((file) => file.attachment),
      reactions: [],
      pending: true,
    };

    onMessagesChange((list) => [...list, optimistic]);
    onScrollToBottom();

    const replyToId = replyTo?.id ?? null;
    setText('');
    setFiles([]);
    onCancelReply();

    // Отправка гасит «печатает…» на сервере, поэтому сбрасываем и дроссель:
    // иначе следующая строчка не подала бы сигнал ещё несколько секунд.
    lastTypingSent.current = 0;

    try {
      const data = await api.post<{ message: ChatMessage }>(
        `/api/conversations/${conversation.id}/messages`,
        { body, attachmentIds, replyToId },
      );

      onMessagesChange((list) => {
        // Событие из ленты могло опередить ответ — тогда заготовки уже нет.
        const withoutTemp = list.filter((item) => item.id !== tempId);
        return withoutTemp.some((item) => item.id === data.message.id)
          ? withoutTemp
          : [...withoutTemp, data.message].sort((a, b) => a.id - b.id);
      });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Сообщение не отправилось.');
      onMessagesChange((list) =>
        list.map((item) => (item.id === tempId ? { ...item, pending: false, failed: true } : item)),
      );
    }
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void send();
      return;
    }
    if (event.key === 'Escape') {
      if (editing) onCancelEdit();
      if (replyTo) onCancelReply();
      setText(editing ? '' : text);
    }
  }

  const canSend = (text.trim().length > 0 || files.length > 0) && !uploading;

  return (
    <div
      className="composer"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        if (event.dataTransfer.files.length > 0) void uploadFiles(event.dataTransfer.files);
      }}
    >
      <div className="typing-line" />

      {error ? (
        <div className="error-banner" style={{ marginBottom: 8 }} onClick={() => setError(null)}>
          {error}
        </div>
      ) : null}

      {editing ? (
        <div className="composer-reply">
          <div className="composer-reply-body">
            <div className="composer-reply-name">Редактирование</div>
            <div className="composer-reply-text">{editing.body}</div>
          </div>
          <button
            className="btn-ghost"
            onClick={() => {
              onCancelEdit();
              setText('');
            }}
            aria-label="Отменить редактирование"
          >
            <CloseIcon />
          </button>
        </div>
      ) : replyTo ? (
        <div className="composer-reply">
          <div className="composer-reply-body">
            <div className="composer-reply-name">Ответ · {replyTo.senderName}</div>
            <div className="composer-reply-text">{replyTo.body || 'Вложение'}</div>
          </div>
          <button className="btn-ghost" onClick={onCancelReply} aria-label="Отменить ответ">
            <CloseIcon />
          </button>
        </div>
      ) : null}

      {files.length > 0 ? (
        <div className="composer-pending">
          {files.map(({ attachment, previewUrl }) => (
            <div className="pending-file" key={attachment.id}>
              {previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={previewUrl} alt="" />
              ) : (
                <FileIcon />
              )}
              <div style={{ minWidth: 0 }}>
                <div className="pending-file-name">{attachment.name}</div>
                <div className="attachment-file-size">{formatFileSize(attachment.size)}</div>
              </div>
              <button
                className="btn-ghost"
                onClick={() => removeFile(attachment.id)}
                aria-label={`Убрать ${attachment.name}`}
              >
                <CloseIcon size={15} />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <div className="composer-box">
        <textarea
          ref={textareaRef}
          className="composer-input"
          value={text}
          rows={1}
          placeholder={editing ? 'Измените сообщение…' : 'Написать сообщение…'}
          onChange={(event) => {
            setText(event.target.value);
            signalTyping();
          }}
          onKeyDown={onKeyDown}
          onPaste={(event) => {
            // Картинку из буфера прикладываем как файл, а не вставляем ссылкой.
            const pasted = Array.from(event.clipboardData.files);
            if (pasted.length > 0) {
              event.preventDefault();
              void uploadFiles(pasted);
            }
          }}
          aria-label="Текст сообщения"
        />

        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          onChange={(event) => {
            if (event.target.files) void uploadFiles(event.target.files);
            event.target.value = '';
          }}
        />

        <button
          className="composer-btn"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          title="Прикрепить файл"
          aria-label="Прикрепить файл"
        >
          {uploading ? <span className="spinner" /> : <PaperclipIcon />}
        </button>

        <button
          className="composer-btn composer-send"
          onClick={() => void send()}
          disabled={!canSend}
          title="Отправить"
          aria-label="Отправить сообщение"
        >
          <SendIcon />
        </button>
      </div>
    </div>
  );
}
