import { sql } from '@/lib/db';
import { publish } from '@/lib/events';
import { json, requireMembership, withUser } from '@/lib/http';
import { parseId } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

/**
 * Сигнал «я печатаю». Клиент шлёт его не чаще раза в несколько секунд,
 * запись сама протухает по времени — гасить её отдельно не нужно.
 */
export const POST = withUser<Context>(async (user, _request, { params }) => {
  const conversationId = parseId((await params).id, 'идентификатор диалога');
  await requireMembership(user.id, conversationId);

  await sql`
    INSERT INTO typing_state (conversation_id, user_id, updated_at)
    VALUES (${conversationId}, ${user.id}, now())
    ON CONFLICT (conversation_id, user_id) DO UPDATE SET updated_at = now()
  `;

  await publish({
    type: 'typing',
    conversationId,
    payload: { actorId: user.id, userId: user.id, displayName: user.display_name },
  });

  return json({ ok: true });
});
