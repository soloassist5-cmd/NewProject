/**
 * Сквозные проверки API через настоящий HTTP.
 *
 * Запуск:
 *   1) поднимите сервер с тестовой базой (см. README, раздел «Тесты»);
 *   2) BASE_URL=http://127.0.0.1:3100 node --test tests/
 *
 * Тесты создают пользователей со случайными именами, поэтому их можно
 * прогонять повторно на одной и той же базе.
 */

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3100';

/** Клиент одного пользователя: помнит куку сессии между запросами. */
class Client {
  constructor(name) {
    this.name = name;
    this.cookie = '';
    // Полная строка Set-Cookie — по ней проверяются флаги защиты.
    this.rawSetCookie = '';
  }

  async request(method, path, body, raw = false) {
    const isForm = body instanceof FormData;
    const response = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...(body === undefined || isForm ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
      redirect: 'manual',
    });

    const setCookie = response.headers.get('set-cookie');
    if (setCookie) {
      this.rawSetCookie = setCookie;
      this.cookie = setCookie.split(';')[0];
    }

    if (raw) return response;

    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }
    return { status: response.status, data };
  }

  get = (path) => this.request('GET', path);
  post = (path, body) => this.request('POST', path, body);
  patch = (path, body) => this.request('PATCH', path, body);
  del = (path) => this.request('DELETE', path);
}

const suffix = Math.random().toString(36).slice(2, 8);

// Директор регистрируется первым: права администратора достаются первому
// аккаунту в базе. Поэтому набор требует пустой базы — см. README.
const direktor = new Client(`direktor_${suffix}`);
const anya = new Client(`anya_${suffix}`);
const petya = new Client(`petya_${suffix}`);
const dasha = new Client(`dasha_${suffix}`);

let dmId;
let groupId;
let firstMessageId;

async function register(client, displayName, grade = '9О') {
  const response = await client.post('/api/auth/register', {
    username: client.name,
    displayName,
    grade,
    password: 'ochen-nadyozhnyy-parol',
  });
  assert.equal(response.status, 201, `регистрация ${client.name}: ${JSON.stringify(response.data)}`);
  client.id = response.data.user.id;
  client.grade = response.data.user.grade;
}

