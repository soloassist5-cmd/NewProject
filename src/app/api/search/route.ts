import { json, withUser } from '@/lib/http';
import { listPeople, searchMessages } from '@/lib/queries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Общий поиск: и по сообщениям, и по людям. */
export const GET = withUser(async (user, request) => {
  const query = (new URL(request.url).searchParams.get('q') ?? '').trim();
  if (query.length < 2) return json({ messages: [], people: [], query });

  const [messages, people] = await Promise.all([
    searchMessages(user.id, query),
    listPeople(user.id, query),
  ]);

  return json({ messages, people, query });
});
