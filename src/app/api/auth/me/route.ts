import { currentUser, renewSession } from '@/lib/auth';
import { config } from '@/lib/config';
import { handle, json } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handle(async () => {
  const user = await currentUser();
  if (!user) return json({ user: null, inviteOnly: config.inviteOnly });

  // Приложение спрашивает «кто я» при каждом запуске — удобная точка, чтобы
  // отодвинуть срок запомненного входа. Иначе через месяц после регистрации
  // форма входа встретила бы всех разом, включая тех, кто заходит ежедневно.
  await renewSession();

  return json({
    user: {
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      grade: user.grade,
      avatarColor: user.avatar_color,
      avatarFileId: user.avatar_file_id,
      bio: user.bio,
      role: user.role,
    },
    inviteOnly: config.inviteOnly,
  });
});
