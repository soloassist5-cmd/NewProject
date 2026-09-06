import { config } from '@/lib/config';
import { pool, sql, sqlOne } from '@/lib/db';
import { publish } from '@/lib/events';
import { HttpError, json, readJson, requireMembership, withUser } from '@/lib/http';
import { postSystemMessage } from '@/lib/messaging';
import { listMembers } from '@/lib/queries';
import { parseId, parseIdList, ValidationError } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

export const GET = withUser<Context>(async (user, _request, { params }) => {
  const conversationId = parseId((await params).id, 'идентификатор диалога');
  await requireMembership(user.id, conversationId);
  return json({ members: await listMembers(conversationId) });
});

/** Добавляет людей в группу. */
export const POST = withUser<Context>(async (user, request, { params }) => {
  const conversationId = parseId((await params).id, 'идентификатор диалога');
  const membership = await requireMembership(user.id, conversationId);
  if (membership.kind !== 'group') throw new HttpError(400, 'В личный диалог нельзя добавить третьего.');

  const body = await readJson(request);
  const userIds = parseIdList(body.userIds ?? [], 'идентификатор участника');
  if (userIds.length === 0) throw new ValidationError('Некого добавлять.');

  const current = await sqlOne<{ count: number }>`
    SELECT count(*)::int AS count FROM conversation_members WHERE conversation_id = ${conversationId}
  `;
  if ((current?.count ?? 0) + userIds.length > config.limits.groupMembers) {
    throw new HttpError(400, `В группе не может быть больше ${config.limits.groupMembers} участников.`);
  }

  const people = await sql<{ id: number; display_name: string }>`
    SELECT id, display_name FROM users WHERE id = ANY(${userIds}::bigint[])
  `;
  if (people.length !== userIds.length) throw new HttpError(400, 'Кто-то из указанных людей не найден.');

  const values = people.map((_, index) => `($1, $${index + 2}, 'member')`).join(', ');
  await pool().query(
    `INSERT INTO conversation_members (conversation_id, user_id, role) VALUES ${values}
     ON CONFLICT DO NOTHING`,
    [conversationId, ...people.map((person) => person.id)],
  );

  const names = people.map((person) => person.display_name).join(', ');
  await postSystemMessage(conversationId, `${user.display_name} добавил(а) в группу: ${names}`);
  await publish({
    type: 'conversation.members',
    conversationId,
    payload: { actorId: user.id, added: people.map((person) => person.id) },
  });

  return json({ members: await listMembers(conversationId) }, 201);
});

/** Убирает человека из группы. Доступно создателю группы и администратору. */
export const DELETE = withUser<Context>(async (user, request, { params }) => {
  const conversationId = parseId((await params).id, 'идентификатор диалога');
  const membership = await requireMembership(user.id, conversationId);
  if (membership.kind !== 'group') throw new HttpError(400, 'Из личного диалога никого не убрать.');
  if (membership.role !== 'owner' && user.role !== 'admin') {
    throw new HttpError(403, 'Убирать участников может только создатель группы.');
  }

  const targetId = parseId(new URL(request.url).searchParams.get('userId'), 'идентификатор участника');
  if (targetId === user.id) throw new HttpError(400, 'Чтобы выйти самому, используйте «Покинуть группу».');

  const target = await sqlOne<{ display_name: string }>`
    SELECT u.display_name FROM conversation_members cm
    JOIN users u ON u.id = cm.user_id
    WHERE cm.conversation_id = ${conversationId} AND cm.user_id = ${targetId}
  `;
  if (!target) throw new HttpError(404, 'Этот человек не состоит в группе.');

  await sql`
    DELETE FROM conversation_members
    WHERE conversation_id = ${conversationId} AND user_id = ${targetId}
  `;

  await postSystemMessage(conversationId, `${user.display_name} убрал(а) из группы: ${target.display_name}`);
  await publish({
    type: 'conversation.members',
    conversationId,
    payload: { actorId: user.id, removed: targetId },
  });
  // Событие уже не дойдёт до исключённого через диалог — отправляем ему лично.
  await publish({
    type: 'conversation.members',
    userId: targetId,
    payload: { actorId: user.id, removedFrom: conversationId },
  });

  return json({ members: await listMembers(conversationId) });
});
