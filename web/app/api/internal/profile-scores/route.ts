// 매일 03:00(KST) Vercel Cron이 부르는 프로필 점수 일괄 계산. 서버 비밀값으로만 실행한다.
// Vercel은 CRON_SECRET을 Authorization: Bearer로 보낸다. 비밀값이 없으면 실행하지 않는다.
import { refreshAllProfileScores } from '@/lib/profile-store';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function reply(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
}

// 길이가 같은 문자열 비교로 타이밍 차이를 줄인다(reminders 경로와 같은 방식).
function sameSecret(a: string, b: string) {
  if (a.length !== b.length || !a.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function GET(request: Request) {
  const secret = (process.env.CRON_SECRET ?? '').trim();
  // Authorization: Bearer <비밀값> 형식만 받는다.
  const presented = /^Bearer\s+(.+)$/i.exec(request.headers.get('authorization') ?? '')?.[1] ?? '';
  if (!secret || !sameSecret(secret, presented)) return reply({ error: 'not authorized' }, 401);
  try {
    return reply(await refreshAllProfileScores(new Date()));
  } catch (error) {
    console.error('profile score refresh failed', error);
    return reply({ error: 'refresh failed' }, 503);
  }
}
