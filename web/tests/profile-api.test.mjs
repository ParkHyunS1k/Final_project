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
const { one, rows, run, exec } = await setupTestDb();
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
      "export { readPublicProfile } from './lib/profile-store';",
      "export { GET as cardGET } from './app/u/[handle]/card/route';",
    ].join(' '),
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  // 이미지 생성 모듈은 404 경로에서 불러오지 않는다(동적 import).
  external: ['next/og'],
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

test('공개 프로필: 꺼졌거나 없는 아이디는 null, 완주·참여 중인 프로젝트와 확인한 업무만, 팀원 정보 없음', async () => {
  const solo = await soloWithExperiences('pub');
  const team = await gradedTeam('pub', ['mate1', 'mate2'], '함께 만든 서비스');
  const leftTeam = await gradedTeam('pub', ['mate1', 'mate2'], '중간에 나온 팀');
  await run("UPDATE project_members SET left_at=now() WHERE project_id=? AND user_id='pub'", leftTeam);
  const running = await call(api.projectsPOST, 'pub', '/api/projects', {
    action: 'create', title: '진행 중 프로젝트', goal: '진행한다', scope: '범위', completionCriteria: '기준', duration: 7, agreed: true,
  }, 201);
  await act('pub', running.projectId, 'start');
  // 경험 하나는 업무 근거가 바뀌어 '재확인 필요'가 된다.
  const [kept, stale] = solo.experiences;
  await run('UPDATE sprint_tasks SET evidence=? WHERE owner=? AND id=?', '바뀐 근거입니다', solo.projectId, stale.task_id);

  assert.equal(await api.readPublicProfile('nobody'), null);
  const saved = await save('pub', { version: 0, handle: 'pub-user', displayName: '공개하는 사람', enabled: false, shownEvidence: [kept.id] });
  assert.equal(await api.readPublicProfile('pub-user'), null, '꺼져 있으면 열리지 않는다');
  await save('pub', { ...saved.settings, enabled: true });
  assert.equal((await cron()).status, 200);

  const profile = await api.readPublicProfile('pub-user');
  assert.equal(profile.displayName, '공개하는 사람');
  const byId = (x, y) => x.localeCompare(y);
  assert.deepEqual(profile.projects.map((p) => p.id).sort(byId), [solo.projectId, team].sort(byId));
  const teamRow = profile.projects.find((p) => p.id === team);
  assert.equal(teamRow.members, 3);
  assert.equal(teamRow.role, 'owner');
  assert.equal(teamRow.grade, 'A');
  assert.equal(profile.projects.find((p) => p.id === solo.projectId).role, 'solo');
  assert.equal(profile.finished, 2);
  assert.deepEqual(profile.experiences.map((e) => e.id), [kept.id]);
  assert.match(profile.experiences[0].evidence, /근거/);
  assert.ok(profile.badges.some((b) => b.id === 'finish' && b.count === 2));
  // 숫자는 마이페이지와 같은 저장값.
  const mine = await call(api.meGET, 'pub', '/api/score/me');
  assert.deepEqual(profile.standing, mine.profile);
  // 팀원 이름·식별자는 어디에도 없다.
  const json = JSON.stringify(profile);
  for (const leak of ['첫째팀원', '둘째팀원', 'mate1', 'mate2', 'pub@test.local']) assert.doesNotMatch(json, new RegExp(leak));

  // 숨긴 프로젝트, 근거를 끈 경험.
  const now = await settings('pub');
  await save('pub', { ...now.settings, hiddenProjects: [solo.projectId], shownEvidence: [] });
  const hidden = await api.readPublicProfile('pub-user');
  assert.deepEqual(hidden.projects.map((p) => p.id), [team]);
  assert.equal(hidden.experiences[0].evidence, null);
});

test('카드 이미지: 꺼졌거나 없는 아이디는 404', async () => {
  const card = (handle) =>
    api.cardGET(new Request('https://test.local/u/' + handle + '/card'), { params: Promise.resolve({ handle }) });
  assert.equal((await card('nobody')).status, 404);
  const off = await save('cardoff', { version: 0, handle: 'card-off', displayName: '꺼진 사람', enabled: false });
  assert.equal(off.settings.enabled, false);
  const res = await card('card-off');
  assert.equal(res.status, 404);
  assert.equal(res.headers.get('cache-control'), 'no-store');
});

test('리뷰: 일괄 계산이 중간에 실패하면 아무 점수도 바뀌지 않는다', async () => {
  await gradedTeam('batch1', ['batch2', 'batch3'], '일괄 계산 팀');
  assert.equal((await cron()).status, 200);
  const before = await rows('SELECT user_id, computed_at FROM profile_scores ORDER BY user_id');
  const last = before.at(-1).user_id;
  // 첫 쓰기 직전에 마지막 사용자의 저장만 실패하게 만든다.
  globalThis.__BEFORE_WRITE_SQL = 'INSERT INTO profile_scores';
  globalThis.__BEFORE_WRITE = () => exec(`ALTER TABLE profile_scores ADD CONSTRAINT fail_last CHECK (user_id <> '${last}') NOT VALID`);
  try {
    assert.equal((await cron()).status, 503);
  } finally {
    await exec('ALTER TABLE profile_scores DROP CONSTRAINT IF EXISTS fail_last');
  }
  const after = await rows('SELECT user_id, computed_at FROM profile_scores ORDER BY user_id');
  assert.deepEqual(after.map((r) => +r.computed_at), before.map((r) => +r.computed_at));
});

