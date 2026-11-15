// 오늘의 랩 기록(2026-11-16): 진행 보고 패널. 내 업무 전체를 한 장에, 막힌 점은 업무별, 완료는 근거와 함께.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';

const cache = join(process.cwd(), 'node_modules', '.cache');
mkdirSync(cache, { recursive: true });
const outfile = join(mkdtempSync(join(cache, 'pm-lap-')), 'lap-report.mjs');
await build({ entryPoints: ['components/lap-report.tsx'], outfile, bundle: true, platform: 'node', format: 'esm', jsx: 'automatic', packages: 'external', alias: { '@': process.cwd() } });
const { LapReportForm, quickHours, reportItems, prChips, blockReason } = await import(pathToFileURL(outfile).href);

const task = (id, title, remaining, changeVersion = 0) => ({ id, title, person: 1, remaining, dependsOn: [], done: false, status: 'in_progress', changeVersion });
const tasks = [task(4, '대조표 정리', 5, 3), task(2, '문서 수집', 4), task(7, '체인 통합', 1.5, 1)];
const row = (over = {}) => ({ status: 'progress', remaining: 1, blocker: '', evidence: '', ...over });
const pull = (number, state, updatedAt, title = 'PR ' + number) => ({ number, title, state, branch: 'pm-7-x', author: 'a', url: `https://github.com/t/a/pull/${number}`, sha: '', updatedAt });

test('남은 시간 빠른 선택: -1시간(0 아래로 안 감), 절반(0.5 단위), 거의 끝(0.5)', () => {
  assert.equal(quickHours(5, 'minus'), 4);
  assert.equal(quickHours(0.5, 'minus'), 0);
  assert.equal(quickHours(5, 'half'), 2.5);
  assert.equal(quickHours(3, 'half'), 1.5);
  assert.equal(quickHours(1, 'half'), 0.5);
  assert.equal(quickHours(4, 'almost'), 0.5);
  assert.equal(quickHours(0, 'almost'), 0);
});

test('보낼 항목: 패널을 연 시점의 업무 버전과, 진행은 남은 시간·막힘은 막힌 점·완료는 근거', () => {
  assert.deepEqual(
    reportItems({ 4: row({ remaining: 3 }), 2: row({ status: 'blocked', remaining: 4, blocker: '표가 깨짐' }), 7: row({ status: 'done', evidence: 'PR #12' }) }, tasks),
    [
      { taskId: 4, version: 3, remaining: 3 },
      { taskId: 2, version: 0, remaining: 4, blocker: '표가 깨짐' },
      { taskId: 7, version: 1, done: true, evidence: 'PR #12' },
    ],
  );
});

test('저장 막는 이유: 오늘 한 일 없음, 막힘인데 내용 없음, 완료인데 근거 5자 미만', () => {
  const ok = { 4: row(), 2: row(), 7: row() };
  assert.equal(blockReason(ok, tasks, '진행'), null);
  assert.match(blockReason(ok, tasks, ' '), /오늘 한 일/);
  assert.match(blockReason({ ...ok, 2: row({ status: 'blocked' }) }, tasks, '진행'), /문서 수집.*막힌 점/);
  assert.match(blockReason({ ...ok, 7: row({ status: 'done', evidence: 'pr' }) }, tasks, '진행'), /체인 통합.*근거/);
  // 서버 요청 크기(16,000자)를 넘기 전에 막는다.
  const long = { 4: row({ status: 'done', evidence: 'a'.repeat(2000) }), 2: row({ status: 'done', evidence: 'b'.repeat(2000) }), 7: row({ status: 'done', evidence: 'c'.repeat(2000) }) };
  const many = Array.from({ length: 6 }, (_, i) => task(100 + i, '업무' + i, 1));
  const big = { ...long, ...Object.fromEntries(many.map((t) => [t.id, row({ status: 'done', evidence: 'd'.repeat(2000) })])) };
  assert.match(blockReason(big, [...tasks, ...many], '진행'), /너무 길어요/);
});

test('GitHub 칩: 내 업무에 연결된 PR 중 오늘(KST) 움직인 것만, 번호 중복 없이', () => {
  const pulls = {
    7: [pull(12, 'merged', '2026-11-16T03:00:00.000Z', 'LCEL 체인 연결'), pull(9, 'open', '2026-11-14T03:00:00.000Z')],
    4: [pull(12, 'merged', '2026-11-16T03:00:00.000Z', 'LCEL 체인 연결')],
    99: [pull(30, 'open', '2026-11-16T03:00:00.000Z')],
  };
  assert.deepEqual(prChips(pulls, tasks, '2026-11-16T12:00:00.000Z'), [
    { number: 12, label: 'PR #12 머지 · LCEL 체인 연결', text: 'PR #12 LCEL 체인 연결 (머지됨)' },
  ]);
});

test('패널: 업무마다 줄, 막힘이면 막힌 점 칸, 완료면 근거 칸, 남은 시간 합계, 주요 버튼 하나', () => {
  const html = renderToString(
    createElement(LapReportForm, {
      tasks,
      initialRows: { 4: row({ remaining: 3 }), 2: row({ status: 'blocked', remaining: 4, blocker: '스캔 PDF' }), 7: row({ status: 'done', evidence: 'PR #12 https://github.com/t/a/pull/12' }) },
      chips: [{ number: 12, label: 'PR #12 머지 · LCEL 체인 연결', text: 'PR #12 LCEL 체인 연결 (머지됨)' }],
      busy: false,
      onSubmit: async () => true,
    }),
  );
  for (const t of tasks) assert.match(html, new RegExp(`PM-${t.id}`));
  assert.equal((html.match(/class="lap-row is-/g) ?? []).length, 3);
  assert.match(html, /class="lap-row is-blocked"[\s\S]*?막힌 점/);
  assert.match(html, /class="lap-row is-done"[\s\S]*?완료 근거/);
  assert.match(html, /PR #12 머지 · LCEL 체인 연결/);
  assert.match(html, /10\.5h → 7h/);
  assert.equal((html.match(/class="btn primary/g) ?? []).length, 1);
  const empty = renderToString(createElement(LapReportForm, { tasks: [], busy: false, onSubmit: async () => true }));
  assert.match(empty, /보고할 업무가 없어요/);
});

test('패널: 업무가 20개를 넘으면 앞의 20개만(서버 한도), 머지된 PR이 늦게 와도 근거에 넣는 버튼', () => {
  const many = Array.from({ length: 22 }, (_, i) => task(i + 1, '업무 ' + (i + 1), 1));
  const html = renderToString(createElement(LapReportForm, { tasks: many, busy: false, onSubmit: async () => true }));
  assert.equal((html.match(/class="lap-row is-/g) ?? []).length, 20);
  assert.match(html, /22개 중 20개/);
  const done = renderToString(
    createElement(LapReportForm, {
      tasks,
      initialRows: { 4: row(), 2: row(), 7: row({ status: 'done', evidence: '' }) },
      evidenceFor: (id) => (id === 7 ? 'PR #12 LCEL 체인 연결 https://github.com/t/a/pull/12' : ''),
      busy: false,
      onSubmit: async () => true,
    }),
  );
  assert.match(done, /머지된 PR 넣기/);
  assert.equal((done.match(/머지된 PR 넣기/g) ?? []).length, 1);
});
