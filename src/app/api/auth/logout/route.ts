import { destroySession } from '@/lib/auth';
import { handle, json } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = handle(async () => {
  await destroySession();
  return json({ ok: true });
});
