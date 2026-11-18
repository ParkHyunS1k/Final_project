import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { setupTestDb } from './helpers/pg-db.mjs';
process.env.AUTH_DEV_HEADERS = '1';
process.env.CAREERFLOW_AI_PROVIDER = 'openai';
delete process.env.OPENAI_API_KEY;
const db = await setupTestDb();
const out = join(mkdtempSync(join(tmpdir(), 'career-test-')), 'api.mjs');
await build({
  stdin: {
    contents: `export {GET,POST} from './app/api/career/route';
    export {GET as sprintGET,POST as sprintPOST} from './app/api/sprint/route';
    export {POST as projectPOST} from './app/api/projects/route';
    export {basicAnalysis,profileInput,validateAnalysis} from './lib/career/profile';
    export {pdfPageText} from './lib/career/pdf-text';
    export {sourceLines,resolveLocalEvidence} from './lib/career/local-evidence';
    export {recommendRoles} from './lib/career/roles'; export {TEMPLATES} from './lib/career/catalog';`,
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  outfile: out,
  bundle: true,
  platform: 'node',
  format: 'esm',
  plugins: [
    {
      name: 'memory-db',
      setup(b) {
        b.onResolve({ filter: /^\.\/db$/ }, () => ({
          path: 'db',
          namespace: 'test',
        }));
        b.onLoad({ filter: /.*/, namespace: 'test' }, () => ({
          contents: 'export function database(){return globalThis.__TEST_DB}',
          loader: 'js',
        }));
      },
    },
  ],
});
const api = await import(pathToFileURL(out).href);
after(async () => {
  await globalThis.__TEST_DB.close();
});
function headers(user) {
  return {
    'content-type': 'application/json',
    origin: 'https://test.local',
    ...(user
      ? {
          'oai-authenticated-user-id': user,
          'oai-authenticated-user-email': user + '@test.local',
        }
      : {}),
  };
}
const send = (fn, user, body, path = '/api/career') =>
  fn(
    new Request('https://test.local' + path, {
      method: 'POST',
      headers: headers(user),
      body: JSON.stringify(body),
    }),
  );
const post = (user, body) => send(api.POST, user, body);
const get = (user, project = '') =>
  api.GET(
    new Request(
      'https://test.local/api/career' + (project ? '?project=' + project : ''),
      { headers: headers(user) },
    ),
  );
async function json(response, status = 200) {
  assert.equal(response.status, status, await response.clone().text());
  return response.json();
}
const profileBody = (over = {}) => ({
  action: 'profile',
  version: 0,
  resumeName: '개발 이력서',
  resumeText:
    'Python과 FastAPI로 문서 검색 API를 구현했습니다.\nRAG 검색 서비스를 개발하고 테스트를 작성했습니다.\nDocker는 아직 경험이 없습니다.',
  targetRole: 'ai-engineer',
  targetPosting: 'Python API 개발 경험 필수\nDocker와 배포 경험 우대',
  learningGoals: ['docker', 'deploy'],
  preferredRoles: ['ai'],
  noExperience: ['docker'],
  mode: 'basic',
  ...over,
});
async function profile(user, over = {}) {
  return (await json(await post(user, profileBody(over)))).profile;
}
async function team(prefix) {
  const owner = prefix + '-owner',
    mate = prefix + '-mate';
  const a = await profile(owner);
  const b = await profile(mate, {
    resumeText:
      'React와 TypeScript로 서비스 화면을 구현했습니다.\nDocker 실행 환경을 구성했고 테스트를 작성했습니다.',
    preferredRoles: ['frontend', 'delivery'],
    noExperience: [],
    learningGoals: ['api'],
  });
  const created = await json(
    await post(owner, {
      action: 'createProject',
      templateId: 'search-api',
      profileId: a.id,
      requestId: crypto.randomUUID(),
      agreed: true,
    }),
    201,
  );
  const id = created.projectId;
  let state = await json(await get(owner, id));
  const invitation = await json(
    await send(api.projectPOST, owner, {
      action: 'invite',
      projectId: id,
      revision: state.revision,
      email: mate + '@test.local',
    }),
    201,
  );
  await json(
    await send(api.projectPOST, mate, {
      action: 'accept',
      token: invitation.token,
      agreed: true,
      goalVersion: 1,
    }),
  );
  for (const [user, p] of [
    [owner, a],
    [mate, b],
  ]) {
    state = await json(await get(user, id));
    await json(
      await post(user, {
        action: 'share',
        projectId: id,
        revision: state.revision,
        profileId: p.id,
        skillIds: p.analysis.skills
          .filter((s) => !p.noExperience.includes(s.skillId))
          .map((s) => s.skillId),
      }),
    );
  }
  return { owner, mate, id, a, b, state: await json(await get(owner, id)) };
}
async function proposal(t) {
  const state = await json(await get(t.owner, t.id));
  await json(
    await post(t.owner, {
      action: 'recommendRoles',
      projectId: t.id,
      revision: state.revision,
    }),
    201,
  );
  return json(await get(t.owner, t.id));
}
function applyBody(t, state, delivery = 0) {
  return {
    action: 'applyRoles',
    projectId: t.id,
    revision: state.revision,
    proposalId: state.proposal.id,
    approved: true,
    assignments: [
      { role: 'ai', person: 0 },
      { role: 'frontend', person: 1 },
      { role: 'delivery', person: delivery },
    ],
  };
}

test('인증·교차 출처·잘못된 입력을 차단하고 계정별 이력서를 분리한다', async () => {
  assert.equal((await get(null)).status, 401);
  assert.equal((await post(null, profileBody())).status, 401);
  const badOrigin = new Request('https://test.local/api/career', {
    method: 'POST',
    headers: { ...headers('cross'), origin: 'https://other.local' },
    body: '{}',
  });
  assert.equal((await api.POST(badOrigin)).status, 403);
  assert.equal(
    (await post('invalid', profileBody({ learningGoals: ['invented'] })))
      .status,
    400,
  );
  await profile('private-owner', {
    resumeText:
      'Python API를 구현했습니다.\nPRIVATE_RESUME_MARKER\n팀과 테스트를 수행했습니다.',
  });
  const other = await json(await get('private-other'));
  assert.equal(other.profile, null);
  assert.equal(JSON.stringify(other).includes('PRIVATE_RESUME_MARKER'), false);
});
test('프로필 수정은 불변 버전을 남기고 오래된 편집을 거절한다', async () => {
  const a = await profile('versions');
  await profile('versions', { version: 1, resumeName: '새 버전' });
  assert.equal(
    (await post('versions', profileBody({ version: 1 }))).status,
    409,
  );
  assert.equal((await json(await get('versions'))).profile.version, 2);
  assert.equal(
    (
      await db.one(
        'SELECT count(*) AS n FROM career_profile_versions WHERE user_id=?',
        'versions',
      )
    ).n,
    2,
  );
  assert.equal(
    (await db.one('SELECT input FROM career_profile_versions WHERE id=?', a.id))
      .input.resumeName,
    '개발 이력서',
  );
});
test('부정·계획을 수행 경험으로 올리지 않고 공고 근거 부족과 미경험을 구분한다', async () => {
  const input = api.profileInput(
    profileBody({
      resumeText:
        'Python으로 API를 구현했습니다.\nDocker 경험이 없습니다.\nReact를 배울 예정입니다.\nGitHub 사용법을 학습했습니다.',
    }),
  );
  const analysis = api.basicAnalysis(input);
  assert.ok(analysis.skills.some((s) => s.skillId === 'python'));
  assert.ok(
    !analysis.skills.some((s) => ['docker', 'react'].includes(s.skillId)),
  );
  const p = await profile('gaps');
  const state = await json(await get('gaps'));
  assert.equal(
    state.gaps.find((s) => s.skillId === 'docker').status,
    'no_experience',
  );
  assert.equal(
    state.gaps.find((s) => s.skillId === 'deploy').status,
    'not_found',
  );
  assert.ok(p.analysis.skills.every((s) => p.resumeText.includes(s.quote)));
  assert.ok(state.recommendations.some((r) => r.growth.includes('docker')));
});
test('AI 분석은 동의·서버 설정·정확한 원문 인용이 필요하다', async () => {
  assert.equal(
    (await post('ai-consent', profileBody({ mode: 'ai' }))).status,
    400,
  );
  assert.equal(
    (await post('ai-consent', profileBody({ mode: 'ai', consent: true })))
      .status,
    503,
  );
  const input = api.profileInput(profileBody());
  assert.throws(
    () =>
      api.validateAnalysis(
        {
          summary: '분석',
          skills: [
            {
              skillId: 'docker',
              level: 'applied',
              quote: 'Docker 배포를 완료했습니다.',
            },
          ],
          requirements: [],
          questions: [],
        },
        input,
      ),
    /원문/,
  );
});
test('실제 모델 어댑터의 구조화 출력·개인정보 오류 처리·실패 시 할당량 복구', async () => {
  const original = globalThis.fetch;
  process.env.OPENAI_API_KEY = 'synthetic-test-key';
  try {
    let captured;
    globalThis.fetch = async (url, init) => {
      assert.equal(url, 'https://api.openai.com/v1/responses');
      captured = JSON.parse(init.body);
      return Response.json({
        status: 'completed',
        output: [
          {
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  summary: 'Python 구현 근거가 있습니다.',
                  skills: [
                    {
                      skillId: 'python',
                      level: 'applied',
                      quote: 'Python과 FastAPI로 문서 검색 API를 구현했습니다.',
                    },
                  ],
                  requirements: [],
                  questions: [],
                }),
              },
            ],
          },
        ],
      });
    };
    await profile('live-stub', { mode: 'ai', consent: true });
    assert.equal(captured.store, false);
    assert.equal(captured.text.format.strict, true);
    assert.equal(
      (await json(await get('live-stub'))).profile.analysis.mode,
      'ai',
    );
    globalThis.fetch = async () =>
      new Response('SECRET_PROVIDER_DETAIL', { status: 500 });
    const failed = await post(
      'live-fail',
      profileBody({ mode: 'ai', consent: true }),
    );
    assert.equal(failed.status, 502);
    assert.doesNotMatch(await failed.text(), /SECRET_PROVIDER/);
    assert.equal(
      (
        await db.one(
          'SELECT n FROM career_ai_quota WHERE user_id=?',
          'live-fail',
        )
      ).n,
      0,
    );
    assert.equal((await json(await get('live-fail'))).profile, null);
  } finally {
    globalThis.fetch = original;
    delete process.env.OPENAI_API_KEY;
  }
});
test('프로젝트 생성 재시도는 같은 프로젝트를 반환하고 최신 솔로 시작 규칙을 따른다', async () => {
  const p = await profile('creation');
  const b = {
    action: 'createProject',
    templateId: 'search-api',
    profileId: p.id,
    requestId: 'same-request-id-123',
    agreed: true,
  };
  const [r1, r2] = await Promise.all([
    post('creation', b),
    post('creation', b),
  ]);
  const a = await json(r1, 201),
    c = await json(r2, 201);
  assert.equal(a.projectId, c.projectId);
  const state = await json(await get('creation', a.projectId));
  assert.equal(state.lifecycle, 'draft');
  assert.equal(state.tasks.length, 0);
  assert.equal(
    (
      await db.one(
        'SELECT duration_days FROM project_policy WHERE project_id=?',
        a.projectId,
      )
    ).duration_days,
    7,
  );
  const start = await send(api.sprintPOST, 'creation', {
    action: 'start',
    projectId: a.projectId,
    revision: state.revision,
  });
  assert.equal(start.status, 200);
  const started = await json(start);
  assert.equal(started.lifecycle, 'active');
});
test('개인 원문은 팀에 노출하지 않으며 타인의 프로필 공유를 거절한다', async () => {
  const t = await team('sharing');
  const state = await json(await get(t.mate, t.id));
  assert.equal((await get('outsider', t.id)).status, 403);
  assert.equal(JSON.stringify(state).includes(t.a.resumeText), false);
  assert.ok(!JSON.stringify(state).includes('resumeText'));
  assert.ok(!JSON.stringify(state).includes('targetPosting'));
  assert.equal(
    (
      await post(t.mate, {
        action: 'share',
        projectId: t.id,
        revision: state.revision,
        profileId: t.a.id,
        skillIds: ['python'],
      })
    ).status,
    409,
  );
});
test('역할 추천은 팀 전체를 배분하고 미공유 팀원 경험을 추정하지 않는다', () => {
  const p = api.recommendRoles(api.TEMPLATES[0], [
    {
      userId: 'a',
      person: 0,
      name: 'A',
      profileId: 'p1',
      skills: [
        { skillId: 'python', level: 'applied' },
        { skillId: 'rag', level: 'applied' },
      ],
      preferredRoles: ['ai'],
      learningGoals: ['docker'],
      currentHours: 0,
    },
    {
      userId: 'b',
      person: 1,
      name: 'B',
      profileId: 'p2',
      skills: [
        { skillId: 'react', level: 'applied' },
        { skillId: 'docker', level: 'applied' },
      ],
      preferredRoles: ['frontend'],
      learningGoals: [],
      currentHours: 0,
    },
    {
      userId: 'c',
      person: 2,
      name: 'C',
      profileId: null,
      skills: [],
      preferredRoles: [],
      learningGoals: [],
      currentHours: 0,
    },
  ]);
  assert.equal(p.assignments.find((a) => a.role === 'ai').person, 0);
  assert.equal(p.assignments.find((a) => a.role === 'frontend').person, 1);
  assert.ok(!p.assignments.some((a) => a.person === 2));
  assert.ok(p.warnings.some((w) => w.includes('C:')));
  const blank = api.recommendRoles(api.TEMPLATES[0], []);
  assert.ok(blank.assignments.every((a) => a.person === null));
});
test('역할안을 검토·반영하면 실제 업무와 의존관계가 생기고 권한은 변하지 않는다', async () => {
  const t = await team('apply');
  const s = await proposal(t);
  const b = applyBody(t, s);
  assert.equal((await post(t.mate, b)).status, 403);
  assert.equal((await post(t.owner, { ...b, approved: false })).status, 400);
  await json(await post(t.owner, b));
  const after = await json(await get(t.owner, t.id));
  assert.equal(after.tasks.length, t.state.template.tasks.length);
  assert.ok(after.tasks.every((v) => v.workRole && v.skills.length));
  assert.ok(
    (
      await db.one(
        'SELECT count(*) AS n FROM sprint_dependencies WHERE owner=?',
        t.id,
      )
    ).n > 0,
  );
  assert.equal(
    (
      await db.one(
        'SELECT role FROM project_members WHERE project_id=? AND user_id=?',
        t.id,
        t.mate,
      )
    ).role,
    'member',
  );
  assert.equal((await post(t.owner, b)).status, 409);
  assert.equal(
    (await db.one('SELECT count(*) AS n FROM sprint_tasks WHERE owner=?', t.id))
      .n,
    after.tasks.length,
  );
  await db.run(
    "UPDATE sprint_tasks SET touched_at='2026-01-01T00:00:00Z' WHERE owner=?",
    t.id,
  );
  const next = await proposal(t);
  await json(await post(t.owner, applyBody(t, next, 1)));
  assert.equal(
    (await db.one('SELECT count(*) AS n FROM sprint_tasks WHERE owner=?', t.id))
      .n,
    after.tasks.length,
  );
  // 담당자가 바뀐 업무는 마지막 변경 시각도 갱신된다(멈춘 업무 표시, 2026-11-14).
  assert.ok(
    (
      await db.one(
        "SELECT count(*) AS n FROM sprint_tasks WHERE owner=? AND touched_at > '2026-06-01'",
        t.id,
      )
    ).n > 0,
  );
});
test('공유 철회는 오래된 추천 근거를 숨기고 그 역할안의 반영을 차단한다', async () => {
  const t = await team('revoke');
  const s = await proposal(t);
  await json(
    await post(t.mate, {
      action: 'unshare',
      projectId: t.id,
      revision: s.revision,
    }),
  );
  const current = await json(await get(t.owner, t.id));
  assert.equal(current.staleProposal, true);
  assert.equal(current.proposal, null);
  assert.equal(current.members.find((m) => m.person === 1).profileId, null);
  assert.equal((await post(t.owner, applyBody(t, s))).status, 409);
  assert.equal(
    (await db.one('SELECT count(*) AS n FROM sprint_tasks WHERE owner=?', t.id))
      .n,
    0,
  );
});
test('저장 직전 팀장 권한·참여가 바뀌면 역할안·업무를 부분 반영하지 않는다', async () => {
  const t = await team('race');
  const s = await proposal(t);
  globalThis.__BEFORE_WRITE = () =>
    db.run(
      'UPDATE project_members SET left_at=now() WHERE project_id=? AND user_id=?',
      t.id,
      t.owner,
    );
  const result = await post(t.owner, applyBody(t, s));
  assert.equal(result.status, 409);
  assert.equal(
    (await db.one('SELECT count(*) AS n FROM sprint_tasks WHERE owner=?', t.id))
      .n,
    0,
  );
  assert.equal(
    (
      await db.one(
        'SELECT status FROM career_role_proposals WHERE id=?',
        s.proposal.id,
      )
    ).status,
    'pending',
  );
});
test('개인 기여를 가져오면 목표 비교가 갱신되고 재개·담당 변경 후에는 현재 근거에서 제외한다', async () => {
  const t = await team('loop');
  const s = await proposal(t);
  await json(await post(t.owner, applyBody(t, s, 0)));
  let state = await json(await get(t.owner, t.id));
  const task = state.tasks.find(
    (v) => v.skills.length === 1 && v.skills.includes('docker'),
  );
  // Complete through the existing, authorized PHS workflow (not a direct test-only write).
  await json(
    await send(api.sprintPOST, t.owner, {
      action: 'task',
      projectId: t.id,
      revision: state.revision,
      taskId: task.id,
      done: true,
      evidence: 'Dockerfile과 실행 명령을 작성하고 다른 팀원이 재현했습니다.',
    }),
  );
  state = await json(await get(t.owner, t.id));
  const completed = state.myCompletedTasks.find((v) => v.id === task.id);
  // 마이페이지: 프로젝트를 고르지 않아도 가져올 수 있는 내 업무가 보인다. 담당이 아니면 안 보인다.
  const waiting = (await json(await get(t.owner))).pending.find(
    (p) => p.projectId === t.id && p.taskId === task.id,
  );
  assert.equal(waiting.taskVersion, completed.changeVersion);
  assert.equal(waiting.title, task.title);
  assert.ok(waiting.projectTitle);
  assert.deepEqual(waiting.skills, ['docker']);
  assert.match(waiting.evidence, /Dockerfile/);
  assert.equal(
    (await json(await get(t.mate))).pending.some((p) => p.taskId === task.id && p.projectId === t.id),
    false,
  );
  // 근거 글자 수는 저장 검사(recordExperience)와 같은 기준으로 센다: 이모지 3개(UTF-16 6자)도 보인다.
  const emojiTask = state.tasks.find((v) => v.id !== task.id && v.person === state.me.person && v.skills.length);
  if (emojiTask) {
    await json(
      await send(api.sprintPOST, t.owner, {
        action: 'task',
        projectId: t.id,
        revision: (await json(await get(t.owner, t.id))).revision,
        taskId: emojiTask.id,
        done: true,
        evidence: '😀😀😀',
      }),
    );
    assert.ok(
      (await json(await get(t.owner))).pending.some((p) => p.projectId === t.id && p.taskId === emojiTask.id),
      '저장할 수 있는 업무는 목록에도 나온다',
    );
  } else assert.fail('이모지 근거를 확인할 내 다른 업무가 필요하다');
  const record = {
    action: 'recordExperience',
    projectId: t.id,
    taskId: task.id,
    taskVersion: completed.changeVersion,
    skillIds: ['docker'],
    contribution: 'Dockerfile과 컨테이너 실행 구성을 직접 작성했습니다.',
    confirmed: true,
  };
  assert.equal((await post(t.mate, record)).status, 403);
  assert.equal(
    (await post(t.owner, { ...record, skillIds: ['react'] })).status,
    400,
  );
  await json(await post(t.owner, record));
  await json(await post(t.owner, record));
  const personal = await json(await get(t.owner));
  assert.equal(personal.experiences.length, 1);
  assert.equal(personal.experiences[0].project_title, waiting.projectTitle);
  assert.equal(
    personal.pending.some((p) => p.projectId === t.id && p.taskId === task.id),
    false,
    '이미 가져온 업무는 다시 나오지 않는다',
  );
  assert.equal(
    personal.beforeGaps.find((g) => g.skillId === 'docker').status,
    'no_experience',
  );
  assert.equal(
    personal.gaps.find((g) => g.skillId === 'docker').status,
    'matched',
  );
  assert.ok(
    personal.experiences[0].resume_bullet.includes(record.contribution),
  );
  const followup = await json(
    await post(t.owner, {
      action: 'createProject',
      templateId: 'search-api',
      profileId: t.a.id,
      requestId: crypto.randomUUID(),
      agreed: true,
    }),
    201,
  );
  let next = await json(await get(t.owner, followup.projectId));
  await json(
    await post(t.owner, {
      action: 'share',
      projectId: followup.projectId,
      revision: next.revision,
      profileId: t.a.id,
      skillIds: ['docker'],
    }),
  );
  next = await proposal({ ...t, id: followup.projectId });
  assert.ok(next.members[0].skills.some((s) => s.skillId === 'docker'));
  assert.equal(
    JSON.stringify(next).includes(personal.experiences[0].id),
    false,
    '다른 프로젝트 경험의 식별자나 내용은 팀 응답에 노출하지 않는다',
  );
  state = await json(await get(t.owner, t.id));
  await json(
    await send(api.sprintPOST, t.owner, {
      action: 'task',
      projectId: t.id,
      revision: state.revision,
      taskId: task.id,
      done: false,
      remaining: 2,
    }),
  );
  const reopened = await json(await get(t.owner));
  assert.equal(reopened.experiences[0].valid, false);
  assert.equal(
    reopened.gaps.find((g) => g.skillId === 'docker').status,
    'no_experience',
  );
  const followupAfter = await json(await get(t.owner, followup.projectId));
  assert.equal(followupAfter.members[0].skills.length, 0);
  assert.equal(followupAfter.proposal, null);
  assert.equal(followupAfter.staleProposal, true);
  const pending = {
    ...applyBody({ ...t, id: followup.projectId }, next),
    assignments: next.proposal.payload.assignments.map((a) => ({
      role: a.role,
      person: 0,
    })),
  };
  assert.equal((await post(t.owner, pending)).status, 409);
  assert.equal(
    (
      await db.one(
        'SELECT count(*) AS n FROM sprint_tasks WHERE owner=?',
        followup.projectId,
      )
    ).n,
    0,
  );
});

