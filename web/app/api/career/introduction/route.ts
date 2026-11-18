import { identity, AuthUnavailable } from '@/lib/auth';
import { CareerError, profileInput } from '@/lib/career/profile';
import { readProfile, saveProfile } from '@/lib/career/store';
import {
  claimProfileWrite,
  releaseProfileWrite,
} from '@/lib/career/profile-write';
import {
  generateIntroduction,
  introductionProviders,
  introFingerprint,
  INTRO_PROVIDERS,
  type IntroProvider,
} from '@/lib/career/introduction';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;
const reply = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
  });
export async function GET(request: Request) {
  const user = await identity(request);
  if (user instanceof AuthUnavailable)
    return reply({ error: user.message }, user.status);
  if (!user) return reply({ error: '로그인이 필요합니다.' }, 401);
  return reply({ providers: introductionProviders() });
}
export async function POST(request: Request) {
  const user = await identity(request);
  if (user instanceof AuthUnavailable)
    return reply({ error: user.message }, user.status);
  if (!user) return reply({ error: '로그인이 필요합니다.' }, 401);
  if (
    request.headers.get('origin') &&
    request.headers.get('origin') !== new URL(request.url).origin
  )
    return reply({ error: '허용되지 않은 요청입니다.' }, 403);
  if (!request.headers.get('content-type')?.includes('application/json'))
    return reply({ error: 'JSON 요청이 필요합니다.' }, 415);
  const body = await request.text();
  if (body.length > 1000) return reply({ error: '요청이 너무 큽니다.' }, 413);
  try {
    const b = JSON.parse(body);
    if (
      !b ||
      !Number.isInteger(b.version) ||
      b.version < 1 ||
      !INTRO_PROVIDERS.includes(b.provider) ||
      !['generate', 'select'].includes(b.action)
    )
      throw new CareerError('소개 요청을 확인해주세요.');
    const provider = b.provider as IntroProvider;
    const profile = await readProfile(user.id);
    if (!profile || profile.version !== b.version)
      throw new CareerError(
        '이력서가 변경되었습니다. 새로고침 후 다시 시도해주세요.',
        409,
      );
    const prior = profile.analysis.introductions ?? [];
    const config = introductionProviders().find((p) => p.id === provider)!;
    const cached = prior.find(
      (r) =>
        r.provider === provider &&
        r.fingerprint ===
          introFingerprint(profile.resumeText, provider, config.model),
    );
    if (b.action === 'generate') {
      if (b.consent !== true)
        throw new CareerError(
          '선택한 외부 서비스로 이력서 본문을 보내는 데 동의해주세요.',
        );
      if (cached) return reply({ profile, cached: true });
      if (!config.configured)
        throw new CareerError(
          `${config.label} API 키를 서버에 설정해주세요.`,
          503,
        );
    } else if (!cached)
      throw new CareerError('현재 이력서로 생성한 소개를 먼저 선택해주세요.');
    const claim = await claimProfileWrite(
      user.id,
      b.version,
      b.action === 'generate',
    );
    try {
      const result =
        b.action === 'generate'
          ? await generateIntroduction(profile.resumeText, provider)
          : cached!;
      const analysis = {
        ...profile.analysis,
        introductions: [
          ...prior.filter((r) => r.provider !== provider),
          result,
        ],
        selectedIntroduction:
          b.action === 'select'
            ? provider
            : profile.analysis.selectedIntroduction === provider
              ? undefined
              : profile.analysis.selectedIntroduction,
      };
      return reply({
        profile: await saveProfile(claim, profileInput(profile), analysis),
        cached: false,
      });
    } catch (e) {
      // A provider attempt may have incurred cost. Keep its daily quota charge.
      await releaseProfileWrite(claim);
      throw e;
    }
  } catch (e) {
    if (e instanceof CareerError) return reply({ error: e.message }, e.status);
    if (e instanceof SyntaxError)
      return reply({ error: 'JSON 형식을 확인해주세요.' }, 400);
    return reply(
      { error: '소개를 저장하지 못했습니다. 잠시 후 다시 시도해주세요.' },
      503,
    );
  }
}
