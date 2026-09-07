'use client';

import { useEffect, useRef, useState } from 'react';
import { CloseIcon, DownloadIcon } from './Icons';

interface ImageViewerProps {
  src: string;
  name: string;
  onClose: () => void;
}

/**
 * Просмотр картинки поверх переписки.
 *
 * Раньше нажатие открывало файл отдельной вкладкой — в приложении это выглядит
 * как выпадение наружу, в браузер, откуда ещё надо суметь вернуться. Здесь
 * картинка открывается на месте: закрыл — и снова разговор.
 *
 * Масштаб — колесом, щипком и двойным нажатием; увеличенную картинку можно
 * таскать. Отдельная кнопка «сохранить» нужна потому, что долгое нажатие в
 * приложении меню не показывает.
 */
export default function ImageViewer({ src, name, onClose }: ImageViewerProps) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  // Расстояние между пальцами на прошлом шаге щипка.
  const pinch = useRef<number | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  function zoomTo(next: number) {
    const clamped = Math.min(6, Math.max(1, next));
    setScale(clamped);
    // Вернулись к единице — картинка снова по центру.
    if (clamped === 1) setOffset({ x: 0, y: 0 });
  }

  return (
    <div
      className="viewer-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal
      aria-label={`Картинка: ${name}`}
    >
      <div className="viewer-bar" onClick={(event) => event.stopPropagation()}>
        <span className="viewer-name">{name}</span>
        <a className="btn-ghost" href={src} download={name} title="Сохранить" aria-label="Сохранить картинку">
          <DownloadIcon />
        </a>
        <button className="btn-ghost" onClick={onClose} title="Закрыть" aria-label="Закрыть просмотр">
          <CloseIcon />
        </button>
      </div>

      <div
        className="viewer-stage"
        onClick={(event) => event.stopPropagation()}
        onWheel={(event) => zoomTo(scale - event.deltaY * 0.002)}
        onDoubleClick={() => zoomTo(scale > 1 ? 1 : 2.5)}
        onPointerDown={(event) => {
          if (scale === 1) return;
          drag.current = { x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const start = drag.current;
          if (!start) return;
          setOffset({
            x: start.ox + (event.clientX - start.x),
            y: start.oy + (event.clientY - start.y),
          });
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onTouchMove={(event) => {
          if (event.touches.length !== 2) return;
          const [a, b] = [event.touches[0], event.touches[1]];
          const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
          if (pinch.current !== null) zoomTo(scale * (distance / pinch.current));
          pinch.current = distance;
        }}
        onTouchEnd={() => {
          pinch.current = null;
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className="viewer-image"
          src={src}
          alt={name}
          draggable={false}
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
            cursor: scale > 1 ? 'grab' : 'zoom-in',
          }}
        />
      </div>

      <div className="viewer-hint">
        {scale > 1 ? 'Двойное нажатие — обратно' : 'Двойное нажатие или щипок — увеличить'}
      </div>
    </div>
  );
}