test('PDF 글꼴 경계에 공백을 추가하지 않고 원래 공백과 줄바꿈을 보존한다', () => {
  const items = [
    '모델',
    '과 대시보드는',
    ' ',
    '팀',
    '원이',
    ' ',
    '구',
    '현했습니다.',
  ].map((str) => ({ str, hasEOL: false }));
  items.at(-1).hasEOL = true;
  assert.equal(
    api.pdfPageText([{ type: 'beginMarkedContent' }, ...items]),
    '모델과 대시보드는 팀원이 구현했습니다.\n',
  );
  assert.equal(
    api.pdfPageText([{ str: 'Python ' }, { str: 'API', hasEOL: true }]),
    'Python API\n',
  );
});

test('지원 제목, 프로필 링크와 팀원 구현을 본인의 수행 근거로 올리지 않는다', () => {
  const analysis = api.basicAnalysis(
    api.profileInput(
      profileBody({
        resumeText: [
          'AI 개발 인턴(머신러닝 엔지니어) 지원',
          'https://github.com/example-person',
          '대시보드는 팀원이 구현했습니다.',
          '날짜별 파일을 팀원이 담',
          '당한 데이터 시각화에 전달했습니다.',
          '저는 기능 기획과 실행 확인을 맡았습니다.',
          '프로젝트 적용 기술: Python, SQLite, RAG',
        ].join('\n'),
      }),
    ),
  );
  assert.ok(
    !analysis.skills.some((s) =>
      ['ml', 'visualization', 'git'].includes(s.skillId),
    ),
  );
  assert.equal(
    analysis.skills.find((s) => s.skillId === 'planning').level,
    'applied',
  );
  assert.equal(
    analysis.skills.find((s) => s.skillId === 'python').level,
    'mentioned',
  );
});

