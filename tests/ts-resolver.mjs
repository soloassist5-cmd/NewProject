/**
 * Резолвер модулей для модульных тестов.
 *
 * В исходниках импорты пишутся без расширения («./config») и через алиас
 * «@/lib/...» — так их понимает сборщик Next. Голый Node ESM так не умеет,
 * поэтому для `node --test` дописываем расширение и разворачиваем алиас.
 * Это нужно только тестам; на сборку приложения никак не влияет.
 */

import { existsSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { register } from 'node:module';

const projectRoot = resolvePath(dirname(fileURLToPath(import.meta.url)), '..');

export function resolve(specifier, context, nextResolve) {
  let target = specifier;

  // Алиас «@/» указывает на каталог src.
  if (target.startsWith('@/')) {
    target = pathToFileURL(resolvePath(projectRoot, 'src', target.slice(2))).href;
  }

  const isRelative = target.startsWith('./') || target.startsWith('../');
  const isFileUrl = target.startsWith('file:');

  if ((isRelative || isFileUrl) && !/\.[a-z]+$/i.test(target)) {
    const base = isFileUrl
      ? fileURLToPath(target)
      : resolvePath(dirname(fileURLToPath(context.parentURL)), target);

    for (const extension of ['.ts', '.tsx', '.mts', '.js']) {
      if (existsSync(base + extension)) {
        return nextResolve(pathToFileURL(base + extension).href, context);
      }
    }
  }

  return nextResolve(target, context);
}

// Регистрируем сами себя, когда файл подключён через --import.
if (!process.env.PEREMENA_RESOLVER_REGISTERED) {
  process.env.PEREMENA_RESOLVER_REGISTERED = '1';
  register(import.meta.url);
}
