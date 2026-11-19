import { identity, AuthUnavailable } from '@/lib/auth';
import { AccessError } from '@/lib/projects';
import { PolicyError } from '@/lib/sprint-policy';
import { Conflict } from '@/lib/sprint-store';
import { reviewTechnologies } from '@/lib/career/focused-model';
import {
  introFingerprint,
  introductionProviders,
} from '@/lib/career/introduction-config';
import { SKILLS, ROLES, TARGETS } from '@/lib/career/catalog';
import {
  CareerError,
  profileInput,
  basicAnalysis,
  gapsFor,
  recommendations,
  reviewAnalysis,
  type Analysis,
  type IntroResult,
} from '@/lib/career/profile';
import {
  analyzeWithAI,
  careerAiConfigured,
  careerAiInfo,
} from '@/lib/career/model';
import {
  claimProfileWrite,
  releaseProfileWrite,
} from '@/lib/career/profile-write';
import {
  readProfile,
  saveProfile,
  readExperiences,
  experienceSkills,
  createRecommendedProject,
  teamState,
  shareProfile,
  proposeRoles,
  applyRoles,
  recordExperience,
  pendingExperiences,
} from '@/lib/career/store';

export const dynamic = 'force-dynamic';
export const maxDuration = 240;
function reply(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
  });
}
function failure(e: unknown) {
  if (
    e instanceof CareerError ||
    e instanceof AccessError ||
    e instanceof PolicyError
  )
    return reply({ error: e.message }, e.status);
  if (e instanceof Conflict)
    return reply(
      {
        error: '프로젝트가 바뀌었습니다. 최신 상태를 불러와 다시 검토해주세요.',
      },
      409,
    );
  if (e instanceof SyntaxError)
    return reply({ error: '요청 형식을 확인해주세요.' }, 400);
  // Resume text, model responses, credentials and database errors must not enter logs or responses.
  console.error(
    'career request failed',
    e instanceof Error ? e.name : 'unknown',
  );
  return reply(
    {
      error:
        '저장소에 연결하지 못했습니다. 서버 설정·마이그레이션을 확인해주세요.',
    },
    503,
  );
}
export async function GET(request: Request) {
  const user = await identity(request);
  if (user instanceof AuthUnavailable)
    return reply({ error: user.message }, user.status);
  if (!user) return reply({ error: '로그인이 필요합니다.' }, 401);
  try {
    const projectId = new URL(request.url).searchParams.get('project');
    if (projectId) {
      const { _team, ...state } = await teamState(projectId, user);
      return reply(state);
    }
    const [profile, experiences, pending] = await Promise.all([
      readProfile(user.id),
      readExperiences(user.id),
      pendingExperiences(user.id),
    ]);
    const extra = experienceSkills(experiences);
    return reply({
      profile,
      experiences,
      pending,
      skills: SKILLS.map(({ id, name }) => ({ id, name })),
      roles: ROLES,
      targets: TARGETS,
      aiConfigured: careerAiConfigured(),
      ai: careerAiInfo(),
      introductionProviders: introductionProviders(),
      extraSkills: extra,
      gaps: profile ? gapsFor(profile, extra) : [],
      beforeGaps: profile ? gapsFor(profile) : [],
      recommendations: profile ? recommendations(profile, extra) : [],
    });
  } catch (e) {
    return failure(e);
  }
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
  if (body.length > 90000) return reply({ error: '요청이 너무 큽니다.' }, 413);
  try {
    const b = JSON.parse(body) as Record<string, unknown>;
    if (!b || typeof b !== 'object' || Array.isArray(b))
      throw new CareerError('요청 형식을 확인해주세요.');
    if (b.action === 'profile') {
      const input = profileInput(b);
      if (!Number.isInteger(b.version) || Number(b.version) < 0)
        throw new CareerError('프로필 버전을 확인해주세요.');
      if (b.mode !== 'basic' && b.mode !== 'ai')
        throw new CareerError('분석 방식을 선택해주세요.');
      const version = Number(b.version);
      const providers = introductionProviders();
      const ids =
        b.introductionProviders ??
        (b.introductionProvider === undefined ? [] : [b.introductionProvider]);
      if (
        !Array.isArray(ids) ||
        ids.length > providers.length ||
        new Set(ids).size !== ids.length ||
        ids.some((id) => !providers.some((provider) => provider.id === id))
      )
        throw new CareerError('비교할 소개 모델을 확인해주세요.');
      const selected = providers.filter((provider) =>
        ids.includes(provider.id),
      );
      if (selected.length && b.introductionConsent !== true)
        throw new CareerError(
          '선택한 외부 모델에 이력서 본문을 보내는 데 동의해주세요.',
        );
      if (b.mode === 'ai') {
        if (careerAiInfo().provider === 'openai' && b.consent !== true)
          throw new CareerError(
            '이력서와 목표 공고를 AI 분석에 보내는 데 동의해주세요.',
          );
        if (!careerAiConfigured())
          throw new CareerError(
            'AI 분석 설정이 없습니다. 기본 근거 추출을 선택해주세요.',
            503,
          );
      }
      const previous = version > 0 ? await readProfile(user.id) : null;
      const prior =
        previous?.resumeText === input.resumeText
          ? previous.analysis
          : undefined;
      const summaries = new Map(
        (prior?.workSummaries ?? []).map((summary) => [
          summary.provider,
          summary,
        ]),
      );
      const candidates = selected.map((provider) => {
        const cached = summaries.get(provider.id);
        const fingerprint = introFingerprint(
          input.resumeText,
          provider.id,
          provider.model,
          'work-summary',
        );
        return {
          provider,
          cached: cached?.fingerprint === fingerprint ? cached : undefined,
        };
      });
      const pending = candidates.filter(
        ({ provider, cached }) => provider.configured && !cached,
      );
      const quotaUnits = Math.max(b.mode === 'ai' ? 1 : 0, pending.length);
      const claim = await claimProfileWrite(user.id, version, quotaUnits);
      let externalAttempted = false;
      try {
        const extraction =
          b.mode === 'ai' ? await analyzeWithAI(input) : basicAnalysis(input);
        const results = new Map(
          candidates.flatMap(({ cached }) =>
            cached ? [[cached.provider, cached] as const] : [],
          ),
        );
        if (pending.length) {
          const { generateIntroduction } =
            await import('@/lib/career/introduction');
          externalAttempted = true;
          // Each model receives the same body and prompt. Run comparisons together
          // so they fit within the request budget even with local extraction.
          const generated = await Promise.allSettled(
            pending.map(({ provider }) =>
              generateIntroduction(
                input.resumeText,
                provider.id,
                'work-summary',
              ),
            ),
          );
          for (const result of generated)
            if (result.status === 'fulfilled')
              results.set(result.value.provider, result.value);
        }
        for (const [id, summary] of results) summaries.set(id, summary);
        const firstCompleted = selected.find((provider) =>
          results.has(provider.id),
        );
        const chosen = prior?.workSummaryProvider;
        const workSummaryProvider =
          chosen && summaries.has(chosen) ? chosen : firstCompleted?.id;
        const analysis: Analysis = {
          ...extraction,
          introductions: prior?.introductions,
          selectedIntroduction: prior?.selectedIntroduction,
          workSummaries: summaries.size ? [...summaries.values()] : undefined,
          workSummaryProvider,
        };
        let introductionStatus:
          | 'saved'
          | 'partial'
          | 'unavailable'
          | 'failed'
          | undefined;
        if (selected.length)
          introductionStatus =
            results.size === selected.length
              ? 'saved'
              : results.size > 0
                ? 'partial'
                : pending.length
                  ? 'failed'
                  : 'unavailable';
        const profile = await saveProfile(claim, input, analysis);
        return reply({
          profile,
          ...(introductionStatus && { introductionStatus }),
        });
      } catch (e) {
        await releaseProfileWrite(claim, !externalAttempted);
        throw e;
      }
    }
    if (
      b.action === 'reviewProfile' ||
      b.action === 'reviewTechnologies' ||
      b.action === 'selectWorkSummary'
    ) {
      if (!Number.isInteger(b.version) || Number(b.version) < 1)
        throw new CareerError('프로필 버전을 확인해주세요.');
      const claim = await claimProfileWrite(user.id, Number(b.version), false);
      try {
        const profile = await readProfile(user.id);
        if (!profile || profile.version !== Number(b.version))
          throw new CareerError('최신 프로필을 불러와 다시 검토해주세요.', 409);
        let analysis: Analysis;
        if (b.action === 'selectWorkSummary') {
          const summary = profile.analysis.workSummaries?.find(
            (item: IntroResult) => item.provider === b.provider,
          );
          if (!summary)
            throw new CareerError('현재 이력서로 만든 소개를 선택해주세요.');
          analysis = {
            ...profile.analysis,
            workSummaryProvider: summary.provider,
          };
        } else {
          analysis =
            b.action === 'reviewTechnologies'
              ? reviewTechnologies(b.changes, profile)
              : reviewAnalysis(b, profile);
        }
        return reply({
          profile: await saveProfile(claim, profileInput(profile), analysis),
        });
      } catch (e) {
        await releaseProfileWrite(claim);
        throw e;
      }
    }
    if (b.action === 'createProject')
      return reply({ projectId: await createRecommendedProject(user, b) }, 201);
    if (
      typeof b.projectId !== 'string' ||
      !b.projectId ||
      b.projectId.length > 100
    )
      throw new CareerError('프로젝트를 선택해주세요.');
    if (b.action === 'share' || b.action === 'unshare')
      await shareProfile(b.projectId, user, b);
    else if (b.action === 'recommendRoles')
      return reply(
        { proposalId: await proposeRoles(b.projectId, user, b.revision) },
        201,
      );
    else if (b.action === 'applyRoles') await applyRoles(b.projectId, user, b);
    else if (b.action === 'recordExperience')
      await recordExperience(b.projectId, user, b);
    else throw new CareerError('지원하지 않는 요청입니다.');
    return reply({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
