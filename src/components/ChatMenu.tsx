'use client';

import { useEffect, useRef, useState } from 'react';
import {
  BanIcon,
  BellIcon,
  BellOffIcon,
  CameraIcon,
  EraserIcon,
  ListCheckIcon,
  LogoutIcon,
  MoreIcon,
  UserIcon,
  UsersIcon,
} from './Icons';
import type { Conversation, Me } from '@/lib/types';

interface ChatMenuProps {
  conversation: Conversation;
  me: Me;
  /** Создатель группы — только он меняет картинку и название. */
  isOwner: boolean;
  blocked: boolean;
  onOpenGroupInfo: () => void;
  onOpenPartner: () => void;
  onToggleMute: () => void;
  onSelectMessages: () => void;
  onClearHistory: () => void;
  onChangePhoto: () => void;
  onToggleBlock: () => void;
  onLeaveGroup: () => void;
}

/**
 * Меню чата — те действия, которым не нашлось места в шапке.
 *
 * Каждое из них выполняется редко, но искать его в трёх разных местах не
 * должно приходиться: одна кнопка, один список.
 */
export default function ChatMenu({
  conversation,
  me,
  isOwner,
  blocked,
  onOpenGroupInfo,
  onOpenPartner,
  onToggleMute,
  onSelectMessages,
  onClearHistory,
  onChangePhoto,
  onToggleBlock,
  onLeaveGroup,
}: ChatMenuProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Закрываем по нажатию мимо и по Escape — как ведёт себя любое такое меню.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const isGroup = conversation.kind === 'group';
  const canEditGroup = isGroup && (isOwner || me.role === 'admin');

  function item(action: () => void) {
    return () => {
      setOpen(false);
      action();
    };
  }

  return (
    <div className="chat-menu" ref={wrapRef}>
      <button
        className="btn-ghost"
        onClick={() => setOpen((prev) => !prev)}
        title="Ещё"
        aria-label="Меню чата"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <MoreIcon />
      </button>

      {open ? (
        <div className="menu-popup" role="menu">
          {isGroup ? (
            <button className="menu-item" role="menuitem" onClick={item(onOpenGroupInfo)}>
              <UsersIcon size={16} /> Участники и код
            </button>
          ) : (
            <button className="menu-item" role="menuitem" onClick={item(onOpenPartner)}>
              <UserIcon size={16} /> Профиль собеседника
            </button>
          )}

          {canEditGroup ? (
            <button className="menu-item" role="menuitem" onClick={item(onChangePhoto)}>
              <CameraIcon size={16} /> Картинка группы
            </button>
          ) : null}

          <button className="menu-item" role="menuitem" onClick={item(onToggleMute)}>
            {conversation.muted ? <BellIcon size={16} /> : <BellOffIcon size={16} />}
            {conversation.muted ? 'Включить уведомления' : 'Отключить уведомления'}
          </button>

          <button className="menu-item" role="menuitem" onClick={item(onSelectMessages)}>
            <ListCheckIcon size={16} /> Выбрать сообщения
          </button>

          <div className="menu-separator" />

          <button className="menu-item" role="menuitem" onClick={item(onClearHistory)}>
            <EraserIcon size={16} /> Очистить переписку
          </button>

          {isGroup ? (
            <button className="menu-item is-danger" role="menuitem" onClick={item(onLeaveGroup)}>
              <LogoutIcon size={16} /> Выйти из группы
            </button>
          ) : (
            <button
              className={`menu-item${blocked ? '' : ' is-danger'}`}
              role="menuitem"
              onClick={item(onToggleBlock)}
            >
              <BanIcon size={16} />
              {blocked ? 'Разблокировать' : 'Заблокировать'}
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
