// 공개 프로필 설정 API와 공개 프로필 데이터. 근거: docs/superpowers/specs/2026-11-17-profile-share-design.md
import { test } from 'node:test';
process.env.AUTH_DEV_HEADERS = '1';
process.env.SANCTION_FROM = '2000-01-01T00:00:00Z';
process.env.CRON_SECRET = 'test-cron';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/pg-db.mjs';
import { build } from 'esbuild';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const { one, run } = await setupTestDb();
const outfile = join(mkdtempSync(join(tmpdir(), 'projectmate-profile-test-')), 'route.mjs');
await build({
  stdin: {
    contents: [
      "export { GET as sprintGET, POST as sprintPOST } from './app/api/sprint/route';",
      "export { POST as projectsPOST } from './app/api/projects/route';",
      "export { POST as scorePOST } from './app/api/score/route';",
      "export { GET as meGET } from './app/api/score/me/route';",
      "export { POST as hubPOST } from './app/api/hub/route';",
      "export { GET as careerGET, POST as careerPOST } from './app/api/career/route';",
      "export { GET as cronGET } from './app/api/internal/profile-scores/route';",
      "export { GET as profileGET, POST as profilePOST } from './app/api/profile/route';",
    ].join(' '),
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  plugins: [
    {
      name: 'test-db',
      setup(b) {
        b.onResolve({ filter: /^\.\/db$/ }, () => ({ path: 'db', namespace: 'test' }));
        b.onLoad({ filter: /.*/, namespace: 'test' }, () => ({
          contents: 'export function database(){return globalThis.__TEST_DB}',
          loader: 'js',
        }));
      },
    },
  ],
});
const api = await import(pathToFileURL(outfile).href);

const H = 3600000;
const NAMES = { lead: '리드팀장', mate1: '첫째팀원', mate2: '둘째팀원' };
const headers = (user, extra = {}) => ({
  'oai-authenticated-user-id': user,
  'oai-authenticated-user-email': user + '@test.local',
  'oai-authenticated-user-full-name': encodeURIComponent(NAMES[user] ?? user),
  'oai-authenticated-user-full-name-encoding': 'percent-encoded-utf-8',
  'content-type': 'application/json',
  origin: 'https://test.local',
  ...extra,
});
async function call(fn, user, path, body, status = 200) {
  const r = await fn(
    new Request('https://test.local' + path, {
      method: body ? 'POST' : 'GET',
      headers: headers(user),
      body: body ? JSON.stringify(body) : undefined,
    }),
  );
  assert.equal(r.status, status, path + ' ' + (await r.clone().text()));
  return r.json();
}
const sprint = async (user, id) => (await call(api.sprintGET, user, '/api/sprint?project=' + id)).sprint;
async function act(user, id, action, fields = {}) {
  const s = await call(api.sprintGET, user, '/api/sprint?project=' + id);
  return call(api.sprintPOST, user, '/api/sprint', { action, projectId: id, revision: s.sprint.revision, ...fields });
}
const cron = () =>
  api.cronGET(new Request('https://test.local/api/internal/profile-scores', { headers: { authorization: 'Bearer test-cron' } }));
const settings = (user) => call(api.profileGET, user, '/api/profile');
const save = (user, body, status = 200) => call(api.profilePOST, user, '/api/profile', { action: 'save', ...body }, status);

/** 혼자 템플릿 프로젝트를 완주하고 업무 두 개를 경험으로 가져온다. */
async function soloWithExperiences(user) {
  const { projectId } = await call(api.hubPOST, user, '/api/hub', {
    action: 'createTemplate', templateId: 'portfolio-story', scopeLevel: 1, mode: 'solo', listed: false, agreed: true, requestId: crypto.randomUUID(),
  }, 201);
  await act(user, projectId, 'start');
  for (const t of (await sprint(user, projectId)).tasks)
    await act(user, projectId, 'task', { taskId: t.id, done: true, evidence: `${t.title} 근거: 비공개 저장소 링크 private-repo` });
  await act(user, projectId, 'finish');
  const pending = (await call(api.careerGET, user, '/api/career')).pending.filter((p) => p.projectId === projectId);
  for (const p of pending.slice(0, 2))
    await call(api.careerPOST, user, '/api/career', {
      action: 'recordExperience', projectId, taskId: p.taskId, taskVersion: p.taskVersion,
      skillIds: [p.skills[0]], contribution: `${p.title} 부분을 직접 만들었습니다.`, confirmed: true,
    });
  const experiences = (await call(api.careerGET, user, '/api/career')).experiences.filter((e) => e.project_id === projectId);
  return { projectId, experiences };
}

/** 팀장 + 팀원 2명이 완주하고 서로 평가해 결과를 공개한다. 하나는 숨김 후보, 하나는 참여 중단 후보로 쓴다. */
async function gradedTeam(lead, mates, title) {
  const created = await call(api.projectsPOST, lead, '/api/projects', {
    action: 'create', title, goal: '함께 완주한다', scope: '핵심 흐름', completionCriteria: '시연한다', duration: 7, agreed: true,
  }, 201);
  const projectId = created.projectId;
  for (const mate of mates) {
    const s = await call(api.sprintGET, lead, '/api/sprint?project=' + projectId);
    const { token } = await call(api.projectsPOST, lead, '/api/projects', { action: 'invite', projectId, revision: s.sprint.revision, email: mate + '@test.local' }, 201);
    await call(api.projectsPOST, mate, '/api/projects', { action: 'accept', token, agreed: true, goalVersion: s.policy.goalVersion });
  }
  await act(lead, projectId, 'start');
  await act(lead, projectId, 'deliverableEvidence', { deliverableId: 'd_criteria', evidence: '시연 영상과 저장소로 확인했습니다.' });
  await act(lead, projectId, 'deliverableConfirm', { deliverableId: 'd_criteria', confirmed: true });
  await act(lead, projectId, 'finish');
  const everyone = [lead, ...mates];
  for (const [i, user] of everyone.entries()) {
    const reviews = everyone.map((_, p) => p).filter((p) => p !== i).map((person) => ({ person, contribution: 4.5, communication: 4.5, commitment: 4.5 }));
    await call(api.scorePOST, user, '/api/score', { action: 'review', projectId, reviews });
  }
  return projectId;
}

test('아이디는 정리해 저장하고 형식·예약어·중복을 거절한다', async () => {
  const first = await settings('harin');
  assert.equal(first.settings, null);
  assert.equal(first.defaults.displayName, 'harin');
  const saved = await save('harin', { version: 0, handle: '  Harin ', displayName: '하린', enabled: false });
  assert.equal(saved.settings.handle, 'harin');
  assert.equal(saved.settings.enabled, false);
  for (const handle of ['ab', '한글이름', 'admin', 'a'.repeat(21), 'has space'])
    await save('other1', { version: 0, handle, displayName: '다른 사람' }, 400);
  const taken = await save('other1', { version: 0, handle: 'HARIN', displayName: '다른 사람' }, 409);
  assert.match(taken.error, /이미 쓰는 아이디/);
  await save('other1', { version: 0, handle: 'other-1', displayName: '' }, 400);
});

test('같은 version으로 두 번 저장하면 두 번째는 409, 기록이 남는다', async () => {
  const a = await save('dup', { version: 0, handle: 'dup-user', displayName: '중복' });
  await save('dup', { version: 0, handle: 'dup-user', displayName: '중복' }, 409);
  const b = await save('dup', { version: a.settings.version, handle: 'dup-user', displayName: '중복', enabled: true });
  await save('dup', { version: b.settings.version, handle: 'dup-two', displayName: '중복', enabled: true });
  const { a: log } = await one("SELECT string_agg(action, ',' ORDER BY created_at, id) AS a FROM public_profile_events WHERE user_id='dup'");
  assert.deepEqual(log.split(',').sort(), ['create', 'enable', 'handle']);
});

test('숨김 목록은 내 것만 남기고, GitHub은 연결했을 때만 보이게 저장된다', async () => {
  const mine = await soloWithExperiences('owner');
  const theirs = await soloWithExperiences('stranger');
  const s = await settings('owner');
  assert.ok(s.projects.some((p) => p.id === mine.projectId));
  assert.equal(s.experiences.length, 2);
  const saved = await save('owner', {
    version: 0, handle: 'owner', displayName: '주인',
    hiddenProjects: [mine.projectId, theirs.projectId, 'p_none'],
    hiddenExperiences: [mine.experiences[0].id, theirs.experiences[0].id],
    shownEvidence: [mine.experiences[1].id, theirs.experiences[1].id],
    showGithub: true,
  });
  assert.deepEqual(saved.settings.hiddenProjects, [mine.projectId]);
  assert.deepEqual(saved.settings.hiddenExperiences, [mine.experiences[0].id]);
  assert.deepEqual(saved.settings.shownEvidence, [mine.experiences[1].id]);
  assert.equal(saved.settings.showGithub, false);
  await run("INSERT INTO github_accounts(user_id,github_id,login,linked_at,updated_at) VALUES('owner','g-1','owner-gh',now(),now())");
  const linked = await save('owner', { ...saved.settings, version: saved.settings.version, showGithub: true });
  assert.equal(linked.settings.showGithub, true);
  assert.equal((await settings('owner')).github, 'owner-gh');
});

test('로그인하지 않으면 401, 다른 Origin이면 403', async () => {
  const anon = await api.profileGET(new Request('https://test.local/api/profile'));
  assert.equal(anon.status, 401);
  const evil = await api.profilePOST(
    new Request('https://test.local/api/profile', {
      method: 'POST',
      headers: headers('harin', { origin: 'https://evil.local' }),
      body: JSON.stringify({ action: 'save', version: 1, handle: 'harin', displayName: '하린' }),
    }),
  );
  assert.equal(evil.status, 403);
});