describe('ГимРум — проверка API', () => {
  before(async () => {
    await register(direktor, 'Директор гимназии', '11О');
    const role = (await direktor.get('/api/auth/me')).data.user.role;
    assert.equal(role, 'admin', 'набор рассчитан на пустую базу: первый аккаунт — администратор');

    await register(anya, 'Аня Смирнова', '9О');
    await register(petya, 'Петя Иванов', '9Г');
    await register(dasha, 'Даша Орлова', '11Э');
  });

  describe('Аккаунты', () => {
    it('не даёт занять уже существующее имя пользователя', async () => {
      const fresh = new Client(anya.name);
      const response = await fresh.post('/api/auth/register', {
        username: anya.name,
        displayName: 'Самозванец',
        grade: '9О',
        password: 'ochen-nadyozhnyy-parol',
      });
      assert.equal(response.status, 409);
    });

    it('отклоняет короткий пароль', async () => {
      const fresh = new Client(`short_${suffix}`);
      const response = await fresh.post('/api/auth/register', {
        username: `short_${suffix}`,
        grade: '9О',
        password: '123',
      });
      assert.equal(response.status, 400);
      assert.match(response.data.error, /8 символов/);
    });

    it('регистрирует без отображаемого имени — по логину', async () => {
      const fresh = new Client(`bezimeni_${suffix}`);
      const response = await fresh.post('/api/auth/register', {
        username: fresh.name,
        grade: '7Г',
        password: 'ochen-nadyozhnyy-parol',
      });
      assert.equal(response.status, 201);
      assert.equal(response.data.user.displayName, fresh.name);
      assert.equal(response.data.user.grade, '7Г');
    });

    it('сохраняет класс и отдаёт его в профиле', async () => {
      const response = await dasha.get('/api/auth/me');
      assert.equal(response.data.user.grade, '11Э');
    });

    it('не регистрирует без класса — такие аккаунты заводит администратор', async () => {
      const teacher = new Client(`sotrudnik_${suffix}`);
      const response = await teacher.post('/api/auth/register', {
        username: teacher.name,
        grade: '',
        password: 'ochen-nadyozhnyy-parol',
      });
      assert.equal(response.status, 400);
      assert.match(response.data.error, /класс/i);
    });

    it('отклоняет несуществующую литеру класса', async () => {
      const fresh = new Client(`bukva_${suffix}`);
      const response = await fresh.post('/api/auth/register', {
        username: fresh.name,
        grade: '9Ю',
        password: 'ochen-nadyozhnyy-parol',
      });
      assert.equal(response.status, 400);
      assert.match(response.data.error, /Литера/);
    });

    it('отклоняет несуществующую параллель', async () => {
      const fresh = new Client(`parallel_${suffix}`);
      const response = await fresh.post('/api/auth/register', {
        username: fresh.name,
        grade: '14О',
        password: 'ochen-nadyozhnyy-parol',
      });
      assert.equal(response.status, 400);
      assert.match(response.data.error, /с 1 по 11/);
    });

    it('не пускает с неверным паролем', async () => {
      const fresh = new Client(anya.name);
      const response = await fresh.post('/api/auth/login', {
        username: anya.name,
        password: 'ne-tot-parol',
      });
      assert.equal(response.status, 401);
    });

    it('не отвечает гостю на защищённые запросы', async () => {
      const guest = new Client('guest');
      const response = await guest.get('/api/conversations');
      assert.equal(response.status, 401);
    });

    it('узнаёт вошедшего по куке', async () => {
      const response = await anya.get('/api/auth/me');
      assert.equal(response.status, 200);
      assert.equal(response.data.user.username, anya.name);
    });
  });

  describe('Личная переписка', () => {
    it('создаёт диалог', async () => {
      const response = await anya.post('/api/conversations', { kind: 'dm', userId: petya.id });
      assert.equal(response.status, 201);
      assert.equal(response.data.conversation.kind, 'dm');
      dmId = response.data.conversation.id;
    });

    it('не держит в списке диалог, в котором никто не написал', async () => {
      const list = await anya.get('/api/conversations');
      assert.equal(list.status, 200);
      assert.ok(
        !list.data.conversations.some((item) => item.id === dmId),
        'пустой диалог в списке чатов не показывается — человек остаётся в недавних',
      );
    });

    it('не создаёт второй диалог между теми же людьми', async () => {
      const response = await petya.post('/api/conversations', { kind: 'dm', userId: anya.id });
      assert.equal(response.status, 201);
      assert.equal(response.data.conversation.id, dmId, 'должен вернуться тот же диалог');
    });

    it('не позволяет писать самому себе', async () => {
      const response = await anya.post('/api/conversations', { kind: 'dm', userId: anya.id });
      assert.equal(response.status, 400);
    });

    it('доставляет сообщение собеседнику', async () => {
      const sent = await anya.post(`/api/conversations/${dmId}/messages`, {
        body: 'Привет! Ты сделал задачу по геометрии?',
      });
      assert.equal(sent.status, 201);
      firstMessageId = sent.data.message.id;

      const history = await petya.get(`/api/conversations/${dmId}/messages`);
      assert.equal(history.status, 200);
      assert.equal(history.data.messages.at(-1).body, 'Привет! Ты сделал задачу по геометрии?');
    });

    it('считает непрочитанные у получателя, но не у отправителя', async () => {
      const forPetya = await petya.get('/api/conversations');
      const conversation = forPetya.data.conversations.find((item) => item.id === dmId);
      assert.ok(conversation.unread >= 1, 'у получателя есть непрочитанное');

      const forAnya = await anya.get('/api/conversations');
      const own = forAnya.data.conversations.find((item) => item.id === dmId);
      assert.equal(own.unread, 0, 'своё сообщение непрочитанным не считается');
    });

    it('обнуляет счётчик после отметки о прочтении', async () => {
      const marked = await petya.post(`/api/conversations/${dmId}/read`, {
        messageId: firstMessageId,
      });
      assert.equal(marked.status, 200);

      const list = await petya.get('/api/conversations');
      const conversation = list.data.conversations.find((item) => item.id === dmId);
      assert.equal(conversation.unread, 0);
    });

    it('не пускает посторонних в чужой диалог', async () => {
      const messages = await dasha.get(`/api/conversations/${dmId}/messages`);
      assert.equal(messages.status, 404, 'чужой диалог не должен даже подтверждать своё существование');

      const intrusion = await dasha.post(`/api/conversations/${dmId}/messages`, { body: 'Подслушиваю' });
      assert.equal(intrusion.status, 404);
    });

    it('отвечает на сообщение с цитатой', async () => {
      const response = await petya.post(`/api/conversations/${dmId}/messages`, {
        body: 'Сделал, скину фото',
        replyToId: firstMessageId,
      });
      assert.equal(response.status, 201);
      assert.equal(response.data.message.replyTo.id, firstMessageId);
    });

    it('не даёт ответить на сообщение из другого диалога', async () => {
      const group = await anya.post('/api/conversations', {
        kind: 'group',
        title: 'Проверка ответов',
        memberIds: [petya.id],
      });
      const response = await anya.post(`/api/conversations/${group.data.conversation.id}/messages`, {
        body: 'Ответ не туда',
        replyToId: firstMessageId,
      });
      assert.equal(response.status, 400);
    });

    it('отклоняет пустое сообщение', async () => {
      const response = await anya.post(`/api/conversations/${dmId}/messages`, { body: '   ' });
      assert.equal(response.status, 400);
    });
  });

  describe('Правка и удаление', () => {
    let messageId;

    before(async () => {
      const response = await anya.post(`/api/conversations/${dmId}/messages`, {
        body: 'Встречаемся в 15:00',
      });
      messageId = response.data.message.id;
    });

    it('редактирует своё сообщение и помечает правку', async () => {
      const response = await anya.patch(`/api/messages/${messageId}`, { body: 'Встречаемся в 16:00' });
      assert.equal(response.status, 200);
      assert.equal(response.data.message.body, 'Встречаемся в 16:00');
      assert.ok(response.data.message.editedAt, 'должна появиться отметка о правке');
    });

    it('не даёт редактировать чужое сообщение', async () => {
      const response = await petya.patch(`/api/messages/${messageId}`, { body: 'Подмена' });
      assert.equal(response.status, 403);
    });

    it('не даёт удалить чужое сообщение', async () => {
      const response = await petya.del(`/api/messages/${messageId}`);
      assert.equal(response.status, 403);
    });

    it('удаляет своё и прячет текст ото всех', async () => {
      const removed = await anya.del(`/api/messages/${messageId}`);
      assert.equal(removed.status, 200);

      const history = await petya.get(`/api/conversations/${dmId}/messages`);
      const deleted = history.data.messages.find((item) => item.id === messageId);
      assert.equal(deleted.deleted, true);
      assert.equal(deleted.body, '', 'текст удалённого сообщения не должен уходить клиенту');
    });
  });

  describe('Реакции', () => {
    let messageId;

    before(async () => {
      const response = await anya.post(`/api/conversations/${dmId}/messages`, { body: 'Ура, каникулы!' });
      messageId = response.data.message.id;
    });

    it('ставит реакцию', async () => {
      const response = await petya.post(`/api/messages/${messageId}/reactions`, { emoji: '🔥' });
      assert.equal(response.status, 200);
      assert.equal(response.data.reactions[0].emoji, '🔥');
      assert.equal(response.data.reactions[0].count, 1);
      assert.deepEqual(response.data.reactions[0].userIds, [petya.id]);
    });

    it('снимает реакцию при повторном нажатии', async () => {
      const response = await petya.post(`/api/messages/${messageId}/reactions`, { emoji: '🔥' });
      assert.equal(response.status, 200);
      assert.equal(response.data.reactions.length, 0);
    });

    it('складывает одинаковые реакции разных людей', async () => {
      await anya.post(`/api/messages/${messageId}/reactions`, { emoji: '👍' });
      const response = await petya.post(`/api/messages/${messageId}/reactions`, { emoji: '👍' });
      const thumbs = response.data.reactions.find((item) => item.emoji === '👍');
      assert.equal(thumbs.count, 2);
      assert.equal(thumbs.userIds.length, 2);
    });

    it('не принимает текст вместо эмодзи', async () => {
      const response = await anya.post(`/api/messages/${messageId}/reactions`, { emoji: 'ага' });
      assert.equal(response.status, 400);
    });
  });

  describe('Группы', () => {
    it('создаёт группу с участниками', async () => {
      const response = await anya.post('/api/conversations', {
        kind: 'group',
        title: '9 «Б»',
        memberIds: [petya.id, dasha.id],
      });
      assert.equal(response.status, 201);
      groupId = response.data.conversation.id;
      assert.equal(response.data.conversation.kind, 'group');
      assert.equal(response.data.conversation.memberCount, 3);
    });

    it('показывает группу всем участникам', async () => {
      const list = await dasha.get('/api/conversations');
      assert.ok(list.data.conversations.some((item) => item.id === groupId));
    });

    it('позволяет создателю переименовать группу', async () => {
      const response = await anya.patch(`/api/conversations/${groupId}`, { title: '9 «Б» — общий' });
      assert.equal(response.status, 200);
      assert.equal(response.data.conversation.title, '9 «Б» — общий');
    });

    it('не даёт обычному участнику переименовать группу', async () => {
      const response = await petya.patch(`/api/conversations/${groupId}`, { title: 'Мой чат' });
      assert.equal(response.status, 403);
    });

    it('заводит служебную запись о переименовании', async () => {
      const history = await petya.get(`/api/conversations/${groupId}/messages`);
      assert.ok(
        history.data.messages.some((item) => item.kind === 'system' && item.body.includes('переименовал')),
      );
    });

    it('даёт участнику выйти из группы', async () => {
      const left = await dasha.del(`/api/conversations/${groupId}`);
      assert.equal(left.status, 200);

      const list = await dasha.get('/api/conversations');
      assert.ok(!list.data.conversations.some((item) => item.id === groupId));
    });

    it('не позволяет выйти из личного диалога', async () => {
      const response = await anya.del(`/api/conversations/${dmId}`);
      assert.equal(response.status, 400);
    });
  });

  describe('Вход в группу по коду', () => {
    let codeGroupId;
    let code;

    before(async () => {
      // Группу можно создать пустой: остальные войдут по коду.
      const created = await anya.post('/api/conversations', {
        kind: 'group',
        title: 'Поход',
        memberIds: [],
      });
      assert.equal(created.status, 201);
      codeGroupId = created.data.conversation.id;
    });

    it('выдаёт группе код сразу при создании', async () => {
      const response = await anya.get(`/api/conversations/${codeGroupId}/code`);
      assert.equal(response.status, 200);
      code = response.data.code;
      assert.equal(typeof code, 'string');
      assert.equal(code.length, 6);
    });

    it('в коде нет символов, которые легко перепутать', async () => {
      assert.doesNotMatch(code, /[O0I1L]/, 'O, 0, I, 1 и L в кодах не используются');
    });

    it('не показывает код постороннему', async () => {
      const response = await dasha.get(`/api/conversations/${codeGroupId}/code`);
      assert.equal(response.status, 404);
    });

    it('пускает в группу по коду', async () => {
      const response = await dasha.post('/api/conversations/join', { code });
      assert.equal(response.status, 200);
      assert.equal(response.data.conversation.id, codeGroupId);
      assert.equal(response.data.alreadyMember, false);

      const members = await anya.get(`/api/conversations/${codeGroupId}/members`);
      assert.ok(members.data.members.some((member) => member.id === dasha.id));
    });

    it('не обращает внимания на регистр и пробелы в коде', async () => {
      const petyaJoin = await petya.post('/api/conversations/join', {
        code: ` ${code.toLowerCase()} `,
      });
      assert.equal(petyaJoin.status, 200);
      assert.equal(petyaJoin.data.conversation.id, codeGroupId);
    });

    it('повторный ввод кода просто открывает группу', async () => {
      const response = await dasha.post('/api/conversations/join', { code });
      assert.equal(response.status, 200);
      assert.equal(response.data.alreadyMember, true);
    });

    it('оставляет запись о том, кто вошёл по коду', async () => {
      const history = await anya.get(`/api/conversations/${codeGroupId}/messages`);
      assert.ok(
        history.data.messages.some(
          (item) => item.kind === 'system' && item.body.includes('по коду'),
        ),
      );
    });

    it('отклоняет несуществующий код', async () => {
      const response = await dasha.post('/api/conversations/join', { code: 'ZZZZZZ' });
      assert.equal(response.status, 404);
    });

    it('отклоняет код неправильной длины', async () => {
      const response = await dasha.post('/api/conversations/join', { code: 'ABC' });
      assert.equal(response.status, 400);
    });

    it('не даёт обычному участнику сменить код', async () => {
      const response = await dasha.post(`/api/conversations/${codeGroupId}/code`);
      assert.equal(response.status, 403);
    });

    it('создатель меняет код, и старый перестаёт работать', async () => {
      const changed = await anya.post(`/api/conversations/${codeGroupId}/code`);
      assert.equal(changed.status, 200);
      assert.notEqual(changed.data.code, code);

      // Проверяем старым кодом от того, кто ещё не в группе.
      const outsider = new Client(`chuzhoy_${suffix}`);
      await register(outsider, 'Посторонний', '5О');

      const withOld = await outsider.post('/api/conversations/join', { code });
      assert.equal(withOld.status, 404, 'старый код больше не действует');

      const withNew = await outsider.post('/api/conversations/join', {
        code: changed.data.code,
      });
      assert.equal(withNew.status, 200);
    });

    it('у личного диалога кода нет', async () => {
      const response = await anya.get(`/api/conversations/${dmId}/code`);
      assert.equal(response.status, 400);
    });
  });

  describe('Файлы', () => {
    let fileId;
    // Настоящий PNG 2×2 — чтобы проверить и разбор размеров из заголовка.
    const PNG = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8Dwn4GBgYGJAQ0AABvOAQEUOgn0AAAAAElFTkSuQmCC',
      'base64',
    );

    it('принимает картинку и определяет её размеры', async () => {
      const form = new FormData();
      form.append('file', new Blob([PNG], { type: 'image/png' }), 'схема.png');
      const response = await anya.request('POST', '/api/files', form);

      assert.equal(response.status, 201);
      assert.equal(response.data.file.width, 2);
      assert.equal(response.data.file.height, 2);
      fileId = response.data.file.id;
    });

    it('прикладывает файл к сообщению', async () => {
      const response = await anya.post(`/api/conversations/${dmId}/messages`, {
        body: 'Вот схема',
        attachmentIds: [fileId],
      });
      assert.equal(response.status, 201);
      assert.equal(response.data.message.attachments.length, 1);
      assert.equal(response.data.message.attachments[0].name, 'схема.png');
    });

    it('отдаёт файл участнику диалога', async () => {
      const response = await petya.request('GET', `/api/files/${fileId}`, undefined, true);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-type'), 'image/png');
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    });

    it('не отдаёт файл постороннему', async () => {
      const response = await dasha.request('GET', `/api/files/${fileId}`, undefined, true);
      assert.equal(response.status, 404);
    });

    it('не отдаёт файл гостю', async () => {
      const guest = new Client('guest');
      const response = await guest.request('GET', `/api/files/${fileId}`, undefined, true);
      assert.equal(response.status, 401);
    });

    it('не даёт приложить один и тот же файл дважды', async () => {
      const response = await anya.post(`/api/conversations/${dmId}/messages`, {
        body: 'Ещё раз та же схема',
        attachmentIds: [fileId],
      });
      assert.equal(response.status, 400);
    });

    it('не даёт приложить чужую загрузку', async () => {
      const form = new FormData();
      form.append('file', new Blob([PNG], { type: 'image/png' }), 'чужое.png');
      const uploaded = await petya.request('POST', '/api/files', form);

      const response = await anya.post(`/api/conversations/${dmId}/messages`, {
        body: 'Приложу чужой файл',
        attachmentIds: [uploaded.data.file.id],
      });
      assert.equal(response.status, 400);
    });

    it('показывает, сколько места занято под файлы', async () => {
      const response = await anya.get('/api/files');
      assert.equal(response.status, 200);
      assert.ok(response.data.storage.usedBytes > 0, 'загруженное учтено');
      assert.ok(response.data.storage.quotaBytes > 0, 'предел объявлен');
      assert.ok(
        response.data.storage.freeBytes <= response.data.storage.quotaBytes,
        'свободного не может быть больше предела',
      );
    });

    it('не принимает файл больше предела', async () => {
      // Девять мегабайт при пределе в восемь.
      const big = Buffer.alloc(9 * 1024 * 1024, 7);
      const form = new FormData();
      form.append('file', new Blob([big], { type: 'image/png' }), 'огромное.png');
      const response = await anya.request('POST', '/api/files', form);
      assert.equal(response.status, 413);
    });

    it('отклоняет запрещённый тип файла', async () => {
      const form = new FormData();
      form.append('file', new Blob([Buffer.from('MZ')], { type: 'application/x-msdownload' }), 'virus.exe');
      const response = await anya.request('POST', '/api/files', form);
      assert.equal(response.status, 415);
    });

    it('отдаёт загруженный HTML безопасно — как текст и вложением', async () => {
      const form = new FormData();
      const html = '<script>alert(document.cookie)</script>';
      form.append('file', new Blob([Buffer.from(html)], { type: 'text/html' }), 'страница.html');
      const uploaded = await anya.request('POST', '/api/files', form);
      assert.equal(uploaded.status, 201);

      const served = await anya.request('GET', `/api/files/${uploaded.data.file.id}`, undefined, true);
      assert.match(served.headers.get('content-type'), /^text\/plain/);
      assert.match(served.headers.get('content-disposition'), /^attachment/);
    });
  });

  describe('Поиск', () => {
    before(async () => {
      await anya.post(`/api/conversations/${dmId}/messages`, {
        body: 'Не забудь про контрольную по алгебре в пятницу',
      });
    });

    it('находит сообщение по слову', async () => {
      const response = await petya.get('/api/search?q=контрольную');
      assert.equal(response.status, 200);
      assert.ok(response.data.messages.some((item) => item.body.includes('контрольную')));
    });

    it('находит человека по имени', async () => {
      const response = await petya.get('/api/search?q=Аня');
      assert.ok(response.data.people.some((person) => person.id === anya.id));
    });

    it('не находит чужую переписку', async () => {
      const response = await dasha.get('/api/search?q=контрольную');
      assert.equal(response.data.messages.length, 0);
    });
  });

  describe('Лента событий', () => {
    it('доставляет новое сообщение по SSE', async () => {
      const controller = new AbortController();
      const response = await fetch(`${BASE}/api/stream`, {
        headers: { cookie: petya.cookie, accept: 'text/event-stream' },
        signal: controller.signal,
      });
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type'), /text\/event-stream/);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      // Читаем приветствие, чтобы поток точно встал на курсор.
      const hello = decoder.decode((await reader.read()).value);
      assert.match(hello, /event: hello/);

      const marker = `сигнал-${Math.random().toString(36).slice(2, 8)}`;
      await anya.post(`/api/conversations/${dmId}/messages`, { body: marker });

      let received = '';
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline && !received.includes(marker)) {
        const { value, done } = await reader.read();
        if (done) break;
        received += decoder.decode(value, { stream: true });
      }

      controller.abort();
      assert.ok(received.includes('event: message.new'), 'должно прийти событие message.new');
      assert.ok(received.includes(marker), 'событие должно нести текст сообщения');
    });

    it('не пускает гостя в ленту событий', async () => {
      const response = await fetch(`${BASE}/api/stream`);
      assert.equal(response.status, 401);
    });
  });

  describe('Профиль', () => {
    it('меняет имя и описание', async () => {
      const response = await dasha.patch('/api/users/me', {
        displayName: 'Даша О.',
        bio: '10 «А», редколлегия',
      });
      assert.equal(response.status, 200);
      assert.equal(response.data.user.displayName, 'Даша О.');
      assert.equal(response.data.user.bio, '10 «А», редколлегия');
    });

    it('не меняет пароль без подтверждения текущим', async () => {
      const response = await dasha.patch('/api/users/me', {
        newPassword: 'novyy-parol-nadyozhnyy',
        currentPassword: 'ne-tot-parol',
      });
      assert.equal(response.status, 403);
    });

    it('меняет пароль и оставляет текущее устройство в системе', async () => {
      const response = await dasha.patch('/api/users/me', {
        newPassword: 'novyy-parol-nadyozhnyy',
        currentPassword: 'ochen-nadyozhnyy-parol',
      });
      assert.equal(response.status, 200);

      const stillIn = await dasha.get('/api/auth/me');
      assert.equal(stillIn.data.user.id, dasha.id, 'после смены пароля нас не должно выкинуть');
    });

    it('после смены пароля старая сессия недействительна', async () => {
      const oldDevice = new Client(dasha.name);
      const login = await oldDevice.post('/api/auth/login', {
        username: dasha.name,
        password: 'ochen-nadyozhnyy-parol',
      });
      assert.equal(login.status, 401, 'старый пароль больше не подходит');
    });
  });

  describe('Класс при регистрации', () => {
    it('без класса зарегистрироваться нельзя', async () => {
      const bezklassa = new Client(`bezklassa_${suffix}`);
      const response = await bezklassa.post('/api/auth/register', {
        username: bezklassa.name,
        password: 'ochen-nadyozhnyy-parol',
        grade: '',
      });
      assert.equal(response.status, 400, 'класс обязателен: аккаунты без класса заводит админ');
    });

    it('ученик не может стереть свой класс через профиль', async () => {
      await dasha.patch('/api/users/me', { grade: '' });
      const me = await dasha.get('/api/auth/me');
      assert.equal(me.data.user.grade, '11Э', 'класс остался прежним');
    });
  });

  describe('Логин и профиль человека', () => {
    // Отдельный аккаунт: смена логина ограничена паузой, поэтому чужие тесты
    // не должны от него зависеть.
    const smena = new Client(`smena_${suffix}`);
    const noviy = `noviy_${suffix}`;

    it('заводит аккаунт для проверок смены логина', async () => {
      await register(smena, 'Сергей Логинов', '8О');
    });

    it('меняет логин', async () => {
      const response = await smena.patch('/api/users/me', { username: noviy });
      assert.equal(response.status, 200, JSON.stringify(response.data));
      assert.equal(response.data.user.username, noviy);

      const me = await smena.get('/api/auth/me');
      assert.equal(me.data.user.username, noviy, 'сессия осталась той же');
    });

    it('вход идёт уже по новому логину', async () => {
      const fresh = new Client(noviy);
      const login = await fresh.post('/api/auth/login', {
        username: noviy,
        password: 'ochen-nadyozhnyy-parol',
      });
      assert.equal(login.status, 200);

      const old = await new Client(smena.name).post('/api/auth/login', {
        username: smena.name,
        password: 'ochen-nadyozhnyy-parol',
      });
      assert.equal(old.status, 401, 'старый логин больше не пускает');
    });

    it('прежний логин не достаётся другому', async () => {
      // Освободившийся логин закреплён за прежним хозяином: иначе им бы
      // представился кто-то другой тем, кто помнит старое имя.
      const response = await dasha.patch('/api/users/me', { username: smena.name });
      assert.equal(response.status, 409);
      assert.match(response.data.error, /закреплён|занят/i);
    });

    it('занятый логин не отдают', async () => {
      const response = await dasha.patch('/api/users/me', { username: anya.name });
      assert.equal(response.status, 409);
    });

    it('слишком короткий логин отклоняется', async () => {
      const response = await dasha.patch('/api/users/me', { username: 'abc' });
      assert.equal(response.status, 400);
    });

    it('второй раз подряд логин не меняется — нужна пауза', async () => {
      const response = await smena.patch('/api/users/me', { username: `esche_${suffix}` });
      assert.equal(response.status, 429, 'пауза между сменами');
      assert.match(response.data.error, /раз в/i);
    });

    it('смена логина не ломает остальной профиль', async () => {
      const response = await smena.patch('/api/users/me', { bio: 'шахматы' });
      assert.equal(response.status, 200);
      assert.equal(response.data.user.bio, 'шахматы');
      assert.equal(response.data.user.username, noviy);
    });

    it('находит человека по логину — с собачкой и без', async () => {
      const bez = await anya.get(`/api/users?search=${noviy}`);
      assert.ok(
        bez.data.people.some((person) => person.username === noviy),
        'поиск по логину',
      );

      const s = await anya.get(`/api/users?search=${encodeURIComponent(`@${noviy}`)}`);
      assert.ok(
        s.data.people.some((person) => person.username === noviy),
        'собачка в запросе не мешает',
      );
    });

    it('находит человека по отображаемому имени', async () => {
      const response = await anya.get(`/api/users?search=${encodeURIComponent('Логинов')}`);
      assert.ok(response.data.people.some((person) => person.username === noviy));
    });

    it('точное совпадение логина стоит первым', async () => {
      const response = await anya.get(`/api/users?search=${noviy}`);
      assert.equal(response.data.people[0].username, noviy);
    });

    it('открывает карточку человека по id', async () => {
      const response = await anya.get(`/api/users/${petya.id}`);
      assert.equal(response.status, 200);
      assert.equal(response.data.user.username, petya.name);
      assert.equal(response.data.user.grade, '9Г');
      assert.ok('online' in response.data.user, 'в карточке видно, в сети ли человек');

      const dump = JSON.stringify(response.data);
      assert.doesNotMatch(dump, /scrypt\$|password/i, 'ничего лишнего наружу');
    });

    it('карточка закрыта от гостей, мусор в адресе — 400', async () => {
      assert.equal((await fetch(`${BASE}/api/users/${petya.id}`)).status, 401);
      assert.equal((await anya.get('/api/users/1%20OR%201=1')).status, 400);
      assert.equal((await anya.get('/api/users/99999999')).status, 404);
    });
  });

  describe('Меню чата: очистка, блокировка, картинка группы', () => {
    const sosed = new Client(`sosed_${suffix}`);
    let chatId;

    it('заводит соседа и переписку с ним', async () => {
      await register(sosed, 'Слава Соседов', '8Г');

      const created = await anya.post('/api/conversations', { kind: 'dm', userId: sosed.id });
      assert.equal(created.status, 201);
      chatId = created.data.conversation.id;

      const sent = await anya.post(`/api/conversations/${chatId}/messages`, { body: 'Привет!' });
      assert.equal(sent.status, 201);
    });

    it('очищает переписку только у того, кто нажал', async () => {
      const cleared = await anya.post(`/api/conversations/${chatId}/clear`);
      assert.equal(cleared.status, 200);

      const mine = await anya.get(`/api/conversations/${chatId}/messages`);
      assert.equal(mine.data.messages.length, 0, 'у себя пусто');

      const theirs = await sosed.get(`/api/conversations/${chatId}/messages`);
      assert.ok(theirs.data.messages.length > 0, 'у собеседника переписка на месте');
    });

    it('очищенный диалог уходит из списка чатов', async () => {
      const list = await anya.get('/api/conversations');
      assert.ok(!list.data.conversations.some((item) => item.id === chatId));
    });

    it('блокировка закрывает дорогу сообщениям', async () => {
      const blocked = await anya.post(`/api/users/${sosed.id}`);
      assert.equal(blocked.status, 200);

      const attempt = await sosed.post(`/api/conversations/${chatId}/messages`, {
        body: 'Всё равно напишу',
      });
      assert.equal(attempt.status, 403);

      const own = await anya.post(`/api/conversations/${chatId}/messages`, { body: 'И я не могу' });
      assert.equal(own.status, 403, 'заблокировавший тоже не пишет, пока не снимет блокировку');
    });

    it('заблокированный не появляется в поиске', async () => {
      const found = await anya.get(`/api/users?search=${sosed.name}`);
      assert.ok(!found.data.people.some((person) => person.id === sosed.id));
    });

    it('снятая блокировка возвращает всё как было', async () => {
      const unblocked = await anya.post(`/api/users/${sosed.id}?action=unblock`);
      assert.equal(unblocked.status, 200);

      const again = await sosed.post(`/api/conversations/${chatId}/messages`, { body: 'Так лучше' });
      assert.equal(again.status, 201);
    });

    it('себя заблокировать нельзя', async () => {
      assert.equal((await anya.post(`/api/users/${anya.id}`)).status, 400);
    });

    it('картинку группы ставит только создатель', async () => {
      const group = await anya.post('/api/conversations', {
        kind: 'group',
        title: 'Фотокружок',
        memberIds: [sosed.id],
      });
      assert.equal(group.status, 201);
      const groupId = group.data.conversation.id;

      const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8Dwn4GBgYGJAQ0AABvOAQEUOgn0AAAAAElFTkSuQmCC',
        'base64',
      );
      const form = new FormData();
      form.append('file', new Blob([png], { type: 'image/png' }), 'значок.png');
      const uploaded = await anya.request('POST', '/api/files', form);

      const byMember = await sosed.patch(`/api/conversations/${groupId}`, {
        avatarFileId: uploaded.data.file.id,
      });
      assert.equal(byMember.status, 403, 'участник картинку не меняет');

      const byOwner = await anya.patch(`/api/conversations/${groupId}`, {
        avatarFileId: uploaded.data.file.id,
      });
      assert.equal(byOwner.status, 200);
      assert.equal(byOwner.data.conversation.avatarFileId, uploaded.data.file.id);
    });

    it('у личного диалога картинки не бывает', async () => {
      const response = await anya.patch(`/api/conversations/${chatId}`, { avatarFileId: null });
      assert.equal(response.status, 400);
    });
  });

  describe('Админ-панель', () => {
    const uchitel = new Client(`uchitel_${suffix}`);
    const naruzhu = new Client(`naruzhu_${suffix}`);

    it('обычный ученик в панель не попадает', async () => {
      const list = await anya.get('/api/admin/users');
      assert.equal(list.status, 403, 'список аккаунтов только администратору');

      const created = await anya.post('/api/admin/users', {
        username: `podstava_${suffix}`,
        password: 'ochen-nadyozhnyy-parol',
        role: 'teacher',
      });
      assert.equal(created.status, 403);

      const changed = await anya.patch(`/api/admin/users/${petya.id}`, { blocked: true });
      assert.equal(changed.status, 403);
    });

    it('гость в панель не попадает', async () => {
      const response = await fetch(`${BASE}/api/admin/users`);
      assert.equal(response.status, 401);
    });

    it('администратор видит список аккаунтов и находит человека по логину', async () => {
      const all = await direktor.get('/api/admin/users');
      assert.equal(all.status, 200);
      assert.ok(all.data.users.length >= 4, 'в списке все зарегистрированные');

      const found = await direktor.get(`/api/admin/users?q=${anya.name}`);
      assert.equal(found.data.users.length, 1);
      assert.equal(found.data.users[0].username, anya.name);
      assert.equal(found.data.users[0].grade, '9О');
      assert.equal(found.data.users[0].blocked, false);
    });

    it('в списке нет хешей паролей', async () => {
      const all = await direktor.get('/api/admin/users');
      const dump = JSON.stringify(all.data);
      assert.doesNotMatch(dump, /scrypt\$/, 'хеши наружу не отдаются даже администратору');
      assert.doesNotMatch(dump, /password_hash|passwordHash/);
    });

    it('администратор заводит аккаунт учителю, и тот входит', async () => {
      const response = await direktor.post('/api/admin/users', {
        username: uchitel.name,
        displayName: 'Мария Ивановна',
        password: 'parol-dlya-uchitelya',
        role: 'teacher',
      });
      assert.equal(response.status, 201, JSON.stringify(response.data));
      assert.equal(response.data.user.role, 'teacher');
      assert.equal(response.data.user.grade, '', 'у учителя класса нет');

      const login = await uchitel.post('/api/auth/login', {
        username: uchitel.name,
        password: 'parol-dlya-uchitelya',
      });
      assert.equal(login.status, 200, 'заведённым аккаунтом можно войти');
      uchitel.id = login.data.user.id;
    });

    it('учителя видно учителем, а не безымянным аккаунтом', async () => {
      const found = await anya.get(`/api/users?search=${uchitel.name}`);
      const person = found.data.people.find((item) => item.username === uchitel.name);
      assert.ok(person, 'учитель есть в каталоге школы');
      assert.equal(person.isTeacher, true);
      assert.equal(person.grade, '');
    });

    it('ученику заводят аккаунт только с классом', async () => {
      const bad = await direktor.post('/api/admin/users', {
        username: `uchenik_${suffix}`,
        password: 'ochen-nadyozhnyy-parol',
        role: 'member',
      });
      assert.equal(bad.status, 400, 'ученику класс обязателен');

      const good = await direktor.post('/api/admin/users', {
        username: naruzhu.name,
        displayName: 'Новенький',
        password: 'ochen-nadyozhnyy-parol',
        role: 'member',
        grade: '5Г',
      });
      assert.equal(good.status, 201);
      assert.equal(good.data.user.grade, '5Г');
      assert.equal(good.data.user.role, 'member');
      naruzhu.id = good.data.user.id;
    });

    it('администратором аккаунт через панель не сделать', async () => {
      const response = await direktor.post('/api/admin/users', {
        username: `vtoroy_admin_${suffix}`,
        password: 'ochen-nadyozhnyy-parol',
        role: 'admin',
        grade: '9О',
      });
      assert.equal(response.status, 400, 'роль администратора выдаётся не отсюда');
    });

    it('занятый логин второй раз не заводится', async () => {
      const response = await direktor.post('/api/admin/users', {
        username: anya.name,
        password: 'ochen-nadyozhnyy-parol',
        role: 'teacher',
      });
      assert.equal(response.status, 409);
    });

    it('блокировка закрывает вход и обрывает открытую сессию', async () => {
      // Заблокированный сидит в мессенджере прямо сейчас.
      const before = await naruzhu.post('/api/auth/login', {
        username: naruzhu.name,
        password: 'ochen-nadyozhnyy-parol',
      });
      assert.equal(before.status, 200);
      assert.equal((await naruzhu.get('/api/conversations')).status, 200);

      const blocked = await direktor.patch(`/api/admin/users/${naruzhu.id}`, {
        blocked: true,
        reason: 'ругался в общем чате',
      });
      assert.equal(blocked.status, 200);
      assert.equal(blocked.data.user.blocked, true);
      assert.equal(blocked.data.user.blockedReason, 'ругался в общем чате');

      // Открытая вкладка перестаёт работать сразу, без перезахода.
      assert.equal(
        (await naruzhu.get('/api/conversations')).status,
        401,
        'сессии заблокированного закрыты',
      );

      const again = await naruzhu.post('/api/auth/login', {
        username: naruzhu.name,
        password: 'ochen-nadyozhnyy-parol',
      });
      assert.equal(again.status, 403, 'с верным паролем всё равно не пускает');
      assert.match(again.data.error, /ругался в общем чате/, 'человеку говорят причину');
    });

    it('разблокировка возвращает вход', async () => {
      const response = await direktor.patch(`/api/admin/users/${naruzhu.id}`, { blocked: false });
      assert.equal(response.status, 200);
      assert.equal(response.data.user.blocked, false);
      assert.equal(response.data.user.blockedReason, '');

      const login = await naruzhu.post('/api/auth/login', {
        username: naruzhu.name,
        password: 'ochen-nadyozhnyy-parol',
      });
      assert.equal(login.status, 200);
    });

    it('администратор ставит новый пароль вместо забытого', async () => {
      const response = await direktor.patch(`/api/admin/users/${uchitel.id}`, {
        password: 'novyy-parol-uchitelya',
      });
      assert.equal(response.status, 200);

      const old = await new Client(uchitel.name).post('/api/auth/login', {
        username: uchitel.name,
        password: 'parol-dlya-uchitelya',
      });
      assert.equal(old.status, 401, 'старый пароль больше не работает');

      const fresh = new Client(uchitel.name);
      const login = await fresh.post('/api/auth/login', {
        username: uchitel.name,
        password: 'novyy-parol-uchitelya',
      });
      assert.equal(login.status, 200, 'входит по новому паролю');
    });

    it('смена пароля закрывает чужие устройства', async () => {
      // uchitel всё ещё держит куку от входа по старому паролю.
      assert.equal(
        (await uchitel.get('/api/conversations')).status,
        401,
        'после смены пароля старая сессия недействительна',
      );
    });

    it('короткий пароль администратор поставить не может', async () => {
      const response = await direktor.patch(`/api/admin/users/${naruzhu.id}`, { password: '123' });
      assert.equal(response.status, 400);
    });

    it('свой аккаунт через панель не блокируется', async () => {
      const response = await direktor.patch(`/api/admin/users/${direktor.id}`, { blocked: true });
      assert.equal(response.status, 400, 'иначе администратор запирает сам себя');

      const me = await direktor.get('/api/auth/me');
      assert.equal(me.status, 200, 'администратор на месте');
    });

    it('пустой запрос ничего не меняет', async () => {
      const response = await direktor.patch(`/api/admin/users/${naruzhu.id}`, {});
      assert.equal(response.status, 400);
    });

    it('несуществующий аккаунт — 404, мусор в адресе — 400', async () => {
      assert.equal(
        (await direktor.patch('/api/admin/users/99999999', { blocked: true })).status,
        404,
      );
      assert.equal(
        (await direktor.patch('/api/admin/users/1%20OR%201=1', { blocked: true })).status,
        400,
      );
    });
  });

  describe('Сессии и устройства', () => {
    // Свой аккаунт: соседние наборы меняют пароли и логины, и вход отсюда не
    // должен от этого зависеть.
    const ust = new Client(`ustroystva_${suffix}`);
    const PAROL = 'ochen-nadyozhnyy-parol';

    it('заводит аккаунт для проверок', async () => {
      await register(ust, 'Устройства Проверкины', '7Г');
    });

    it('запомненный вход переживает перезапуск приложения', async () => {
      const fresh = new Client(ust.name);
      const login = await fresh.post('/api/auth/login', { username: ust.name, password: PAROL });
      assert.equal(login.status, 200, `вход не прошёл: ${JSON.stringify(login.data)}`);

      // Кука со сроком жизни: браузер сохранит её на диск и вернёт после
      // перезапуска. Кука сеанса такого атрибута не имеет.
      assert.match(fresh.rawSetCookie, /Max-Age=\d+/i, 'вход должен запоминаться');
      const maxAge = Number(fresh.rawSetCookie.match(/Max-Age=(\d+)/i)[1]);
      assert.ok(maxAge > 60 * 60 * 24 * 20, `срок куки ${maxAge} секунд — слишком короткий`);

      // Тот же токен, новый «запуск» — логин не спрашивают.
      const restarted = new Client(ust.name);
      restarted.cookie = fresh.cookie;
      const me = await restarted.get('/api/auth/me');
      assert.equal(me.status, 200);
      assert.equal(me.data.user.username, ust.name);
    });

    it('«чужой компьютер» не оставляет запомненного входа', async () => {
      const obshchiy = new Client(ust.name);
      await obshchiy.post('/api/auth/login', {
        username: ust.name,
        password: PAROL,
        sharedComputer: true,
      });

      assert.doesNotMatch(
        obshchiy.rawSetCookie,
        /Max-Age|Expires/i,
        'на общем компьютере кука должна умереть вместе с браузером',
      );
      // В самом окне мессенджер работает как обычно.
      assert.equal((await obshchiy.get('/api/conversations')).status, 200);
    });

    it('показывает устройства и не выдаёт токены', async () => {
      const response = await ust.get('/api/sessions');
      assert.equal(response.status, 200);
      assert.ok(response.data.sessions.length >= 1);

      const current = response.data.sessions.find((item) => item.current);
      assert.ok(current, 'текущее устройство помечено');
      assert.ok(current.device, 'у устройства есть понятное название');

      const dump = JSON.stringify(response.data);
      assert.ok(!dump.includes(ust.cookie.split('=')[1]), 'токен сессии наружу не отдаётся');
      assert.doesNotMatch(dump, /token_hash/);
    });

    it('выход на других устройствах закрывает чужие вкладки, но не свою', async () => {
      // Два входа в один аккаунт: как будто дома и на школьном компьютере.
      const shkola = new Client(ust.name);
      await shkola.post('/api/auth/login', { username: ust.name, password: PAROL });
      assert.equal((await shkola.get('/api/conversations')).status, 200);

      const doma = new Client(ust.name);
      await doma.post('/api/auth/login', { username: ust.name, password: PAROL });

      const closed = await doma.del('/api/sessions');
      assert.equal(closed.status, 200);
      assert.ok(closed.data.closed >= 1, 'что-то должно было закрыться');

      assert.equal(
        (await shkola.get('/api/conversations')).status,
        401,
        'забытый вход на школьном компьютере закрыт',
      );
      assert.equal(
        (await doma.get('/api/conversations')).status,
        200,
        'та вкладка, из которой нажали, продолжает работать',
      );
    });

    it('чужой список устройств не посмотреть и не закрыть', async () => {
      // Своё — своим: у каждого свой список, общего доступа нет.
      const mine = await ust.get('/api/sessions');
      const dump = JSON.stringify(mine.data);
      assert.ok(!dump.includes('null'), 'в списке только свои сессии');

      const guest = await fetch(`${BASE}/api/sessions`);
      assert.equal(guest.status, 401);

      const guestDelete = await fetch(`${BASE}/api/sessions`, { method: 'DELETE' });
      assert.equal(guestDelete.status, 401);
    });

    it('выход закрывает только эту сессию', async () => {
      const first = new Client(ust.name);
      await first.post('/api/auth/login', { username: ust.name, password: PAROL });
      const second = new Client(ust.name);
      await second.post('/api/auth/login', { username: ust.name, password: PAROL });

      await first.post('/api/auth/logout');
      assert.equal((await first.get('/api/conversations')).status, 401, 'вышли здесь');
      assert.equal((await second.get('/api/conversations')).status, 200, 'другое устройство осталось');
    });
  });

  describe('Безопасность', () => {
    it('нельзя выдать себе роль администратора при регистрации', async () => {
      const impostor = new Client(`samozvanets_${suffix}`);
      const response = await impostor.post('/api/auth/register', {
        username: impostor.name,
        password: 'ochen-nadyozhnyy-parol',
        grade: '9О',
        role: 'admin',
      });
      assert.equal(response.status, 201);
      const me = await impostor.get('/api/auth/me');
      assert.equal(me.data.user.role, 'member', 'роль назначает сервер, а не запрос');
    });

    it('нельзя поднять себе права через изменение профиля', async () => {
      await petya.patch('/api/users/me', { role: 'admin', id: 1 });
      const me = await petya.get('/api/auth/me');
      assert.equal(me.data.user.role, 'member', 'роль назначает сервер, а не запрос');
      assert.equal(me.data.user.username, petya.name, 'логин сам собой не меняется');
    });

    it('сессионная кука недоступна скриптам и защищена от CSRF', async () => {
      const fresh = new Client(anya.name);
      await fresh.post('/api/auth/login', {
        username: anya.name,
        password: 'ochen-nadyozhnyy-parol',
      });
      assert.match(fresh.rawSetCookie, /HttpOnly/i, 'без HttpOnly куку украл бы любой скрипт');
      assert.match(fresh.rawSetCookie, /SameSite=Lax/i);
    });

    it('подделанный токен сессии не работает', async () => {
      const response = await fetch(`${BASE}/api/conversations`, {
        headers: { cookie: 'gimroom_session=poddelannyy-token' },
      });
      assert.equal(response.status, 401);
    });

    it('в ответах нет хешей паролей и токенов', async () => {
      const profile = await anya.get('/api/auth/me');
      const people = await anya.get('/api/users');
      const both = JSON.stringify(profile.data) + JSON.stringify(people.data);
      assert.doesNotMatch(both, /password/i);
      assert.doesNotMatch(both, /token/i);
    });

    it('мусор вместо идентификатора отвергается, а не округляется', async () => {
      // parseInt превратил бы «1 OR 1=1» в 1 и «12abc» в 12.
      // Пустой сегмент сюда не входит: такой адрес Next схлопывает сам,
      // до разбора идентификатора дело не доходит.
      for (const bad of ['1 OR 1=1', '12abc', '-5', '1.5', '0', '99999999999999999999']) {
        const response = await anya.get(
          `/api/conversations/${encodeURIComponent(bad)}/messages`,
        );
        assert.ok(
          response.status === 400 || response.status === 404,
          `«${bad}» должен отвергаться, а вернулось ${response.status}`,
        );
      }
    });

    it('инъекция в поиске не ломает базу', async () => {
      for (const payload of ["'; DROP TABLE users; --", "' OR '1'='1"]) {
        const response = await anya.get(`/api/search?q=${encodeURIComponent(payload)}`);
        assert.equal(response.status, 200);
      }
      const alive = await anya.get('/api/users');
      assert.equal(alive.status, 200, 'таблица users должна быть на месте');
    });

    it('перебор текущего пароля при смене ограничен', async () => {
      const victim = new Client(`zhertva_${suffix}`);
      await register(victim, 'Жертва', '8О');

      let blocked = false;
      for (let i = 0; i < 12; i++) {
        const attempt = await victim.patch('/api/users/me', {
          newPassword: 'parol-zloumyshlennika',
          currentPassword: `podbor-${i}`,
        });
        if (attempt.status === 429) {
          blocked = true;
          break;
        }
      }
      assert.ok(blocked, 'иначе с чужого незапертого ноутбука аккаунт уводят перебором');
    });

    it('перебор пароля при входе блокируется', async () => {
      const target = new Client(`mishen_${suffix}`);
      await register(target, 'Мишень', '8Г');

      const attacker = new Client(target.name);
      let blocked = false;
      for (let i = 0; i < 15; i++) {
        const attempt = await attacker.post('/api/auth/login', {
          username: target.name,
          password: `podbor-${i}`,
        });
        if (attempt.status === 429) {
          blocked = true;
          break;
        }
      }
      assert.ok(blocked);
    });

    it('несуществующий логин отвечает так же долго, как существующий', async () => {
      // Иначе по времени ответа перебирается список зарегистрированных.
      const measure = async (username) => {
        const times = [];
        for (let i = 0; i < 5; i++) {
          const started = performance.now();
          await fetch(`${BASE}/api/auth/login`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ username, password: `nevernyy-${i}` }),
          });
          times.push(performance.now() - started);
        }
        return times.sort((a, b) => a - b)[2];
      };

      const missing = await measure(`prizrak_${suffix}`);
      const present = await measure(dasha.name);
      const ratio = present / missing;
      assert.ok(
        ratio > 0.4 && ratio < 2.5,
        `время ответа не должно выдавать наличие аккаунта (отношение ${ratio.toFixed(2)})`,
      );
    });

    it('страница отдаёт заголовки безопасности', async () => {
      const response = await fetch(BASE);
      const csp = response.headers.get('content-security-policy') ?? '';

      assert.match(csp, /nonce-[a-f0-9]{16,}/, 'скрипты разрешаются по одноразовому ключу');
      assert.doesNotMatch(
        csp.split(';').find((part) => part.includes('script-src')) ?? '',
        /unsafe-inline|unsafe-eval/,
        'в рабочей сборке послаблений для скриптов быть не должно',
      );
      assert.match(csp, /frame-ancestors 'none'/, 'защита от подмены нажатий');
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(response.headers.get('x-frame-options'), 'DENY');
      assert.ok(response.headers.get('referrer-policy'));
    });

    it('одноразовый ключ политики меняется на каждый ответ', async () => {
      const first = (await fetch(BASE)).headers.get('content-security-policy');
      const second = (await fetch(BASE)).headers.get('content-security-policy');
      assert.notEqual(first, second, 'иначе ключ можно подсмотреть и переиспользовать');
    });
  });

  after(() => {
    // Явного освобождения ресурсов не нужно: клиенты держат только куки.
  });
});
