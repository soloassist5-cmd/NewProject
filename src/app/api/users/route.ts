import { json, withUser } from '@/lib/http';
import { listPeople } from '@/lib/queries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Каталог школы: кому можно написать. */
export const GET = withUser(async (user, request) => {
  const search = new URL(request.url).searchParams.get('search') ?? '';
  return json({ people: await listPeople(user.id, search) });
});
