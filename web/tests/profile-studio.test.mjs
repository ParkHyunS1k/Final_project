import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setupTestDb } from './helpers/pg-db.mjs';

process.env.AUTH_DEV_HEADERS = '1';
process.env.OPENAI_API_KEY = 'synthetic-test-key';
process.env.ANTHROPIC_API_KEY = 'synthetic-test-key';
process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'synthetic-test-key';
const db = await setupTestDb();
const dir = mkdtempSync(join(process.cwd(), 'node_modules/.cache/studio-'));
const out = join(dir, 'test.mjs');
await build({
  stdin: {
    contents: `export { POST, GET } from './app/api/career/introduction/route';
    export { POST as careerPOST } from './app/api/career/route';
    export { validateIntroduction, introFingerprint } from './lib/career/introduction';
    export { validateFocused, reviewTechnologies } from './lib/career/focused-model';
    export { buildKnowledgeGraph } from './lib/career/knowledge-graph';`,
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  outfile: out,
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
  plugins: [
    {
      name: 'test-boundaries',
      setup(b) {
        b.onResolve({ filter: /^\.\/db$/ }, () => ({
          path: 'db',
          namespace: 'stub',
        }));
        b.onResolve({ filter: /^ai$/ }, () => ({
          path: 'ai',
          namespace: 'stub',
        }));
        b.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({
          contents:
            args.path === 'db'
              ? 'export function database(){return globalThis.__TEST_DB}'
              : 'export const Output={object:x=>x}; export async function generateText(args){return globalThis.__INTRO_CALL(args)}',
          loader: 'js',
        }));
      },
    },
  ],
});
const api = await import(pathToFileURL(out).href);
after(async () => {
  await globalThis.__TEST_DB.close();
  rmSync(dir, { recursive: true });
});
const source =
  '프로젝트: 문의 분석\n담당 업무: 고객 문의 데이터를 직접 정제하고 분류했습니다.\n사용 기술: Python, pandas, SQL\n교육: Docker 학습 예정';
const input = {
  resumeName: '가상 이력서',
  resumeText: source,
  targetRole: '',
  targetPosting: '',
  preferredRoles: [],
  learningGoals: [],
  noExperience: [],
};
const headers = (user) => ({
  'content-type': 'application/json',
  origin: 'https://test.local',
  ...(user ? { 'oai-authenticated-user-id': user } : {}),
});
const send = (fn, user, body, extraHeaders = {}) =>
  fn(
    new Request('https://test.local/api/career/introduction', {
      method: 'POST',
      headers: { ...headers(user), ...extraHeaders },
      body: JSON.stringify(body),
    }),
  );
async function create(user) {
  const r = await send(api.careerPOST, user, {
    ...input,
    action: 'profile',
    mode: 'basic',
    version: 0,
  });
  assert.equal(r.status, 200);
  return (await r.json()).profile;
}
const validOutput = {
  lines: [
    {
      text: '고객 문의 데이터를 정제하고 분류하는 프로젝트를 수행했습니다.',
      evidence: ['고객 문의 데이터를 직접 정제하고 분류했습니다.'],
    },
  ],
};
const generation = () => ({
  output: validOutput,
  finishReason: 'stop',
  usage: { inputTokens: 120, outputTokens: 80 },
});

