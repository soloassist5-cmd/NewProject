import { NextResponse } from 'next/server';
import { currentUser, type SessionUser } from './auth';
import { sqlOne } from './db';
import { ValidationError } from './validate';

/** Ошибка с HTTP-кодом: бросается в обработчиках, ловится в withUser/handle. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function json(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

export function fail(status: number, message: string): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

/** Превращает исключение в аккуратный JSON-ответ. */
export function toResponse(error: unknown): NextResponse {
  if (error instanceof ValidationError) return fail(400, error.message);
  if (error instanceof HttpError) return fail(error.status, error.message);
  console.error('Необработанная ошибка в API:', error);
  return fail(500, 'Что-то пошло не так на сервере. Попробуйте ещё раз.');
}

/**
 * Обёртка для защищённых маршрутов: проверяет сессию, ловит ошибки.
 *
 *   export const POST = withUser(async (user, request) => { ... });
 */
export function withUser<Context = unknown>(
  handler: (user: SessionUser, request: Request, context: Context) => Promise<NextResponse>,
) {
  return async (request: Request, context: Context): Promise<NextResponse> => {
    try {
      const user = await currentUser();
      if (!user) return fail(401, 'Нужно войти в аккаунт.');
      return await handler(user, request, context);
    } catch (error) {
      return toResponse(error);
    }
  };
}

/** То же, но для открытых маршрутов (вход, регистрация). */
export function handle(handler: (request: Request) => Promise<NextResponse>) {
  return async (request: Request): Promise<NextResponse> => {
    try {
      return await handler(request);
    } catch (error) {
      return toResponse(error);
    }
  };
}

/** Разбирает JSON-тело запроса, аккуратно сообщая о битом теле. */
export async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const data = await request.json();
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new ValidationError('Ожидался объект JSON.');
    }
    return data as Record<string, unknown>;
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw new ValidationError('Не удалось разобрать тело запроса.');
  }
}

/** Проверяет, что человек состоит в диалоге, и возвращает его роль в нём. */
export async function requireMembership(
  userId: number,
  conversationId: number,
): Promise<{ role: string; kind: string }> {
  const row = await sqlOne<{ role: string; kind: string }>`
    SELECT m.role, c.kind
    FROM conversation_members m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE m.conversation_id = ${conversationId} AND m.user_id = ${userId}
  `;
  if (!row) throw new HttpError(404, 'Диалог не найден.');
  return row;
}
