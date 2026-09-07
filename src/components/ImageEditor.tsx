'use client';

import { useEffect, useRef, useState } from 'react';
import { CloseIcon } from './Icons';

interface ImageEditorProps {
  file: File;
  onCancel: () => void;
  onDone: (file: File) => void;
}

type Tool = 'crop' | 'draw' | 'blur';

/** Цвета карандаша: яркие, чтобы читались на любой фотографии. */
const COLORS = ['#e5342b', '#f5a524', '#2fbf6b', '#3aa0f0', '#ffffff', '#101418'];

/**
 * Правка картинки перед отправкой: обрезать, замазать, подписать карандашом.
 *
 * Нужен ровно для школьных случаев: закрыть фамилию на списке, обвести нужную
 * строчку в расписании, отрезать лишнее с краю фотографии доски. Поэтому здесь
 * три инструмента и ни одного фильтра.
 *
 * Всё считается прямо в браузере, на canvas: картинка уезжает на сервер уже
 * изменённой, а исходник никуда не отправляется. Заодно она пережимается в
 * JPEG — место в базе общее на всю гимназию, и лишние мегабайты там дороги.
 */
export default function ImageEditor({ file, onCancel, onDone }: ImageEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sourceRef = useRef<HTMLImageElement | null>(null);
  // Каждый шаг сохраняем целиком: для трёх-четырёх правок это дешевле, чем
  // хранить список действий и уметь их отменять по одному.
  const historyRef = useRef<ImageData[]>([]);
  const drawing = useRef<{ x: number; y: number } | null>(null);
  const cropStart = useRef<{ x: number; y: number } | null>(null);

  const [tool, setTool] = useState<Tool>('draw');
  const [color, setColor] = useState(COLORS[0]);
  const [size, setSize] = useState(6);
  const [ready, setReady] = useState(false);
  const [crop, setCrop] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [busy, setBusy] = useState(false);

  // Загружаем картинку в canvas. Слишком большие уменьшаем сразу: телефонная
  // фотография на 4000 пикселей в ширину не нужна ни экрану, ни базе.
  useEffect(() => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const limit = 1600;
      const scale = Math.min(1, limit / Math.max(image.width, image.height));
      canvas.width = Math.round(image.width * scale);
      canvas.height = Math.round(image.height * scale);

      const ctx = canvas.getContext('2d');
      if (ctx) {
        // Белая подложка: прозрачные места PNG в JPEG иначе становятся чёрными,
        // и картинка с прозрачным фоном уходит собеседнику залитой чернотой.
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      }
      sourceRef.current = image;
      setReady(true);
      URL.revokeObjectURL(url);
    };
    image.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  /** Координаты нажатия в пикселях самой картинки, а не экрана. */
  function pointOf(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!;
    const box = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - box.left) / box.width) * canvas.width,
      y: ((event.clientY - box.top) / box.height) * canvas.height,
    };
  }

  function remember() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    historyRef.current.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
    // Больше десятка шагов назад никто не отменяет, а память они занимают.
    if (historyRef.current.length > 10) historyRef.current.shift();
  }

  function undo() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    const previous = historyRef.current.pop();
    if (!canvas || !ctx || !previous) return;
    canvas.width = previous.width;
    canvas.height = previous.height;
    ctx.putImageData(previous, 0, 0);
    setCrop(null);
  }

  /**
   * Размывание квадратом.
   *
   * Настоящий blur на canvas — это filter, но он размывает всё изображение
   * целиком. Здесь нужно замазать кусок, поэтому берём его отдельно, рисуем
   * сильно уменьшенным и растягиваем обратно: получается та самая «мозаика»,
   * из которой фамилию уже не прочитать. Именно этого от замазывания и ждут —
   * лёгкое размытие с телефона часто читается обратно.
   */
  function blurAt(x: number, y: number, radius: number) {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const left = Math.max(0, Math.round(x - radius));
    const top = Math.max(0, Math.round(y - radius));
    const width = Math.min(canvas.width - left, radius * 2);
    const height = Math.min(canvas.height - top, radius * 2);
    if (width <= 0 || height <= 0) return;

    const small = document.createElement('canvas');
    small.width = Math.max(1, Math.round(width / 12));
    small.height = Math.max(1, Math.round(height / 12));

    const smallCtx = small.getContext('2d');
    if (!smallCtx) return;
    smallCtx.drawImage(canvas, left, top, width, height, 0, 0, small.width, small.height);

    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(small, 0, 0, small.width, small.height, left, top, width, height);
    ctx.restore();
  }

  function applyCrop() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !crop || crop.w < 8 || crop.h < 8) return;

    remember();
    const piece = ctx.getImageData(crop.x, crop.y, crop.w, crop.h);
    canvas.width = crop.w;
    canvas.height = crop.h;
    ctx.putImageData(piece, 0, 0);
    setCrop(null);
  }

  async function done() {
    const canvas = canvasRef.current;
    if (!canvas) return;

    setBusy(true);

    // Считаем оба варианта и берём тот, что легче. Фотография в JPEG весит в
    // разы меньше, а снимок экрана с расписанием — наоборот: там плоские цвета
    // и мелкий текст, который JPEG размазывает, а PNG сжимает лучше.
    const [jpeg, png] = await Promise.all([
      // 0.85 — предел, за которым разница уже не видна, а вес растёт вдвое.
      new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85)),
      new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png')),
    ]);
    setBusy(false);

    const best = !png || (jpeg && jpeg.size <= png.size) ? jpeg : png;
    if (!best) return;

    const name = file.name.replace(/\.[^.]+$/, '') || 'картинка';
    const extension = best.type === 'image/png' ? 'png' : 'jpg';
    onDone(new File([best], `${name}.${extension}`, { type: best.type }));
  }

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div
        className="modal modal-wide"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal
        aria-label="Правка картинки"
      >
        <div className="modal-header">
          <h2 className="modal-title">Перед отправкой</h2>
          <button className="btn-ghost" onClick={onCancel} aria-label="Закрыть">
            <CloseIcon />
          </button>
        </div>

        <div className="modal-body">
          <div className="editor-tools">
            <button
              className={tool === 'draw' ? 'btn btn-small' : 'btn btn-quiet btn-small'}
              onClick={() => setTool('draw')}
            >
              Карандаш
            </button>
            <button
              className={tool === 'blur' ? 'btn btn-small' : 'btn btn-quiet btn-small'}
              onClick={() => setTool('blur')}
            >
              Замазать
            </button>
            <button
              className={tool === 'crop' ? 'btn btn-small' : 'btn btn-quiet btn-small'}
              onClick={() => {
                setTool('crop');
                setCrop(null);
              }}
            >
              Обрезать
            </button>
            <button
              className="btn btn-quiet btn-small"
              onClick={undo}
              disabled={historyRef.current.length === 0}
            >
              Отменить
            </button>
          </div>

          {tool === 'draw' ? (
            <div className="editor-colors">
              {COLORS.map((value) => (
                <button
                  key={value}
                  className={`color-dot${color === value ? ' is-active' : ''}`}
                  style={{ background: value }}
                  onClick={() => setColor(value)}
                  aria-label={`Цвет ${value}`}
                />
              ))}
            </div>
          ) : null}

          {tool !== 'crop' ? (
            <label className="field">
              <span className="field-label">Толщина</span>
              <input
                type="range"
                min={2}
                max={40}
                value={size}
                onChange={(event) => setSize(Number(event.target.value))}
              />
            </label>
          ) : (
            <p className="field-hint">
              {crop
                ? 'Отметили область — нажмите «Обрезать по рамке».'
                : 'Проведите по картинке, чтобы выделить, что оставить.'}
            </p>
          )}

          {/* Рамка обрезки кладётся поверх самого холста, а не всей области:
              иначе на узкой картинке она уезжала бы вбок. */}
          <div className="editor-stage">
            <div className="editor-frame">
            <canvas
              ref={canvasRef}
              className="editor-canvas"
              onPointerDown={(event) => {
                if (!ready) return;
                event.currentTarget.setPointerCapture(event.pointerId);
                const point = pointOf(event);

                if (tool === 'crop') {
                  cropStart.current = point;
                  setCrop({ x: point.x, y: point.y, w: 0, h: 0 });
                  return;
                }

                remember();
                drawing.current = point;
                if (tool === 'blur') blurAt(point.x, point.y, size * 2);
              }}
              onPointerMove={(event) => {
                const canvas = canvasRef.current;
                const ctx = canvas?.getContext('2d');
                if (!canvas || !ctx) return;

                const point = pointOf(event);

                if (tool === 'crop') {
                  const start = cropStart.current;
                  if (!start) return;
                  setCrop({
                    x: Math.min(start.x, point.x),
                    y: Math.min(start.y, point.y),
                    w: Math.abs(point.x - start.x),
                    h: Math.abs(point.y - start.y),
                  });
                  return;
                }

                const from = drawing.current;
                if (!from) return;

                if (tool === 'blur') {
                  blurAt(point.x, point.y, size * 2);
                } else {
                  ctx.strokeStyle = color;
                  ctx.lineWidth = size;
                  ctx.lineCap = 'round';
                  ctx.lineJoin = 'round';
                  ctx.beginPath();
                  ctx.moveTo(from.x, from.y);
                  ctx.lineTo(point.x, point.y);
                  ctx.stroke();
                }
                drawing.current = point;
              }}
              onPointerUp={() => {
                drawing.current = null;
                cropStart.current = null;
              }}
            />

            {crop && crop.w > 4 ? (
              <div
                className="editor-crop"
                style={{
                  left: `${(crop.x / (canvasRef.current?.width || 1)) * 100}%`,
                  top: `${(crop.y / (canvasRef.current?.height || 1)) * 100}%`,
                  width: `${(crop.w / (canvasRef.current?.width || 1)) * 100}%`,
                  height: `${(crop.h / (canvasRef.current?.height || 1)) * 100}%`,
                }}
              />
            ) : null}
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn btn-quiet" onClick={onCancel}>
            Отмена
          </button>
          {tool === 'crop' && crop && crop.w > 8 ? (
            <button className="btn btn-quiet" onClick={applyCrop}>
              Обрезать по рамке
            </button>
          ) : null}
          <button className="btn" onClick={() => void done()} disabled={!ready || busy}>
            {busy ? <span className="spinner" /> : null}
            Отправить
          </button>
        </div>
      </div>
    </div>
  );
}