test('소개는 3문장 한도와 실제 원문 인용을 검사한다', () => {
  assert.equal(api.validateIntroduction(validOutput, source).length, 1);
  assert.throws(() =>
    api.validateIntroduction(
      { lines: Array(4).fill(validOutput.lines[0]) },
      source,
    ),
  );
  assert.throws(() =>
    api.validateIntroduction(
      { lines: [{ text: '없는 성과', evidence: ['매출 200% 증가'] }] },
      source,
    ),
  );
  assert.throws(() =>
    api.validateIntroduction(
      { lines: [{ ...validOutput.lines[0], text: '두 줄\n문장' }] },
      source,
    ),
  );
  assert.notEqual(
    api.introFingerprint(source, 'openai', 'a'),
    api.introFingerprint(source + '수정', 'openai', 'a'),
  );
});
test('인증, 동의, 소유권과 Origin을 확인하고 모델을 호출하지 않는다', async () => {
  let calls = 0;
  globalThis.__INTRO_CALL = async () => {
    calls++;
    return generation();
  };
  const p = await create('owner');
  const body = {
    version: p.version,
    provider: 'openai',
    action: 'generate',
    consent: true,
  };
  assert.equal((await send(api.POST, null, body)).status, 401);
  assert.equal((await send(api.POST, 'other', body)).status, 409);
  assert.equal(
    (await send(api.POST, 'owner', { ...body, consent: false })).status,
    400,
  );
  assert.equal(
    (await send(api.POST, 'owner', body, { origin: 'https://evil.local' }))
      .status,
    403,
  );
  assert.equal(calls, 0);
});
test('동시 요청은 선점한 한 건만 호출하며 재요청은 저장된 결과를 재사용한다', async () => {
  const p = await create('concurrent');
  let release;
  const gate = new Promise((r) => {
    release = r;
  });
  let entered;
  const started = new Promise((r) => {
    entered = r;
  });
  let calls = 0;
  globalThis.__INTRO_CALL = async (args) => {
    calls++;
    assert.equal(JSON.parse(args.prompt).resume, source);
    assert.equal(args.maxRetries, 0);
    entered();
    await gate;
    return generation();
  };
  const body = {
    version: p.version,
    provider: 'openai',
    action: 'generate',
    consent: true,
  };
  const first = send(api.POST, 'concurrent', body);
  await started;
  const second = await send(api.POST, 'concurrent', body);
  assert.equal(second.status, 409);
  release();
  const response = await first;
  assert.equal(response.status, 200);
  const saved = (await response.json()).profile;
  assert.equal(saved.analysis.introductions.length, 1);
  const cached = await send(api.POST, 'concurrent', {
    ...body,
    version: saved.version,
  });
  assert.equal(cached.status, 200);
  assert.equal((await cached.json()).cached, true);
  assert.equal(calls, 1);
  assert.equal(
    (
      await db.one(
        'SELECT n FROM career_ai_quota WHERE user_id=?',
        'concurrent',
      )
    ).n,
    1,
  );
  const chosen = await send(api.POST, 'concurrent', {
    ...body,
    version: saved.version,
    action: 'select',
    consent: false,
  });
  assert.equal(chosen.status, 200);
  assert.equal(
    (await chosen.json()).profile.analysis.selectedIntroduction,
    'openai',
  );
  assert.equal(calls, 1);
});
test('실패는 선점을 해제하고 모델별 결과와 한도를 구분한다', async () => {
  let p = await create('failure');
  globalThis.__INTRO_CALL = async () => {
    throw new Error('SECRET and RESUME must never be returned');
  };
  const body = {
    version: p.version,
    provider: 'google',
    action: 'generate',
    consent: true,
  };
  const failure = await send(api.POST, 'failure', body);
  assert.equal(failure.status, 502);
  assert.doesNotMatch(await failure.text(), /SECRET|RESUME/);
  assert.equal(
    (
      await db.one(
        'SELECT claim_id FROM career_profile_writes WHERE user_id=?',
        'failure',
      )
    ).claim_id,
    null,
  );
  globalThis.__INTRO_CALL = async () => generation();
  for (const provider of ['google', 'anthropic', 'openai']) {
    const response = await send(api.POST, 'failure', {
      ...body,
      version: p.version,
      provider,
    });
    assert.equal(response.status, 200);
    p = (await response.json()).profile;
  }
  assert.equal(p.analysis.introductions.length, 3);
  const fresh = await send(api.careerPOST, 'failure', {
    ...input,
    resumeText: source + '\n수정한 경험입니다.',
    action: 'profile',
    version: p.version,
    mode: 'basic',
  });
  assert.equal(fresh.status, 200);
  assert.equal((await fresh.json()).profile.analysis.introductions, undefined);
});
test('LoRA 기술명은 보존하고 근거가 원문과 다르면 거부한다', () => {
  const value = {
    format: 'focused-state-v1',
    model: 'Qwen3 4B + LoRA v6',
    adapter: 'resume-reviewed-20261107-selected',
    technologies: ['Python', 'pandas', 'SQL'].map((name) => ({
      name,
      state: 'used',
      mentions: [{ quote: name, text: '사용 기술: Python, pandas, SQL' }],
    })),
    skills: [
      { skillId: 'python', level: 'applied' },
      { skillId: 'sql', level: 'applied' },
    ],
  };
  const analysis = api.validateFocused(value, input);
  assert.equal(analysis.technologies[1].name, 'pandas');
  assert.equal(analysis.skills.length, 2);
  assert.throws(() =>
    api.validateFocused(
      {
        ...value,
        technologies: [
          {
            name: 'Python',
            state: 'used',
            mentions: [
              { quote: 'Python', text: 'Python으로 없는 성과를 만들었다' },
            ],
          },
        ],
      },
      input,
    ),
  );
  const graph = api.buildKnowledgeGraph({ ...input, analysis }, [], []);
  assert.ok(graph.nodes.some((n) => n.label === 'pandas'));
  assert.ok(
    graph.links.some(
      (l) => l.source === 'resume:0' && l.target === 'tech:pandas',
    ),
  );
  assert.equal(graph.nodes.find((n) => n.id === 'tech:pandas').degree, 2);
  assert.equal(
    graph.nodes.some((n) => n.label === 'Docker'),
    false,
  );
  assert.deepEqual(api.buildKnowledgeGraph(null, [{ valid: false }], []), {
    nodes: [],
    links: [],
  });
});

