import AuthScreen from '@/components/AuthScreen';
import Messenger from '@/components/Messenger';
import { currentUser } from '@/lib/auth';
import { config } from '@/lib/config';
import { ConfigError, connectionString } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Чего не хватает в настройках. null — всё на месте.
 *
 * Проверяем заранее, а не когда человек нажмёт «Войти»: свежеразвёрнутое
 * приложение выглядит рабочим, форма открывается, и о том, что переменные не
 * заданы (или заданы, но сборка была раньше и их не видит), узнаёшь только по
 * ошибке после ввода пароля. Лучше сказать это сразу и тому, кто разворачивал.
 */
function setupProblem(): string | null {
  try {
    connectionString();
  } catch (error) {
    if (error instanceof ConfigError) return error.message;
    throw error;
  }

  const secret = process.env.AUTH_SECRET ?? '';
  if (process.env.NODE_ENV === 'production' && secret.length < 16) {
    return (
      'Не задана переменная AUTH_SECRET — без неё нельзя безопасно выдавать сессии. ' +
      'Добавьте её в настройках проекта (случайная строка от 32 символов) и пересоберите приложение.'
    );
  }

  return null;
}

export default async function HomePage() {
  const problem = setupProblem();
  const user = problem ? null : await currentUser();

  if (!user) {
    return (
      <AuthScreen
        inviteOnly={config.inviteOnly}
        schoolName={config.schoolName}
        parallels={config.grades.parallels}
        letters={config.grades.letters}
        setupProblem={problem}
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
