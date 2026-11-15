// AI 변경안 화면 정리(2026-11-16): 원문 넣기 → 검토 → 반영. 검토는 종류별로 묶고 값은 칩, 근거는 접기, 바뀌는 값은 diff.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';

const cache = join(process.cwd(), 'node_modules', '.cache');
mkdirSync(cache, { recursive: true });
async function load(entry) {
  const outfile = join(mkdtempSync(join(cache, 'pm-flow-')), 'out.mjs');
  await build({ entryPoints: [entry], outfile, bundle: true, platform: 'node', format: 'esm', jsx: 'automatic', packages: 'external', alias: { '@': process.cwd() } });
  return import(pathToFileURL(outfile).href);
}
const { ProposalReview, proposalSummary } = await load('components/change-review.tsx');
const { SourceList } = await load('components/source-paste.tsx');
const text = (html) => html.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

const change = (over) => ({
  changeId: 'c1',
  kind: 'createTask',
  taskId: null,
  newKey: 'n1',
  before: {},
  after: { title: '문서 수집', person: 1, remaining: 6, dueAt: null },
  evidence: { start: 0, end: 5, quote: '문서 20장 수집' },
  basis: 'fact',
  needsReview: '',
  requires: 'owner',
  blocked: '',
  ...over,
});
const changes = [
  change({}),
  change({ changeId: 'c2', newKey: 'n2', basis: 'estimate', evidence: null, after: { title: '체인 통합', person: null, remaining: 8, remainingEstimated: true, dueAt: null } }),
  change({ changeId: 'c3', kind: 'remaining', taskId: 3, newKey: null, before: { remaining: 4 }, after: { remaining: 6 }, requires: 'assignee' }),
  change({ changeId: 'c4', kind: 'dueAt', taskId: 5, newKey: null, basis: 'estimate', before: { dueAt: null }, after: { dueAt: '2026-11-15T03:00:00.000Z' }, blocked: '이미 지난 마감' }),
];
const tasks = [
  { id: 3, title: '검색 결과 정렬 개선', person: 0, remaining: 4, dependsOn: [], done: false },
  { id: 5, title: 'README 실행 방법 정리', person: 0, remaining: 1, dependsOn: [], done: false },
];
const members = [
  { person: 0, display_name: '박현식', left_at: null },
  { person: 1, display_name: '토지차', left_at: null },
];

test('요약 계산: 원문 사실·AI 추정 수, 선택한 새 업무·바뀌는 업무 수, 남은 공수 변화(편집 반영)', () => {
  assert.deepEqual(proposalSummary(changes, { c1: true, c3: true }, {}), {
    total: 4,
    fact: 2,
    estimate: 2,
    selected: 2,
    created: 1,
    changed: 1,
    hours: 8,
  });
  // 사용자가 공수를 고치면 그 값으로 센다.
  assert.equal(proposalSummary(changes, { c1: true }, { c1: { remaining: 3 } }).hours, 3);
});

test('검토 화면: 종류별 묶음, 바뀌는 값은 취소선→새 값, AI 추정 값 표시, 막힌 항목은 흐리고 못 고름, 근거는 접기, 반영 버튼 하나', () => {
  const html = renderToString(
    createElement(ProposalReview, {
      proposal: { id: 'p1', sourceId: 's1', baseRevision: 3, model: 'm', promptVersion: 'v', status: 'ready', error: '', createdAt: '', changes },
      tasks,
      members,
      selected: { c1: true, c3: true },
      edits: {},
      stale: false,
      busy: false,
      writable: true,
      onToggle: () => {},
      onEdit: () => {},
      onApply: () => {},
      onReanalyze: () => {},
    }),
  );
  const t = text(html);
  assert.match(t, /AI가 4건을 제안했어요/);
  assert.match(t, /원문 사실 2 · AI 추정 2/);
  assert.match(t, /새 업무 2/);
  assert.match(t, /바뀌는 업무 2/);
  assert.match(html, /<del>4시간<\/del>[\s\S]*?<ins>6시간<\/ins>/);
  assert.match(html, /class="ai-chip is-estimated"/);
  assert.match(html, /class="ai-item is-blocked"[\s\S]*?이미 지난 마감/);
  assert.match(html, /<details class="ai-why">[\s\S]*?문서 20장 수집/);
  assert.match(t, /선택 2건 · 새 업무 1 · 바뀌는 업무 1 · 남은 공수 \+8h/);
  assert.equal((html.match(/class="btn primary/g) ?? []).length, 1);
  assert.match(t, /선택한 2건 반영/);
});

test('원문 목록: 날짜가 아니라 첫 줄 내용, 종류(GitHub 이슈), 반영 수, 수정본 표시', () => {
  const html = renderToString(
    createElement(SourceList, {
      selected: 's2',
      onSelect: () => {},
      sources: [
        { id: 's1', authorId: 'u', origin: 'GitHub team/app 이슈', capturedAt: null, hash: 'h', supersedes: null, createdAt: '2026-11-14T12:02:00.000Z', size: 1180, preview: '[GitHub 이슈 #12] 로그인 화면', applied: 4 },
        { id: 's2', authorId: 'u', origin: '', capturedAt: null, hash: 'h2', supersedes: 's0', createdAt: '2026-11-09T11:45:00.000Z', size: 2316, preview: '회의록 11/9 검색 범위', applied: 0 },
      ],
    }),
  );
  const t = text(html);
  assert.match(t, /\[GitHub 이슈 #12\] 로그인 화면/);
  assert.match(t, /GitHub 이슈/);
  assert.match(t, /반영 4건/);
  assert.match(t, /회의록 11\/9 검색 범위/);
  assert.match(t, /수정본/);
  assert.match(html, /aria-current="true"[^>]*>[\s\S]*?회의록 11\/9/);
});

test('개발용 재생 화면은 사용자 화면에 없다', () => {
  const source = readFileSync('components/change-review.tsx', 'utf8');
  assert.ok(!source.includes('저장된 실제 AI 응답 재생'));
  assert.ok(!source.includes('보기 모드'));
});
