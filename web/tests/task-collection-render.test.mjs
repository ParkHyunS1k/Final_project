import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';

// 업무 목록은 보드가 기본이고, 카드에 담당자와 마감(또는 예상 완료)이 보인다.
const cache = join(process.cwd(), 'node_modules', '.cache');
mkdirSync(cache, { recursive: true });
const outfile = join(mkdtempSync(join(cache, 'pm-tasks-')), 'task-collection.mjs');
await build({
  entryPoints: ['components/task-collection.tsx'],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  jsx: 'automatic',
  packages: 'external',
  alias: { '@': process.cwd() },
});
const { TaskCollection } = await import(pathToFileURL(outfile).href);

const task = (id, over) => ({
  id,
  title: '업무 ' + id,
  person: 0,
  remaining: 2,
  dependsOn: [],
  done: false,
  status: 'todo',
  ...over,
});
function render() {
  return renderToString(
    createElement(TaskCollection, {
      sprint: {
        revision: 1,
        finished: false,
        people: [{ name: '도윤', role: '팀장', initial: '도', color: '#eee' }],
        tasks: [
          task(1, { dueAt: '2026-11-10T03:00:00.000Z' }),
          task(2, { status: 'in_progress', dependsOn: [1] }),
          task(3, { done: true, status: 'done' }),
        ],
      },
      plan: { finishes: { 2: '2026-11-11T01:00:00.000Z' }, unscheduled: [] },
      asOf: '2026-11-09T00:00:00.000Z',
      me: { person: 0, role: 'owner', agreedAt: '2026-11-08T00:00:00.000Z' },
      members: [{ person: 0, display_name: '도윤' }],
      checkins: [],
      busy: false,
      error: '',
      mine: false,
      mutate: async () => true,
      onEdit: () => {},
      onAdd: () => {},
    }),
  );
}

test('업무 목록은 보드가 먼저 열리고 세 열에 카드가 나뉜다', () => {
  const html = render();
  assert.match(html, /class="task-board"/);
  assert.doesNotMatch(html, /<table/);
  for (const label of ['시작 전', '진행 중', '완료'])
    assert.match(html, new RegExp(`aria-label="${label}"`));
  assert.equal((html.match(/class="board-card(?: is-blocked)?"/g) ?? []).length, 3);
});

test('보드 카드에 담당자·마감·예상 완료·선행 작업이 보인다', () => {
  const html = render();
  assert.match(html, /도윤/);
  assert.match(html, /마감 11-10 12:00/);
  assert.match(html, /예상 완료 11-11 10:00/);
  assert.match(html, /선행 (<!-- -->)?1/);
});

// 2026-11-14 PR 연결: 카드에 업무 번호와 PR 상태, 상세 패널에 브랜치 이름과 제안.
const { PrPanel } = await import(pathToFileURL(outfile).href);
const pull = (number, state) => ({ number, title: `PR ${number}`, state, branch: `pm-1-x`, author: 'alice', url: `https://github.com/t/a/pull/${number}` });

