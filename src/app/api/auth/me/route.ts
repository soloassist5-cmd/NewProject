import { currentUser } from '@/lib/auth';
import { config } from '@/lib/config';
import { handle, json } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handle(async () => {
  const user = await currentUser();
  if (!user) return json({ user: null, inviteOnly: config.inviteOnly });

  return json({
    user: {
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      avatarColor: user.avatar_color,
      avatarFileId: user.avatar_file_id,
      bio: user.bio,
      role: user.role,
    },
    inviteOnly: config.inviteOnly,
  });
});