test('AI 작성 코드의 수행 범위는 확인 대상으로 남기고 독립 수행과 학습은 구별한다', () => {
  const analyze = (resumeText) =>
    api.basicAnalysis(api.profileInput(profileBody({ resumeText })));
  const assisted = analyze(
    '본인 담당 코드는 AI가 작성했습니다.\nPython으로 검색 기능을 구현했습니다.\n저는 기능 기획을 맡았습니다.',
  );
  assert.equal(
    assisted.skills.find((s) => s.skillId === 'python').level,
    'mentioned',
  );
  assert.equal(
    assisted.skills.find((s) => s.skillId === 'planning').level,
    'applied',
  );
  assert.match(assisted.questions[0], /AI가 작성한 코드/);
  const own = analyze(
    'Python으로 검색 기능을 구현했습니다.\nGit 브랜치 사용법을 학습했습니다.',
  );
  assert.equal(own.skills.find((s) => s.skillId === 'python').level, 'applied');
  assert.equal(own.skills.find((s) => s.skillId === 'git').level, 'learning');
});

test('공고의 자격 요건과 우대사항을 구분하고 회사 소개를 필수 요건으로 만들지 않는다', () => {
  const analysis = api.basicAnalysis(
    api.profileInput(
      profileBody({
        targetPosting: [
          'RAG와 Docker를 사용하는 회사입니다.',
          '주요업무',
          'AWS 배포',
          '자격요건',
          'Python 구현 경험',
          'Git 브랜치 협업',
          '우대사항',
          'RAG 경험',
          'LLM 출력 평가 자동화',
          '혜택 및 복지',
          'React 교육 제공',
        ].join('\n'),
      }),
    ),
  );
  assert.deepEqual(
    analysis.requirements.map((r) => [r.skillId, r.importance]),
    [
      ['python', 'required'],
      ['git', 'required'],
      ['rag', 'preferred'],
      ['evaluation', 'preferred'],
    ],
  );
});

