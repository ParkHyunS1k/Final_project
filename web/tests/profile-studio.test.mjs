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
process.env.CAREERFLOW_INTRO_PROVIDER = 'openai';
const db = await setupTestDb();
const dir = mkdtempSync(join(process.cwd(), 'node_modules/.cache/studio-'));
const out = join(dir, 'test.mjs');
await build({
  stdin: {
    contents: `export { POST as careerPOST, GET as careerGET } from './app/api/career/route';
    export { validateIntroduction } from './lib/career/introduction';
    export { introFingerprint } from './lib/career/introduction-config';
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
    new Request('https://test.local/api/career', {
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

test('소개 문장 수와 원문 인용을 검사한다', () => {
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
test('소개 요청은 로그인, 전송 동의 및 서버에서 지정한 모델을 요구한다', async () => {
  let calls = 0;
  globalThis.__INTRO_CALL = async () => {
    calls++;
    return generation();
  };
  const body = {
    ...input,
    action: 'profile',
    version: 0,
    mode: 'basic',
    introductionProvider: 'openai',
    introductionConsent: true,
  };
  assert.equal((await send(api.careerPOST, undefined, body)).status, 401);
  assert.equal(
    (
      await send(api.careerPOST, 'intro-auth', body, {
        origin: 'https://other.local',
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await send(api.careerPOST, 'intro-auth', {
        ...body,
        introductionConsent: false,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await send(api.careerPOST, 'intro-auth', {
        ...body,
        introductionProvider: 'google',
      })
    ).status,
    400,
  );
  assert.equal(calls, 0);
  const response = await api.careerGET(
    new Request('https://test.local/api/career', {
      headers: headers('intro-auth'),
    }),
  );
  const config = await response.json();
  assert.deepEqual(config.introduction, {
    provider: 'openai',
    label: 'OpenAI',
  });
  assert.equal(config.introductionProviders, undefined);
  assert.equal(
    await db.one('SELECT n FROM career_ai_quota WHERE user_id=?', 'intro-auth'),
    null,
  );
});

test('동일 프로필의 동시 요청은 소개를 한 번만 생성하고 재제출은 결과를 재사용한다', async () => {
  let calls = 0;
  let finish;
  let started;
  const entered = new Promise((resolve) => {
    started = resolve;
  });
  const gate = new Promise((resolve) => {
    finish = resolve;
  });
  globalThis.__INTRO_CALL = async () => {
    calls++;
    started();
    await gate;
    return generation();
  };
  const body = {
    ...input,
    action: 'profile',
    version: 0,
    mode: 'basic',
    introductionProvider: 'openai',
    introductionConsent: true,
  };
  const first = send(api.careerPOST, 'intro-race', body);
  await entered;
  try {
    assert.equal((await send(api.careerPOST, 'intro-race', body)).status, 409);
  } finally {
    finish();
  }
  assert.equal((await first).status, 200);
  const retry = await send(api.careerPOST, 'intro-race', {
    ...body,
    version: 1,
  });
  assert.equal(retry.status, 200);
  assert.equal((await retry.json()).introductionStatus, 'saved');
  assert.equal(calls, 1);
  assert.equal(
    (
      await db.one(
        'SELECT n FROM career_ai_quota WHERE user_id=?',
        'intro-race',
      )
    ).n,
    1,
  );
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

test('이력서 제출 한 번으로 LoRA 기술 판정과 한 문장 소개를 같은 버전에 저장한다', async (t) => {
  const settings = {
    CAREERFLOW_AI_PROVIDER: 'local',
    CAREERFLOW_LOCAL_ENGINE: 'focused-lora',
    CAREERFLOW_LORA_URL: 'http://127.0.0.1:3291',
    CAREERFLOW_LORA_TOKEN: 'test-only-token'.repeat(3),
  };
  const originalEnv = Object.fromEntries(
    Object.keys(settings).map((key) => [key, process.env[key]]),
  );
  const originalFetch = globalThis.fetch;
  t.after(() => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    globalThis.fetch = originalFetch;
  });
  Object.assign(process.env, settings);
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push('lora');
    assert.equal(
      typeof url === 'string' ? url : url instanceof URL ? url.href : url.url,
      'http://127.0.0.1:3291/analyze',
    );
    assert.equal(JSON.parse(options.body).text, source);
    return Response.json({
      format: 'focused-state-v1',
      model: 'Qwen3 4B + LoRA v6',
      adapter: 'resume-reviewed-20261107-selected',
      technologies: [
        {
          name: 'pandas',
          state: 'used',
          mentions: [
            { quote: 'pandas', text: '사용 기술: Python, pandas, SQL' },
          ],
        },
      ],
      skills: [],
    });
  };
  globalThis.__INTRO_CALL = async (args) => {
    calls.push('summary');
    assert.deepEqual(JSON.parse(args.prompt), { resume: source });
    assert.match(args.instructions, /한국어 한 문장/);
    return generation();
  };
  const body = {
    ...input,
    targetPosting: '비교용 공고이며 소개 모델로 보내지 않습니다.',
    action: 'profile',
    mode: 'ai',
    version: 0,
    introductionProvider: 'openai',
    introductionConsent: true,
  };
  const response = await send(api.careerPOST, 'one-click', body);
  assert.equal(response.status, 200, await response.clone().text());
  const { profile, introductionStatus } = await response.json();
  assert.equal(introductionStatus, 'saved');
  assert.equal(profile.version, 1);
  assert.equal(profile.analysis.engine.model, 'Qwen3 4B + LoRA v6');
  assert.equal(profile.analysis.technologies[0].name, 'pandas');
  assert.equal(profile.analysis.workSummary.provider, 'openai');
  assert.deepEqual(profile.analysis.workSummary.lines, validOutput.lines);
  assert.deepEqual(calls, ['lora', 'summary']);
  assert.equal(
    (await db.one('SELECT n FROM career_ai_quota WHERE user_id=?', 'one-click'))
      .n,
    1,
  );
  assert.equal((await send(api.careerPOST, 'one-click', body)).status, 409);
  assert.deepEqual(calls, ['lora', 'summary']);

  const repeated = await send(api.careerPOST, 'one-click', {
    ...body,
    version: 1,
  });
  assert.equal(repeated.status, 200);
  assert.equal(
    (await repeated.json()).profile.analysis.workSummary.lines.length,
    1,
  );
  assert.deepEqual(calls, ['lora', 'summary', 'lora']);
});

test('소개 생성의 동의와 한 문장 제한을 확인하며 소개 실패 후에도 기술 결과를 저장한다', async () => {
  let calls = 0;
  globalThis.__INTRO_CALL = async () => {
    calls++;
    return {
      ...generation(),
      output: { lines: [validOutput.lines[0], validOutput.lines[0]] },
    };
  };
  const body = {
    ...input,
    action: 'profile',
    mode: 'basic',
    version: 0,
    introductionProvider: 'openai',
  };
  const rejected = await send(api.careerPOST, 'summary-failure', body);
  assert.equal(rejected.status, 400);
  assert.equal(calls, 0);
  const response = await send(api.careerPOST, 'summary-failure', {
    ...body,
    introductionConsent: true,
  });
  assert.equal(response.status, 200);
  const { profile, introductionStatus } = await response.json();
  assert.equal(introductionStatus, 'failed');
  assert.equal(profile.version, 1);
  assert.ok(profile.analysis.skills.length > 0);
  assert.equal(profile.analysis.workSummary, undefined);
  assert.equal(calls, 1);

  const fallback = await send(api.careerPOST, 'summary-failure', {
    ...input,
    action: 'profile',
    mode: 'basic',
    version: 1,
  });
  assert.equal(fallback.status, 200);
  assert.equal(calls, 1);
});

test('소개 설정이 비어 있어도 기술 분석을 저장할 수 있다', async (t) => {
  process.env.CAREERFLOW_INTRO_PROVIDER = 'off';
  t.after(() => {
    process.env.CAREERFLOW_INTRO_PROVIDER = 'openai';
  });
  const response = await api.careerGET(
    new Request('https://test.local/api/career', {
      headers: headers('intro-off'),
    }),
  );
  assert.equal((await response.json()).introduction, null);
  const profile = await create('intro-off');
  assert.ok(profile.analysis.skills.length > 0);
  assert.equal(profile.analysis.workSummary, undefined);
});
