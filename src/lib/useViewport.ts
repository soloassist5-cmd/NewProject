'use client';

import { useEffect } from 'react';

/**
 * Держит высоту приложения равной видимой части экрана.
 *
 * Зачем это нужно. Единицы `dvh` учитывают исчезающую адресную строку, но не
 * учитывают экранную клавиатуру: на iOS при её появлении layout viewport
 * остаётся прежним, и строка ввода уезжает под клавиатуру. Реальную видимую
 * высоту знает только visualViewport — её и записываем в CSS-переменную.
 *
 * `--vv-offset` компенсирует сдвиг, который Safari делает сам, подскроллив
 * страницу к полю ввода: без него верх приложения оказывается за границей
 * экрана.
 */
export function useViewportHeight(): void {
  useEffect(() => {
    const viewport = window.visualViewport;
    const root = document.documentElement;

    if (!viewport) {
      // Старый браузер: dvh из CSS останется запасным вариантом.
      return;
    }

    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        root.style.setProperty('--app-height', `${Math.round(viewport.height)}px`);
        root.style.setProperty('--vv-offset', `${Math.round(viewport.offsetTop)}px`);
      });
    };

    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    window.addEventListener('orientationchange', update);

    return () => {
      cancelAnimationFrame(frame);
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
      window.removeEventListener('orientationchange', update);
      root.style.removeProperty('--app-height');
      root.style.removeProperty('--vv-offset');
    };
  }, []);
}