test('근거 수정은 새 버전을 보존하고 공고 비교와 추천에 반영하며 AI 한도를 쓰지 않는다', async () => {
  const before = await profile('review-valid', {
    resumeText:
      'Python 검색 기능을 실행하고 오류 현상을 확인했습니다.\nRAG 기술을 활용하는 프로젝트에 참여했습니다.',
    targetPosting: 'Python 경험 필수\nRAG 우대',
    noExperience: [],
    learningGoals: [],
  });
  const beforeState = await json(await get('review-valid'));
  assert.equal(
    beforeState.gaps.find((g) => g.skillId === 'python').status,
    'partial',
  );
  const changed = before.analysis.skills.map((s) =>
    s.skillId === 'python' ? { ...s, level: 'learning' } : s,
  );
  const saved = await json(
    await post('review-valid', {
      action: 'reviewProfile',
      version: 1,
      skills: changed,
      requirements: before.analysis.requirements,
    }),
  );
  assert.equal(saved.profile.version, 2);
  assert.ok(saved.profile.analysis.reviewedAt);
  assert.ok(
    !saved.profile.analysis.questions.some((q) => q.includes('Python')),
  );
  const afterState = await json(await get('review-valid'));
  assert.equal(
    afterState.profile.analysis.skills.find((s) => s.skillId === 'python')
      .level,
    'learning',
  );
  assert.ok(
    afterState.recommendations.some((r) => r.strengths.includes('python')),
  );
  assert.ok(
    !beforeState.recommendations.some((r) => r.strengths.includes('python')),
  );
  const old = await db.one(
    'SELECT analysis FROM career_profile_versions WHERE id=?',
    before.id,
  );
  assert.equal(
    old.analysis.skills.find((s) => s.skillId === 'python').level,
    'mentioned',
  );
  assert.equal(
    (
      await db.one(
        'SELECT count(*) AS n FROM career_ai_quota WHERE user_id=?',
        'review-valid',
      )
    ).n,
    0,
  );
  assert.equal((await json(await get('review-other'))).profile, null);
});

