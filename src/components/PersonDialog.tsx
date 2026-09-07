'use client';

import { useEffect, useState } from 'react';
import Avatar from './Avatar';
import { CloseIcon, SendIcon } from './Icons';
import { api, ApiError } from '@/lib/client';
import { formatPresence, personSubtitle } from '@/lib/format';
import { rememberRecent } from '@/lib/recent';
import type { Person } from '@/lib/types';

interface PersonDialogProps {
  personId: number;
  /** Свой id: на собственную карточку кнопка «Написать» не нужна. */
  meId: number;
  onClose: () => void;
  onWrite: (personId: number) => void;
}

/**
 * Карточка человека — то, что открывается по нажатию на имя в чате или на
 * найденного в поиске.
 *
 * Раньше нажатие сразу создавало диалог: посмотреть, тот ли это Иванов, было
 * негде. Теперь сначала карточка, а переписка — отдельной кнопкой.
 */
export default function PersonDialog({ personId, meId, onClose, onWrite }: PersonDialogProps) {
  const [person, setPerson] = useState<Person | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api.get<{ user: Person }>(`/api/users/${personId}`);
        if (cancelled) return;
        setPerson(data.user);
        // Кого открывали — тот попадает в недавние. Пустой диалог в списке
        // чатов не остаётся, и вернуться к человеку иначе было бы негде.
        rememberRecent(data.user);
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof ApiError ? caught.message : 'Не удалось открыть профиль.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [personId]);

  const subtitle = person ? personSubtitle(person) : '';

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal modal-narrow"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal
        aria-label="Профиль человека"
      >
        <div className="modal-header">
          <h2 className="modal-title">Профиль</h2>
          <button className="btn-ghost" onClick={onClose} aria-label="Закрыть">
            <CloseIcon />
          </button>
        </div>

        <div className="modal-body">
          {error ? <div className="error-banner">{error}</div> : null}

          {!person && !error ? (
            <p className="list-section-title">Загружаем…</p>
          ) : person ? (
            <>
              <div className="person-card">
                <Avatar
                  name={person.displayName}
                  color={person.avatarColor}
                  fileId={person.avatarFileId}
                  size={84}
                  online={person.online}
                />
                <div className="person-card-name">{person.displayName}</div>
                <div className="person-card-handle">@{person.username}</div>
                {subtitle ? <div className="person-card-tag">{subtitle}</div> : null}
                <div className="person-card-presence">
                  {formatPresence(person.online, person.lastSeenAt)}
                </div>
              </div>

              {person.bio ? (
                <div className="field">
                  <span className="field-label">О себе</span>
                  <p className="person-card-bio">{person.bio}</p>
                </div>
              ) : null}
            </>
          ) : null}
        </div>

        <div className="modal-footer">
          <button className="btn btn-quiet" onClick={onClose}>
            Закрыть
          </button>
          {person && person.id !== meId ? (
            <button className="btn" onClick={() => onWrite(person.id)}>
              <SendIcon size={16} /> Написать
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
