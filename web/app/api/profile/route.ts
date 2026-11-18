// 내 공개 프로필 설정. 본인만 읽고 쓴다. 규칙: lib/profile-store.ts
import { identity, AuthUnavailable } from '@/lib/projects';
import { Conflict } from '@/lib/sprint-store';
import { PolicyError } from '@/lib/sprint-policy';
import { readProfileSettings, saveProfileSettings } from '@/lib/profile-store';
export const dynamic = 'force-dynamic';

function reply(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
}
function failure(error: unknown, label: string) {
  if (error instanceof PolicyError) return reply({ error: error.message }, error.status);
  if (error instanceof Conflict) return reply({ error: error.message }, 409);
  if (error instanceof SyntaxError) return reply({ error: '요청 형식이 올바르지 않습니다.' }, 400);
  console.error(label, error);
  return reply({ error: '공개 프로필을 처리하지 못했어요. 잠시 후 다시 시도해주세요.' }, 503);
}

export async function GET(request: Request) {
  const user = await identity(request);
  if (user instanceof AuthUnavailable) return reply({ error: user.message }, user.status);
  if (!user) return reply({ error: '로그인이 필요합니다.' }, 401);
  try {
    return reply(await readProfileSettings(user));
  } catch (error) {
    return failure(error, 'profile read failed');
  }
}

export async function POST(request: Request) {
  const user = await identity(request);
  if (user instanceof AuthUnavailable) return reply({ error: user.message }, user.status);
  if (!user) return reply({ error: '로그인이 필요합니다.' }, 401);
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return reply({ error: '허용되지 않은 요청입니다.' }, 403);
  if (!request.headers.get('content-type')?.includes('application/json'))
    return reply({ error: 'JSON 요청이 필요합니다.' }, 415);
  const raw = await request.text();
  if (raw.length > 32000) return reply({ error: '요청이 너무 큽니다.' }, 413);
  try {
    const b = JSON.parse(raw);
    if (!b || typeof b !== 'object' || Array.isArray(b)) return reply({ error: '요청 형식이 올바르지 않습니다.' }, 400);
    if (b.action !== 'save') return reply({ error: '지원하지 않는 작업입니다.' }, 400);
    return reply(await saveProfileSettings(user, b));
  } catch (error) {
    return failure(error, 'profile write failed');
  }
}
