import { createAccount, listAccounts, requireAdmin } from '@/lib/admin';
import { json, readJson, withUser } from '@/lib/http';
import {
  avatarColorFor,
  parseDisplayName,
  parseGrade,
  parseNewUserRole,
  parsePassword,
  parseStudentGrade,
  parseUsername,
} from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Список аккаунтов гимназии. */
export const GET = withUser(async (user, request) => {
  requireAdmin(user);

  const search = new URL(request.url).searchParams.get('q') ?? '';
  return json({ users: await listAccounts(search) });
});

/** Заводит аккаунт вручную — прежде всего учителям. */
export const POST = withUser(async (user, request) => {
  requireAdmin(user);

  const body = await readJson(request);
  const username = parseUsername(body.username);
  const password = parsePassword(body.password);
  const role = parseNewUserRole(body.role);
  const displayName =
    body.displayName === undefined || body.displayName === ''
      ? username
      : parseDisplayName(body.displayName);

  // У учителя класса нет, у ученика он обязателен — как и при обычной
  // регистрации. Присланный учителю класс молча отбрасываем.
  const grade = role === 'teacher' ? parseGrade('') : parseStudentGrade(body.grade);

  const created = await createAccount({
    username,
    displayName,
    password,
    grade,
    role,
    avatarColor: avatarColorFor(username),
  });

  return json({ user: created }, 201);
});