test('검토 저장은 원문 없는 근거, 중복, 다른 계정, 프로젝트 근거 위조와 오래된 버전을 거부한다', async () => {
  const p = await profile('review-invalid');
  const body = {
    action: 'reviewProfile',
    version: 1,
    skills: p.analysis.skills,
    requirements: p.analysis.requirements,
  };
  assert.equal((await post('review-stranger', body)).status, 409);
  const first = p.analysis.skills[0];
  for (const skills of [
    [{ ...first, quote: '이력서에 존재하지 않는 가짜 근거' }],
    [first, first],
    [{ ...first, source: 'project', sourceId: 'foreign-project' }],
    [{ ...first, skillId: 'unknown-skill' }],
    [{ ...first, level: 'expert' }],
  ])
    assert.equal(
      (await post('review-invalid', { ...body, skills })).status,
      400,
    );
  assert.equal(
    (
      await post('review-invalid', {
        ...body,
        requirements: [
          {
            skillId: 'python',
            quote: '공고에 없는 근거',
            importance: 'required',
          },
        ],
      })
    ).status,
    400,
  );
  // Invalid edits release their reservation, so a valid request can immediately succeed.
  await json(await post('review-invalid', body));
  assert.equal((await post('review-invalid', body)).status, 409);
  assert.equal((await json(await get('review-invalid'))).profile.version, 2);
});