test('보드 카드에 업무 번호와 연결된 PR 상태가 보인다', () => {
  const html = renderToString(
    createElement(TaskCollection, {
      sprint: { revision: 1, finished: false, people: [{ name: '도윤' }], tasks: [task(1, { title: 'Login 화면' })] },
      plan: { finishes: {}, unscheduled: [] },
      asOf: '2026-11-09T00:00:00.000Z',
      me: { person: 0, role: 'owner', agreedAt: '2026-11-08T00:00:00.000Z' },
      members: [{ person: 0, display_name: '도윤' }],
      checkins: [],
      busy: false,
      error: '',
      mine: false,
      mutate: async () => true,
      onEdit: () => {},
      onAdd: () => {},
      pulls: { 1: [pull(10, 'merged')] },
    }),
  );
  assert.match(html, /PM-1/);
  assert.match(html, /#(<!-- -->)?10/);
  assert.match(html, /머지됨/);
});

test('PR 패널: 브랜치 이름 복사, 열린 PR이면 진행 중 제안, 모두 머지면 완료 제안', () => {
  const t = { id: 1, title: 'Login 화면', done: false, status: 'todo' };
  const start = renderToString(createElement(PrPanel, { task: t, pulls: [pull(10, 'open')], canEdit: true, onStart: () => {}, onUseEvidence: () => {} }));
  assert.match(start, /pm-1-login/);
  assert.match(start, /진행 중으로 바꿀까요/);
  const ok = { 10: { number: 10, checks: 'success', review: 'none', commits: [] } };
  const done = renderToString(
    createElement(PrPanel, { task: { ...t, status: 'in_progress' }, pulls: [pull(10, 'merged')], details: ok, canEdit: true, onStart: () => {}, onUseEvidence: () => {} }),
  );
  assert.match(done, /머지됐어요/);
  assert.doesNotMatch(done, /진행 중으로 바꿀까요/);
  const waiting = renderToString(
    createElement(PrPanel, { task: { ...t, status: 'in_progress' }, pulls: [pull(10, 'merged'), pull(11, 'open')], canEdit: true, onStart: () => {}, onUseEvidence: () => {} }),
  );
  assert.doesNotMatch(waiting, /머지됐어요/);
  const none = renderToString(createElement(PrPanel, { task: t, pulls: [], canEdit: true, onStart: () => {}, onUseEvidence: () => {} }));
  assert.match(none, /연결된 PR이 없어요/);
});

// 2026-11-14 개발 현황: 멈춘 업무 배지, CI·리뷰·최근 커밋, CI 실패면 완료 대신 확인 필요.
test('진행 중인데 12시간 넘게 활동이 없으면 보드 카드에 멈춤 배지가 보인다', () => {
  const props = (touchedAt) => ({
    sprint: {
      revision: 1,
      finished: false,
      people: [{ name: '도윤' }],
      tasks: [task(1, { status: 'in_progress', touchedAt })],
    },
    plan: { finishes: {}, unscheduled: [] },
    asOf: '2026-11-14T13:00:00.000Z',
    me: { person: 0, role: 'owner', agreedAt: '2026-11-08T00:00:00.000Z' },
    members: [{ person: 0, display_name: '도윤' }],
    checkins: [],
    busy: false,
    error: '',
    mine: false,
    mutate: async () => true,
    onEdit: () => {},
    onAdd: () => {},
    pulls: {},
  });
  assert.match(renderToString(createElement(TaskCollection, props('2026-11-14T00:00:00.000Z'))), /멈춤 (<!-- -->)?13시간/);
  assert.match(renderToString(createElement(TaskCollection, props('2026-11-12T00:00:00.000Z'))), /멈춤 (<!-- -->)?2일/);
  assert.doesNotMatch(renderToString(createElement(TaskCollection, props('2026-11-14T02:00:00.000Z'))), /멈춤/);
});

test('개발 현황 패널: PR마다 CI·리뷰·최근 커밋, 머지된 PR의 CI가 실패면 완료 제안 대신 확인 필요', () => {
  const t = { id: 1, title: 'Login', done: false, status: 'in_progress' };
  const details = {
    10: {
      number: 10,
      checks: 'failure',
      review: 'approved',
      commits: [{ sha: 'a'.repeat(40), message: '로그인 폼 추가', author: 'alice', date: '2026-11-14T01:00:00Z' }],
    },
  };
  const html = renderToString(
    createElement(PrPanel, { task: t, pulls: [pull(10, 'merged')], details, canEdit: true, onStart: () => {}, onUseEvidence: () => {} }),
  );
  assert.match(html, /CI 실패/);
  assert.match(html, /승인/);
  assert.match(html, /로그인 폼 추가/);
  assert.match(html, /확인이 필요해요/);
  assert.doesNotMatch(html, /완료 근거로 채우기/);
  const passed = renderToString(
    createElement(PrPanel, {
      task: t,
      pulls: [pull(10, 'merged')],
      details: { 10: { ...details[10], checks: 'success', review: 'changes_requested' } },
      canEdit: true,
      onStart: () => {},
      onUseEvidence: () => {},
    }),
  );
  assert.match(passed, /CI 통과/);
  assert.match(passed, /수정 요청/);
  assert.match(passed, /완료 근거로 채우기/);
  const stalled = renderToString(
    createElement(PrPanel, { task: t, pulls: [], stalled: 15, canEdit: true, onStart: () => {}, onUseEvidence: () => {} }),
  );
  assert.match(stalled, /15시간째 활동이 없어요/);
});

test('개발 현황 요약의 마지막 활동은 멈춤과 같은 기준(업무 변경·PR 수정 중 최근)이다', () => {
  const html = renderToString(
    createElement(PrPanel, {
      task: { id: 1, title: 'Login', done: false, status: 'in_progress', touchedAt: '2026-11-14T11:00:00.000Z' },
      pulls: [{ ...pull(10, 'merged'), updatedAt: '2026-11-13T16:00:00.000Z' }],
      asOf: '2026-11-14T12:00:00.000Z',
      canEdit: true,
      onStart: () => {},
      onUseEvidence: () => {},
    }),
  );
  assert.match(html, /마지막 활동/);
  assert.match(html, /<b>1시간 전<\/b>/);
});

test('개발 현황 요약: 일부 PR만 확인했으면 몇 개 기준인지 밝힌다', () => {
  const d = (number) => ({ number, checks: 'success', review: 'none', commits: [] });
  const html = renderToString(
    createElement(PrPanel, {
      task: { id: 1, title: 'Login', done: false, status: 'in_progress' },
      pulls: [pull(1, 'merged'), pull(2, 'merged'), pull(3, 'merged'), pull(4, 'merged')],
      details: { 1: d(1), 2: d(2), 3: d(3) },
      canEdit: true,
      onStart: () => {},
      onUseEvidence: () => {},
    }),
  );
  assert.match(html, /3\/4개 기준/);
});

test('완료 제안은 CI를 확인한 뒤에만: 확인 중이거나 다시 읽기에 실패하면 띄우지 않는다', () => {
  const t = { id: 1, title: 'Login', done: false, status: 'in_progress' };
  const base = { task: t, pulls: [pull(10, 'merged')], canEdit: true, onStart: () => {}, onUseEvidence: () => {} };
  const waiting = renderToString(createElement(PrPanel, base));
  assert.doesNotMatch(waiting, /완료 근거로 채우기/);
  assert.match(waiting, /불러오는 중/);
  const failed = renderToString(createElement(PrPanel, { ...base, detailError: 'GitHub 호출 한도에 걸렸습니다.' }));
  assert.doesNotMatch(failed, /완료 근거로 채우기/);
  assert.match(failed, /호출 한도/);
});

// 2026-11-15 출처 이슈: 패널에 업무가 나온 GitHub 이슈와 지금 상태(닫힘·가져온 뒤 바뀜·없어짐)를 보인다.
test('개발 현황: 출처 이슈 링크와 닫힘·변경·없어짐 표시, 이슈가 닫혔는데 업무가 남았으면 알린다', () => {
  const t = { id: 1, title: 'Login 화면', done: false, status: 'in_progress' };
  const base = { task: t, pulls: [], canEdit: true, onStart: () => {}, onUseEvidence: () => {} };
  const links = [{ repo: 'team/app', number: 3 }, { repo: 'team/app', number: 4 }, { repo: 'team/app', number: 5 }];
  const st = (number, over) => ({ repo: 'team/app', number, title: `이슈 제목 ${number}`, url: `https://github.com/team/app/issues/${number}`, state: 'open', reason: null, changed: false, ...over });
  const loading = renderToString(createElement(PrPanel, { ...base, issues: links }));
  assert.match(loading, /출처 이슈/);
  assert.match(loading, /href="https:\/\/github.com\/team\/app\/issues\/3"/);
  assert.match(loading, /불러오는 중/);
  const html = renderToString(
    createElement(PrPanel, {
      ...base,
      issues: links,
      issueStatus: [st(3, { state: 'closed', reason: 'completed' }), st(4, { changed: true }), st(5, { state: 'missing', title: '' })],
    }),
  );
  assert.match(html, /이슈 제목 3/);
  assert.match(html, /완료로 닫힘/);
  assert.match(html, /가져온 뒤 바뀜/);
  assert.match(html, /찾을 수 없음/);
  assert.match(html, /GitHub에서 닫힌 이슈가 있어요: #3/);
  const done = renderToString(
    createElement(PrPanel, { ...base, task: { ...t, done: true, status: 'done' }, issues: links.slice(0, 1), issueStatus: [st(3, { state: 'closed', reason: 'completed' })] }),
  );
  assert.doesNotMatch(done, /닫힌 이슈가 있어요/);
  const failed = renderToString(createElement(PrPanel, { ...base, issues: links.slice(0, 1), issueError: '이슈 상태를 불러오지 못했어요.' }));
  assert.match(failed, /이슈 상태를 불러오지 못했어요/);
  assert.doesNotMatch(failed, /불러오는 중/);
  assert.doesNotMatch(renderToString(createElement(PrPanel, base)), /출처 이슈/);
});

test('개발 현황: 상태를 받았는데 빠진 출처 이슈(업무당 3개 초과)는 불러오는 중이 아니라 확인 안 함', () => {
  const t = { id: 1, title: 'Login 화면', done: false, status: 'in_progress' };
  const links = [3, 4, 5, 6].map((number) => ({ repo: 'team/app', number }));
  const st = (number) => ({ repo: 'team/app', number, title: `이슈 ${number}`, url: '', state: 'open', reason: null, changed: false });
  const html = renderToString(
    createElement(PrPanel, { task: t, pulls: [], canEdit: true, onStart: () => {}, onUseEvidence: () => {}, issues: links, issueStatus: [st(3), st(4), st(5)] }),
  );
  assert.doesNotMatch(html, /불러오는 중/);
  assert.match(html, /확인 안 함/);
});

test('업무 상세 체크인 이력에 그 업무의 막힌 점이 함께 보인다', async () => {
  const { CheckinHistory } = await import(pathToFileURL(outfile).href);
  const html = renderToString(
    createElement(CheckinHistory, {
      taskId: 1,
      checkins: [
        { id: 'c1', task_id: 1, note: '스키마 초안', remaining: 2, created_at: '2026-11-08T03:00:00.000Z', blocker: '토큰 만료 규칙 미정' },
        { id: 'c2', task_id: 2, note: '다른 업무', remaining: 1, created_at: '2026-11-08T03:00:00.000Z' },
      ],
    }),
  );
  assert.match(html, /스키마 초안/);
  assert.match(html, /막힌 점 · 토큰 만료 규칙 미정/);
  assert.doesNotMatch(html, /다른 업무/);
  assert.match(renderToString(createElement(CheckinHistory, { taskId: 3, checkins: [] })), /체크인이 없습니다/);
});
