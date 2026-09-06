/**
 * Модульные проверки чистых функций — тех, где логика неочевидна и легко
 * ошибиться незаметно. Базы и сервера здесь не нужно.
 *
 * Запуск: npm run test:unit
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { imageSize } from '../src/lib/imagesize.ts';
import { initials } from '../src/lib/format.ts';
import { parseEmoji, parseMessageBody, parseUsername, ValidationError } from '../src/lib/validate.ts';

describe('Размеры картинки из заголовка', () => {
  it('читает PNG', () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8Dwn4GBgYGJAQ0AABvOAQEUOgn0AAAAAElFTkSuQmCC',
      'base64',
    );
    assert.deepEqual(imageSize(png, 'image/png'), { width: 2, height: 2 });
  });

  it('читает GIF', () => {
    // GIF87a, 3×5 пикселей — размеры лежат в байтах 6..10 в обратном порядке.
    const gif = Buffer.from([
      0x47, 0x49, 0x46, 0x38, 0x37, 0x61, 0x03, 0x00, 0x05, 0x00, 0x00, 0x00, 0x00,
    ]);
    assert.deepEqual(imageSize(gif, 'image/gif'), { width: 3, height: 5 });
  });

  it('не падает на обрезанном файле', () => {
    assert.equal(imageSize(Buffer.from([0x89, 0x50]), 'image/png'), null);
  });

  it('не падает на мусоре вместо картинки', () => {
    assert.equal(imageSize(Buffer.from('это вообще не картинка'), 'image/jpeg'), null);
  });
});

describe('Инициалы для аватара', () => {
  it('берёт первые буквы имени и фамилии', () => {
    assert.equal(initials('Аня Смирнова'), 'АС');
  });

  it('из одного слова берёт две буквы', () => {
    assert.equal(initials('Аня'), 'АН');
  });

  it('пропускает кавычки в названии группы', () => {
    assert.equal(initials('9 «Б»'), '9Б');
  });

  it('не ломается на пустой строке', () => {
    assert.equal(initials('   '), '?');
  });
});

describe('Проверка ввода', () => {
  it('приводит имя пользователя к нижнему регистру', () => {
    assert.equal(parseUsername('  AnYa_2026 '), 'anya_2026');
  });

  it('отклоняет кириллицу в имени пользователя', () => {
    assert.throws(() => parseUsername('аня'), ValidationError);
  });

  it('отклоняет слишком короткое имя пользователя', () => {
    assert.throws(() => parseUsername('ан'), ValidationError);
  });

  it('схлопывает длинные серии переводов строк', () => {
    assert.equal(parseMessageBody('раз\n\n\n\n\n\nдва'), 'раз\n\n\nдва');
  });

  it('принимает составную эмодзи как одну реакцию', () => {
    // Эмодзи из нескольких кодовых точек должна считаться одним символом.
    assert.equal(parseEmoji('👨‍👩‍👧'), '👨‍👩‍👧');
    assert.equal(parseEmoji('❤️'), '❤️');
  });

  it('отклоняет буквы и две эмодзи подряд', () => {
    assert.throws(() => parseEmoji('да'), ValidationError);
    assert.throws(() => parseEmoji('👍👍'), ValidationError);
  });
});
