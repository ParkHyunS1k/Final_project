import { readFileSync } from 'node:fs';
import {
  basicAnalysis,
  CareerError,
  type Analysis,
  type ProfileInput,
  type Profile,
  type Technology,
} from './profile';
import { isSkill, type SkillId } from './catalog';

export function reviewTechnologies(value: unknown, profile: Profile): Analysis {
  const original = profile.analysis.technologies;
  if (
    !original ||
    !Array.isArray(value) ||
    !value.length ||
    value.length > original.length
  )
    throw new CareerError('수정할 기술을 확인해주세요.');
  const changes = new Map<string, Technology['state']>();
  for (const c of value) {
    if (
      !c ||
      typeof c.name !== 'string' ||
      changes.has(c.name) ||
      !original.some((t) => t.name === c.name) ||
      ![
        'used',
        'studied',
        'listed',
        'planned',
        'other',
        'denied',
        'unclear',
      ].includes(c.state)
    )
      throw new CareerError('저장된 기술의 경험 분류만 수정할 수 있습니다.');
    changes.set(c.name, c.state);
  }
  const technologies = original.map((t) =>
    changes.has(t.name)
      ? { ...t, state: changes.get(t.name)!, reviewed: true }
      : t,
  );
  const mapping: Record<string, SkillId> = {
    Python: 'python',
    SQL: 'sql',
    MySQL: 'sql',
    SQLite: 'sql',
    PostgreSQL: 'sql',
    MariaDB: 'sql',
    Oracle: 'sql',
    Docker: 'docker',
    React: 'react',
    'React Native': 'react',
    TypeScript: 'typescript',
  };
  const ranked = [...technologies].sort(
    (a, b) =>
      ['used', 'studied', 'listed'].indexOf(a.state) -
      ['used', 'studied', 'listed'].indexOf(b.state),
  );
  const changedSkills = new Set(
    value.map((c) => mapping[c.name]).filter(Boolean),
  );
  const skills = profile.analysis.skills.filter(
    (s) => !changedSkills.has(s.skillId),
  );
  for (const t of ranked) {
    const sid = mapping[t.name];
    if (
      !changedSkills.has(sid) ||
      skills.some((s) => s.skillId === sid) ||
      !['used', 'studied', 'listed'].includes(t.state)
    )
      continue;
    skills.push({
      skillId: sid,
      level:
        t.state === 'used'
          ? 'applied'
          : t.state === 'studied'
            ? 'learning'
            : 'mentioned',
      quote: t.mentions[0].text,
      source: 'resume',
    });
  }
  return {
    ...profile.analysis,
    technologies,
    skills,
    reviewedAt: new Date().toISOString(),
  };
}

export function focusedModelConfig() {
  const url = new URL(
    process.env.CAREERFLOW_LORA_URL || 'http://127.0.0.1:3291',
  );
  if (
    process.env.VERCEL ||
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
    throw new CareerError(
      'LoRA 서버는 이 컴퓨터의 로컬 주소로 설정해주세요.',
      503,
    );
  const token =
    process.env.CAREERFLOW_LORA_TOKEN ||
    readFileSync(process.env.CAREERFLOW_LORA_TOKEN_FILE || '', 'utf8').trim();
  if (token.length < 32)
    throw new CareerError('LoRA 서버 인증 설정을 확인해주세요.', 503);
  return { url: new URL('/analyze', url), token, label: 'Qwen3 4B + LoRA v6' };
}

export function validateFocused(value: unknown, input: ProfileInput): Analysis {
  const b = value as {
    format?: string;
    model?: string;
    adapter?: string;
    technologies?: Technology[];
    skills?: {
      skillId: SkillId;
      level: 'applied' | 'learning' | 'mentioned';
    }[];
  };
  const states = [
    'used',
    'studied',
    'listed',
    'planned',
    'other',
    'denied',
    'unclear',
  ];
  if (
    !b ||
    b.format !== 'focused-state-v1' ||
    b.model !== 'Qwen3 4B + LoRA v6' ||
    b.adapter !== 'resume-reviewed-20261107-selected' ||
    !Array.isArray(b.technologies) ||
    b.technologies.length > 64 ||
    !Array.isArray(b.skills)
  )
    throw new CareerError('LoRA 응답 형식을 확인해주세요.', 502);
  const names = new Set<string>();
  for (const t of b.technologies) {
    if (
      !t ||
      typeof t.name !== 'string' ||
      !t.name ||
      t.name.length > 80 ||
      names.has(t.name) ||
      !states.includes(t.state) ||
      !Array.isArray(t.mentions) ||
      !t.mentions.length ||
      t.mentions.some(
        (m) =>
          !m ||
          typeof m.quote !== 'string' ||
          !m.quote ||
          typeof m.text !== 'string' ||
          !m.text.includes(m.quote) ||
          !input.resumeText.includes(m.text),
      )
    )
      throw new CareerError('원문과 일치하지 않는 기술 근거입니다.', 502);
    names.add(t.name);
  }
  const mapping: Record<string, string[]> = {
    python: ['Python'],
    sql: ['SQL', 'MySQL', 'SQLite', 'PostgreSQL', 'MariaDB', 'Oracle'],
    docker: ['Docker'],
    react: ['React', 'React Native'],
    typescript: ['TypeScript'],
  };
  const levels = {
    used: 'applied',
    studied: 'learning',
    listed: 'mentioned',
  } as const;
  const skills = b.skills.map((s) => {
    const evidence = b.technologies!.find(
      (t) =>
        mapping[s.skillId]?.includes(t.name) &&
        t.state in levels &&
        levels[t.state as keyof typeof levels] === s.level,
    );
    if (!isSkill(s.skillId) || !evidence)
      throw new CareerError('기술과 역량의 연결이 올바르지 않습니다.', 502);
    return {
      ...s,
      quote: evidence.mentions[0].text,
      source: 'resume' as const,
    };
  });
  return {
    mode: 'ai',
    engine: { provider: 'local', model: b.model, adapter: b.adapter },
    summary: '이력서에 적힌 기술을 경험 문맥에 따라 정리했습니다.',
    technologies: b.technologies,
    skills,
    // Job requirements are a distinct task, never classified by the resume adapter.
    requirements: basicAnalysis(input).requirements,
    questions: [],
  };
}

export async function analyzeFocused(input: ProfileInput) {
  if (Array.from(input.resumeText).length > 12000)
    throw new CareerError(
      'LoRA 분석은 한 사람의 이력서 12,000자까지 지원합니다. 원문은 자동으로 자르지 않습니다.',
    );
  try {
    const config = focusedModelConfig();
    const response = await fetch(config.url, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(180000),
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.token}`,
      },
      body: JSON.stringify({ text: input.resumeText }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new CareerError(
        response.status === 409
          ? '로컬 모델이 다른 분석을 진행 중입니다. 잠시 후 다시 시도해주세요.'
          : response.status === 422
            ? '입력 길이 또는 기술 후보 수가 로컬 모델 한도를 넘었습니다.'
            : 'LoRA 서버 상태를 확인해주세요.',
        response.status === 409 ? 409 : 502,
      );
    }
    return validateFocused(await response.json(), input);
  } catch (e) {
    if (e instanceof CareerError) throw e;
    throw new CareerError(
      '학습한 LoRA 서버에 연결하지 못했습니다. 로컬 모델 서버를 실행해주세요.',
      503,
    );
  }
}