test('기술 수정은 원문을 보존하고 추천 역량도 갱신한다', () => {
  const p = {
    ...input,
    analysis: {
      mode: 'ai',
      summary: '',
      requirements: [],
      questions: [],
      technologies: [
        {
          name: 'Python',
          state: 'used',
          mentions: [
            { quote: 'Python', text: '사용 기술: Python, pandas, SQL' },
          ],
        },
      ],
      skills: [
        {
          skillId: 'python',
          level: 'applied',
          source: 'resume',
          quote: '사용 기술: Python, pandas, SQL',
        },
      ],
    },
  };
  const changed = api.reviewTechnologies(
    [{ name: 'Python', state: 'other' }],
    p,
  );
  assert.equal(changed.skills.length, 0);
  assert.equal(changed.technologies[0].reviewed, true);
  assert.deepEqual(
    changed.technologies[0].mentions,
    p.analysis.technologies[0].mentions,
  );
  assert.throws(() =>
    api.reviewTechnologies([{ name: 'Unknown', state: 'used' }], p),
  );
  const graph = api.buildKnowledgeGraph(
    {
      ...p,
      analysis: {
        ...p.analysis,
        technologies: [
          ...p.analysis.technologies,
          {
            name: 'Docker',
            state: 'studied',
            mentions: [{ quote: 'Docker', text: '교육: Docker 학습 예정' }],
          },
        ],
      },
    },
    [],
    [],
  );
  assert.equal(
    graph.links.some(
      (l) => l.source === 'resume:0' && l.target === 'tech:Docker',
    ),
    false,
  );
});

test('새 모델로 소개를 다시 생성하면 이전 선택을 자동 승인하지 않는다', async () => {
  const p = await create('model-change');
  globalThis.__INTRO_CALL = async () => generation();
  const body = {
    action: 'generate',
    provider: 'openai',
    consent: true,
    version: p.version,
  };
  const generated = (await (await send(api.POST, 'model-change', body)).json())
    .profile;
  const selected = (
    await (
      await send(api.POST, 'model-change', {
        ...body,
        action: 'select',
        version: generated.version,
      })
    ).json()
  ).profile;
  process.env.CAREERFLOW_INTRO_OPENAI_MODEL = 'gpt-6.1-terra';
  try {
    const changed = await send(api.POST, 'model-change', {
      ...body,
      version: selected.version,
    });
    assert.equal(changed.status, 200);
    const updated = (await changed.json()).profile;
    assert.equal(updated.analysis.selectedIntroduction, undefined);
    assert.equal(updated.analysis.introductions[0].model, 'gpt-6.1-terra');
  } finally {
    delete process.env.CAREERFLOW_INTRO_OPENAI_MODEL;
  }
});
