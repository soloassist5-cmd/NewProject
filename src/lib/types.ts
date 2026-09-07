/** Формы данных, которыми обмениваются сервер и интерфейс. */

export interface Me {
  id: number;
  username: string;
  displayName: string;
  /** Класс вида «9О». У сотрудников гимназии пусто. */
  grade: string;
  avatarColor: string;
  avatarFileId: number | null;
  bio: string;
  role: string;
}

export interface Person {
  id: number;
  username: string;
  displayName: string;
  /** Класс вида «9О». У учителей пусто — вместо класса показывают должность. */
  grade: string;
  isTeacher: boolean;
  avatarColor: string;
  avatarFileId: number | null;
  bio: string;
  online: boolean;
  lastSeenAt: string | null;
}

export interface Member extends Person {
  role: string;
}

export interface Attachment {
  id: number;
  name: string;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
}

export interface Reaction {
  emoji: string;
  count: number;
  mine: boolean;
  users: string[];
  userIds: number[];
}

export interface ChatMessage {
  id: number;
  conversationId: number;
  senderId: number | null;
  senderName: string | null;
  senderUsername: string | null;
  senderColor: string | null;
  senderAvatarFileId: number | null;
  body: string;
  kind: string;
  createdAt: string;
  editedAt: string | null;
  deleted: boolean;
  replyTo: { id: number; senderName: string | null; body: string; deleted: boolean } | null;
  attachments: Attachment[];
  reactions: Reaction[];
  /** Проставляется только на клиенте, пока сообщение не подтверждено сервером. */
  pending?: boolean;
  /** Отправка не удалась — показываем возможность повторить. */
  failed?: boolean;
}

export interface Conversation {
  id: number;
  kind: 'dm' | 'group';
  title: string;
  avatarColor: string;
  avatarFileId: number | null;
  memberCount: number;
  muted: boolean;
  unread: number;
  lastReadMessageId: number;
  partner: Person | null;
  lastMessage: {
    id: number;
    body: string;
    kind: string;
    createdAt: string;
    senderId: number | null;
    senderName: string | null;
    deleted: boolean;
    hasAttachments: boolean;
  } | null;
}

export interface ReadReceipt {
  userId: number;
  displayName: string;
  lastReadMessageId: number;
}

export interface TypingUser {
  userId: number;
  displayName: string;
}
