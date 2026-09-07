import AuthScreen from '@/components/AuthScreen';
import Messenger from '@/components/Messenger';
import { currentUser } from '@/lib/auth';
import { config } from '@/lib/config';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const user = await currentUser();

  if (!user) {
    return (
      <AuthScreen
        inviteOnly={config.inviteOnly}
        schoolName={config.schoolName}
        parallels={config.grades.parallels}
        letters={config.grades.letters}
      />
    );
  }

  return (
    <Messenger
      schoolName={config.schoolName}
      grades={{
        parallels: config.grades.parallels,
        letters: config.grades.letters,
      }}
      me={{
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        grade: user.grade,
        avatarColor: user.avatar_color,
        avatarFileId: user.avatar_file_id,
        bio: user.bio,
        role: user.role,
      }}
    />
  );
}
