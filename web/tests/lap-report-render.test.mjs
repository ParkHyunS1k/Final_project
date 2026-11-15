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

const task = (id, title, remaining) => ({ id, title, person: 1, remaining, dependsOn: [], done: false, status: 'in_progress' });
const tasks = [task(4, '대조표 정리', 5), task(2, '문서 수집', 4), task(7, '체인 통합', 1.5)];
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

test('보낼 항목: 진행은 남은 시간, 막힘은 막힌 점 포함, 완료는 근거만', () => {
  assert.deepEqual(
    reportItems({ 4: row({ remaining: 3 }), 2: row({ status: 'blocked', remaining: 4, blocker: '표가 깨짐' }), 7: row({ status: 'done', evidence: 'PR #12' }) }, tasks),
    [
      { taskId: 4, remaining: 3 },
      { taskId: 2, remaining: 4, blocker: '표가 깨짐' },
      { taskId: 7, done: true, evidence: 'PR #12' },
    ],
  );
});

test('저장 막는 이유: 오늘 한 일 없음, 막힘인데 내용 없음, 완료인데 근거 5자 미만', () => {
  const ok = { 4: row(), 2: row(), 7: row() };
  assert.equal(blockReason(ok, tasks, '진행'), null);
  assert.match(blockReason(ok, tasks, ' '), /오늘 한 일/);
  assert.match(blockReason({ ...ok, 2: row({ status: 'blocked' }) }, tasks, '진행'), /문서 수집.*막힌 점/);
  assert.match(blockReason({ ...ok, 7: row({ status: 'done', evidence: 'pr' }) }, tasks, '진행'), /체인 통합.*근거/);
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