test('검토 동시 저장은 하나만 확정하고 미경험이나 타인의 수행은 적용 근거로 올리지 않는다', async () => {
  const p = await profile('review-race', {
    resumeText:
      'Python 경험이 없습니다.\nRAG 기능은 팀원이 구현했습니다.\n기능 기획에 참여했습니다.',
  });
  const body = {
    action: 'reviewProfile',
    version: 1,
    skills: p.analysis.skills,
    requirements: p.analysis.requirements,
  };
  for (const quote of [
    'Python 경험이 없습니다.',
    'RAG 기능은 팀원이 구현했습니다.',
  ])
    assert.equal(
      (
        await post('review-race', {
          ...body,
          skills: [{ skillId: 'python', level: 'applied', quote }],
        })
      ).status,
      400,
    );
  const responses = await Promise.all([
    post('review-race', body),
    post('review-race', body),
  ]);
  assert.deepEqual(
    responses.map((r) => r.status).sort((a, b) => a - b),
    [200, 409],
  );
});

test('프로필 주소의 GitHub 표시는 협업 근거가 아니며 종료 예정 교육의 현재 학습은 보존한다', () => {
  const analysis = api.basicAnalysis(
    api.profileInput(
      profileBody({
        resumeText: [
          'GitHub github.com/example-person | 포트폴리오 example.test',
          '2026년 과정(종료 예정), 수강 중. 머신러닝 응용 학습.',
          'React 학습은 다음 달 시작할 예정입니다.',
        ].join('\n'),
      }),
    ),
  );
  assert.ok(!analysis.skills.some((s) => ['git', 'react'].includes(s.skillId)));
  assert.equal(
    analysis.skills.find((s) => s.skillId === 'ml').level,
    'learning',
  );
});

