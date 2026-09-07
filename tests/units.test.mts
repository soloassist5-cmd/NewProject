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
import {
  parseEmoji,
  parseGrade,
  parseJoinCode,
  parseMessageBody,
  parseNewUserRole,
  parseStudentGrade,
  parseUsername,
  ValidationError,
} from '../src/lib/validate.ts';

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

describe('Класс гимназии', () => {
  it('принимает класс с любой из литер', () => {
    assert.equal(parseGrade('9О'), '9О');
    assert.equal(parseGrade('11Г'), '11Г');
    assert.equal(parseGrade('1Э'), '1Э');
  });

  it('чистит регистр и пробелы', () => {
    assert.equal(parseGrade('  9 о '), '9О');
  });

  it('подменяет латиницу, похожую на кириллицу', () => {
    // «9O» с латинской O выглядит как «9О», но не совпало бы с ним нигде.
    assert.equal(parseGrade('9O'), '9О');
    assert.equal(parseGrade('11E'), '11Э');
  });

  it('пустая строка — это сотрудник без класса', () => {
    assert.equal(parseGrade(''), '');
    assert.equal(parseGrade(null), '');
  });

  it('отклоняет чужую литеру и несуществующую параллель', () => {
    assert.throws(() => parseGrade('9Ю'), ValidationError);
    assert.throws(() => parseGrade('14О'), ValidationError);
    assert.throws(() => parseGrade('0О'), ValidationError);
  });

  it('отклоняет бессмыслицу', () => {
    assert.throws(() => parseGrade('класс'), ValidationError);
    assert.throws(() => parseGrade('9'), ValidationError);
  });

  it('при регистрации класс обязателен', () => {
    assert.equal(parseStudentGrade('9о'), '9О');
    assert.throws(() => parseStudentGrade(''), ValidationError);
    assert.throws(() => parseStudentGrade(null), ValidationError);
    assert.throws(() => parseStudentGrade(undefined), ValidationError);
  });
});

describe('Роль нового аккаунта', () => {
  it('по умолчанию — ученик', () => {
    assert.equal(parseNewUserRole(undefined), 'member');
    assert.equal(parseNewUserRole(''), 'member');
  });

  it('разрешает завести учителя', () => {
    assert.equal(parseNewUserRole('teacher'), 'teacher');
    assert.equal(parseNewUserRole('member'), 'member');
  });

  it('администратора через панель не выдаёт', () => {
    assert.throws(() => parseNewUserRole('admin'), ValidationError);
    assert.throws(() => parseNewUserRole('owner'), ValidationError);
    assert.throws(() => parseNewUserRole(['admin']), ValidationError);
  });
});

describe('Код группы', () => {
  it('приводит к верхнему регистру и убирает пробелы с дефисами', () => {
    assert.equal(parseJoinCode(' cfh6qk '), 'CFH6QK');
    assert.equal(parseJoinCode('CFH-6QK'), 'CFH6QK');
  });

  it('отклоняет неверную длину', () => {
    assert.throws(() => parseJoinCode('ABC'), ValidationError);
    assert.throws(() => parseJoinCode('ABCDEFGH'), ValidationError);
  });

  it('отклоняет символы, которых в кодах не бывает', () => {
    // Похожие друг на друга O/0 и I/1/L из алфавита исключены.
    assert.throws(() => parseJoinCode('CFH6QO'), ValidationError);
    assert.throws(() => parseJoinCode('CFH6Q0'), ValidationError);
    assert.throws(() => parseJoinCode('CFH6QI'), ValidationError);
  });
});
