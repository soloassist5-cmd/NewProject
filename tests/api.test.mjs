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

describe('Перемена — проверка API', () => {
  before(async () => {
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

    it('разрешает регистрацию без класса — для сотрудников', async () => {
      const teacher = new Client(`uchitel_${suffix}`);
      const response = await teacher.post('/api/auth/register', {
        username: teacher.name,
        grade: '',
        password: 'ochen-nadyozhnyy-parol',
      });
      assert.equal(response.status, 201);
      assert.equal(response.data.user.grade, '');
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
      await petya.patch('/api/users/me', { role: 'admin', username: 'root', id: 1 });
      const me = await petya.get('/api/auth/me');
      assert.equal(me.data.user.role, 'member');
      assert.equal(me.data.user.username, petya.name, 'логин менять нельзя');
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
        headers: { cookie: 'peremena_session=poddelannyy-token' },
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