test('로컬 모델을 기본으로 선택하고 외부 키가 있어도 이력서를 로컬 서버로만 전송한다', async () => {
  const original = globalThis.fetch;
  delete process.env.CAREERFLOW_AI_PROVIDER;
  process.env.CAREERFLOW_LOCAL_MODEL = 'models/synthetic-local';
  process.env.CAREERFLOW_LOCAL_URL = 'http://127.0.0.1:8089';
  process.env.OPENAI_API_KEY = 'must-not-be-transmitted';
  try {
    let calls = 0;
    globalThis.fetch = async (url, init) => {
      calls++;
      assert.equal(url, 'http://127.0.0.1:8089/v1/chat/completions');
      assert.equal(init.headers.Authorization, undefined);
      assert.equal(init.redirect, 'error');
      const body = JSON.parse(init.body);
      assert.equal(body.model, 'models/synthetic-local');
      assert.ok(body.messages[1].content.includes('Python'));
      const isPosting = !('resume' in JSON.parse(body.messages[1].content));
      return Response.json({
        choices: [
          {
            finish_reason: 'stop',
            message: {
              content: JSON.stringify({
                summary: isPosting
                  ? '공고를 지원자의 경력으로 오인한 요약'
                  : '직접 구현한 근거입니다.',
                skills: isPosting
                  ? [
                      {
                        skillId: 'docker',
                        level: 'applied',
                        startLine: 999,
                        endLine: 999,
                      },
                    ]
                  : [
                      {
                        skillId: 'python',
                        level: 'applied',
                        startLine: 1,
                        endLine: 1,
                      },
                    ],
                requirements: isPosting
                  ? [
                      {
                        skillId: 'python',
                        importance: 'required',
                        startLine: 1,
                        endLine: 1,
                      },
                    ]
                  : [],
                questions: [],
              }),
            },
          },
        ],
      });
    };
    const result = await profile('local-success', {
      mode: 'ai',
      consent: false,
    });
    assert.equal(result.analysis.engine.provider, 'local');
    assert.equal(result.analysis.engine.model, 'synthetic-local');
    assert.equal(calls, 2);
    assert.equal(result.analysis.requirements[0].skillId, 'python');
    assert.deepEqual(
      result.analysis.skills.map((s) => s.skillId),
      ['python'],
    );
    assert.doesNotMatch(result.analysis.summary, /공고를 지원자/);
    const state = await json(await get('local-success'));
    assert.equal(state.ai.provider, 'local');
    assert.equal(state.ai.configured, true);
    assert.doesNotMatch(JSON.stringify(state), /must-not-be-transmitted/);
  } finally {
    globalThis.fetch = original;
    process.env.CAREERFLOW_AI_PROVIDER = 'openai';
    delete process.env.CAREERFLOW_LOCAL_MODEL;
    delete process.env.CAREERFLOW_LOCAL_URL;
    delete process.env.OPENAI_API_KEY;
  }
});