test('리뷰: 같은 version 동시 저장에서 진 요청은 기록을 남기지 않는다', async () => {
  const RealDate = Date;
  const T = RealDate.parse('2026-11-17T10:00:00.000Z');
  // 두 요청이 같은 밀리초에 저장하는 상황을 만든다.
  globalThis.Date = class extends RealDate {
    constructor(...a) {
      super(...(a.length ? a : [T]));
    }
    static now() {
      return T;
    }
  };
  try {
    globalThis.__BEFORE_WRITE_SQL = 'public_profiles';
    globalThis.__BEFORE_WRITE = () => save('racer', { version: 0, handle: 'racer-b', displayName: '경쟁 B' });
    const lost = await save('racer', { version: 0, handle: 'racer-a', displayName: '경쟁 A' }, 409);
    assert.match(lost.error, /다른 곳에서 바뀌었어요/);
  } finally {
    globalThis.Date = RealDate;
  }
  const events = await rows("SELECT detail FROM public_profile_events WHERE user_id='racer'");
  assert.equal(events.length, 1);
  assert.equal(events[0].detail.after.handle, 'racer-b');
});

test('리뷰: 다른 사람이 같은 아이디를 먼저 저장하면 503이 아니라 409', async () => {
  globalThis.__BEFORE_WRITE_SQL = 'public_profiles';
  globalThis.__BEFORE_WRITE = () =>
    run("INSERT INTO public_profiles(user_id,handle,display_name,updated_at) VALUES('sniper','same-id','먼저',now())");
  const res = await save('slow', { version: 0, handle: 'same-id', displayName: '늦게' }, 409);
  assert.match(res.error, /이미 쓰는 아이디/);
});

test('리뷰: 기록에는 바뀐 항목의 전후 값이 남는다(근거 공개 포함)', async () => {
  const { experiences } = await soloWithExperiences('auditor');
  const a = await save('auditor', { version: 0, handle: 'auditor', displayName: '기록' });
  await save('auditor', { ...a.settings, shownEvidence: [experiences[0].id] });
  const last = await one("SELECT action, detail FROM public_profile_events WHERE user_id='auditor' ORDER BY created_at DESC, id DESC LIMIT 1");
  assert.equal(last.action, 'update');
  assert.deepEqual(last.detail.before, { shownEvidence: [] });
  assert.deepEqual(last.detail.after, { shownEvidence: [experiences[0].id] });
  assert.equal(last.detail.version, 2);
});

test('리뷰: 이상한 주소(%)는 오류 없이 404, cron은 Bearer 형식만', async () => {
  const card = await api.cardGET(new Request('https://test.local/u/%25/card'), { params: Promise.resolve({ handle: '%' }) });
  assert.equal(card.status, 404);
  const plain = await api.cronGET(new Request('https://test.local/api/internal/profile-scores', { headers: { authorization: 'test-cron' } }));
  assert.equal(plain.status, 401);
});

test('일괄 계산 v2: 완주·평가·쉰 기간이 저장 점수에 반영된다', async () => {
  const projectId = await gradedTeam('v2lead', ['v2mate1', 'v2mate2'], 'v2 점수 팀');
  const score = async () => one("SELECT score::float AS score, grade, formula_version FROM profile_scores WHERE user_id='v2lead'");
  assert.equal((await cron()).status, 200);
  // 평가 4.5 → (4.5+3.5)/2*0.7 + 완주율 100%*1.5 + 0.05 = 4.35
  assert.deepEqual(await score(), { score: 4.4, grade: 'A', formula_version: 'v2' });
  // 400일 전에 끝난 것으로 옮기면 휴식 감점 최대 1.0.
  await run("UPDATE project_policy SET completed_at=now() - interval '400 days' WHERE project_id=?", projectId);
  assert.equal((await cron()).status, 200);
  assert.deepEqual(await score(), { score: 3.4, grade: 'B', formula_version: 'v2' });
  // 새 프로젝트를 시작하면 감점이 사라진다.
  const next = await call(api.projectsPOST, 'v2lead', '/api/projects', {
    action: 'create', title: '다시 시작', goal: '진행한다', scope: '범위', completionCriteria: '기준', duration: 7, agreed: true,
  }, 201);
  await act('v2lead', next.projectId, 'start');
  assert.equal((await cron()).status, 200);
  assert.equal((await score()).score, 4.4);
});