test('로컬 모델의 외부 주소, 잘린 출력, 가짜 근거와 연결 실패는 저장하지 않고 외부로 재시도하지 않는다', async () => {
  const original = globalThis.fetch;
  process.env.CAREERFLOW_AI_PROVIDER = 'local';
  process.env.CAREERFLOW_LOCAL_MODEL = 'models/synthetic-local';
  process.env.OPENAI_API_KEY = 'unused-external-key';
  try {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      throw new Error('PRIVATE_LOCAL_DETAILS');
    };
    for (const url of [
      'https://example.test',
      'http://localhost:8089',
      'http://127.0.0.1:8089/remote',
      'http://127.0.0.1:8089/?key=secret',
    ]) {
      process.env.CAREERFLOW_LOCAL_URL = url;
      assert.equal(
        (
          await post(
            'bad-local-address',
            profileBody({ mode: 'ai', consent: true }),
          )
        ).status,
        503,
      );
    }
    assert.equal(calls, 0);
    process.env.CAREERFLOW_LOCAL_URL = 'http://127.0.0.1:8089';
    let failure = await post('local-connect-fail', profileBody({ mode: 'ai' }));
    assert.equal(failure.status, 502);
    assert.doesNotMatch(await failure.text(), /PRIVATE_LOCAL_DETAILS/);
    assert.equal(calls, 1);
    assert.equal((await json(await get('local-connect-fail'))).profile, null);
    assert.equal(
      (
        await db.one(
          'SELECT n FROM career_ai_quota WHERE user_id=?',
          'local-connect-fail',
        )
      ).n,
      0,
    );
    for (const [id, finish, content] of [
      ['local-truncated', 'length', '{}'],
      ['local-invalid-json', 'stop', 'not JSON'],
      [
        'local-fake-quote',
        'stop',
        JSON.stringify({
          summary: '가짜 근거',
          skills: [
            {
              skillId: 'python',
              level: 'applied',
              startLine: 999,
              endLine: 999,
            },
          ],
          requirements: [],
          questions: [],
        }),
      ],
    ]) {
      globalThis.fetch = async () => {
        calls++;
        return Response.json({
          choices: [{ finish_reason: finish, message: { content } }],
        });
      };
      const countBefore = calls;
      failure = await post(id, profileBody({ mode: 'ai' }));
      assert.equal(failure.status, 502);
      assert.equal(calls, countBefore + 1);
      assert.equal((await json(await get(id))).profile, null);
    }
  } finally {
    globalThis.fetch = original;
    process.env.CAREERFLOW_AI_PROVIDER = 'openai';
    delete process.env.CAREERFLOW_LOCAL_MODEL;
    delete process.env.CAREERFLOW_LOCAL_URL;
    delete process.env.OPENAI_API_KEY;
  }
});

test('로컬 모델이 선택한 줄 범위는 원문 그대로 복원하고 잘못된 범위를 거부한다', () => {
  const input = api.profileInput(
    profileBody({
      resumeText:
        'Python으로 검색 기능을 구현했습니다.\n\n원문을 확인하며\n테스트를 작성했습니다.',
    }),
  );
  const raw = {
    summary: '원문 범위 검사',
    skills: [
      { skillId: 'testing', level: 'applied', startLine: 2, endLine: 3 },
    ],
    requirements: [],
    questions: [],
  };
  assert.equal(
    api.resolveLocalEvidence(raw, input).skills[0].quote,
    '원문을 확인하며\n테스트를 작성했습니다.',
  );
  for (const [startLine, endLine] of [
    [0, 1],
    [2, 1],
    [1, 9],
    ['1', 1],
    [1.1, 2],
  ])
    assert.throws(
      () =>
        api.resolveLocalEvidence(
          { ...raw, skills: [{ ...raw.skills[0], startLine, endLine }] },
          input,
        ),
      /원문 범위/,
    );
  const long = '가'.repeat(500);
  const lines = api.sourceLines(long);
  assert.equal(lines.length, 3);
  assert.equal(lines.map((s) => s.text).join(''), long);
  assert.deepEqual(api.sourceLines('\n\n'), []);
});
