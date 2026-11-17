import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';

// 마이페이지(요약·활동·경험·설정)를 서버 렌더링해 보이는 내용을 확인한다.
const cache = join(process.cwd(), 'node_modules', '.cache');
mkdirSync(cache, { recursive: true });
const outfile = join(mkdtempSync(join(cache, 'pm-mypage-')), 'my-page.mjs');
await build({
  entryPoints: ['components/my-page.tsx'],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  jsx: 'automatic',
  packages: 'external',
  alias: { '@': process.cwd() },
});
const { MySummary, ActivityPanel, SettingsPanel, ExperienceBoard, ShareSheet, PublicProfileSettings, studyCalendar, stateLabel } = await import(
  pathToFileURL(outfile).href
);
const now = new Date('2026-11-17T03:00:00Z'); // 서울 11월 17일 정오
const badge = (id, label, earned, count = earned ? 1 : 0) => ({
  id,
  label,
  description: label + ' 설명',
  earnedAt: earned ? '2026-11-08T00:00:00Z' : null,
  count,
});
const score = {
  bestGrade: 'A',
  average: 4.4,
  profile: { score: 4.4, grade: 'A', percentile: 12, total: 40, computedAt: '2026-11-16T18:00:00Z' },
  projects: 2,
  totalScore: 8.8,
  badges: [badge('finish', '7일 완주', true, 2), badge('top_communicator', '소통왕', false)],
  history: [
    { id: 'p_run', title: '매일 공부 체크인', role: 'owner', lifecycle: 'active', startedAt: '2026-11-10T03:00:00Z', deadlineAt: '2026-11-17T03:00:00Z', score: null, grade: null },
    { id: 'p_done', title: '피드백 서비스', role: 'member', lifecycle: 'completed', startedAt: '2026-11-01T03:00:00Z', deadlineAt: '2026-11-08T03:00:00Z', score: 4.4, grade: 'A' },
    { id: 'p_end', title: '팀 위키', role: 'member', lifecycle: 'expired', startedAt: '2026-10-05T03:00:00Z', deadlineAt: '2026-10-12T03:00:00Z', score: null, grade: null },
    { id: 'p_left', title: '중간에 나온 팀', role: 'member', lifecycle: 'completed', startedAt: '2026-09-01T03:00:00Z', deadlineAt: '2026-09-08T03:00:00Z', score: null, grade: null, left: true },
  ],
};

void test('학습한 날 칸: 오늘로 끝나는 12주, 공부한 날만 칠한다', () => {
  const cells = studyCalendar(['2026-11-17', '2026-11-15', '2026-08-01'], now);
  assert.equal(cells.length, 84);
  assert.deepEqual(cells.at(-1), { date: '2026-11-17', on: true });
  assert.deepEqual(cells.at(-2), { date: '2026-11-16', on: false });
  assert.equal(cells.at(-3).on, true);
  assert.equal(cells[0].date, '2026-08-26');
  assert.equal(cells.filter((c) => c.on).length, 2, '12주 밖의 날은 넣지 않는다');
});

void test('프로젝트 상태 문구: 준비·진행(DAY)·완주·기한 종료', () => {
  assert.equal(stateLabel(score.history[0], now), '진행 중 · DAY 7');
  assert.equal(stateLabel(score.history[1], now), '완주');
  assert.equal(stateLabel(score.history[2], now), '기한 종료');
  assert.equal(stateLabel({ lifecycle: 'draft', startedAt: null }, now), '준비 중');
});

void test('요약: 이름, 프로필 등급·상위 %·기준 시각, 연속 학습·학습한 날·완주·프로필 점수, 공유 버튼', () => {
  const html = renderToString(
    createElement(MySummary, { name: '지원자', target: '프론트엔드 개발', score, stats: { streak: 5, days: 23 } }),
  );
  assert.match(html, /지원자/);
  assert.match(html, /프론트엔드 개발/);
  assert.match(html, /<b>A<\/b>[\s\S]*프로필 등급/);
  assert.match(html, /상위 12%/);
  assert.match(html, /11월 17일 03:00 기준/);
  // 공유는 아이콘 버튼(이름은 aria-label).
  assert.match(html, /<button[^>]*aria-label="내 프로필 공유"[^>]*><svg/);
  assert.doesNotMatch(html, />내 프로필 공유</);
  assert.match(html, /연속 학습<\/dt><dd>5일/);
  assert.match(html, /학습한 날<\/dt><dd>23일/);
  assert.match(html, /완주한 프로젝트<\/dt><dd>1개/);
  assert.match(html, /프로필 점수 \(5점\)<\/dt><dd>4\.4/);
  assert.doesNotMatch(html, /최고 등급/);
});

void test('요약: 저장값이 없으면 E·점수 없음·새벽 계산 안내, 점수 없으면 상위 % 안내', () => {
  const html = renderToString(createElement(MySummary, { name: '새 사용자', target: '', score: null, stats: { streak: 0, days: 0 } }));
  assert.match(html, /<b>E<\/b>/);
  assert.match(html, /프로필 점수 \(5점\)<\/dt><dd>—/);
  assert.match(html, /매일 새벽에 계산돼요/);
  const unscored = renderToString(
    createElement(MySummary, { name: '새 사용자', target: '', score: { ...score, profile: { ...score.profile, score: null, grade: 'E', percentile: null } }, stats: { streak: 0, days: 0 } }),
  );
  assert.doesNotMatch(unscored, /평가를 받으면/);
  assert.doesNotMatch(unscored, /상위 \d+%/);
  assert.match(html, /완주한 프로젝트<\/dt><dd>0개/);
});

void test('활동: 프로젝트 기록(내 등급), 뱃지(받은 수), 참여 신청 대기 수, 학습한 날 칸', () => {
  const html = renderToString(
    createElement(ActivityPanel, {
      score,
      dates: ['2026-11-17'],
      pendingRequests: 2,
      jobs: 3,
      now,
      onOpenProject: () => {},
      onTeams: () => {},
      onJobs: () => {},
    }),
  );
  assert.match(html, /매일 공부 체크인[\s\S]*팀장[\s\S]*진행 중 · DAY 7/);
  assert.match(html, /피드백 서비스[\s\S]*팀원[\s\S]*완주 · A/);
  assert.match(html, /팀 위키[\s\S]*기한 종료/);
  assert.match(html, /중간에 나온 팀[\s\S]*참여 중단/);
  assert.match(html, /뱃지 1 \/ 2/);
  assert.match(html, /7일 완주[\s\S]*×2/);
  assert.match(html, /class="my-badge off"[^>]*>[\s\S]*소통왕/);
  assert.match(html, /확인 대기 2/);
  assert.match(html, /관심 공고[\s\S]*3개/);
  assert.match(html, /최근 12주 중 1일 학습/);
});

void test('활동: 불러오지 못하면 로딩이 아니라 실패와 다시 불러오기', () => {
  const html = renderToString(
    createElement(ActivityPanel, {
      score: null,
      failed: true,
      dates: [],
      pendingRequests: null,
      jobs: 0,
      now,
      onOpenProject: () => {},
      onTeams: () => {},
      onJobs: () => {},
      onRetry: () => {},
    }),
  );
  assert.match(html, /기록을 불러오지 못했어요[\s\S]*<button[^>]*>다시 불러오기<\/button>/);
  assert.doesNotMatch(html, /불러오는 중/);
  assert.doesNotMatch(html, /대기 없음/, '신청 수를 모르면 없다고 하지 않는다');
});

void test('활동: 프로젝트가 없으면 찾으러 가는 안내', () => {
  const html = renderToString(
    createElement(ActivityPanel, {
      score: { ...score, history: [] },
      dates: [],
      pendingRequests: 0,
      jobs: 0,
      now,
      onOpenProject: () => {},
      onTeams: () => {},
      onJobs: () => {},
    }),
  );
  assert.match(html, /아직 참여한 프로젝트가 없어요/);
});

void test('설정: 제한이 없으면 정상, 있으면 해제 시각과 막힌 일을 보여준다', () => {
  const ok = renderToString(createElement(SettingsPanel, { name: '지원자', restriction: null, busy: false, onSignOut: () => {} }));
  assert.match(ok, /Google 계정[\s\S]*지원자/);
  assert.match(ok, /GitHub 계정 연결/);
  assert.match(ok, /참여 제한[\s\S]*정상/);
  assert.match(ok, /화면 테마/);
  assert.match(ok, /로그아웃/);
  const blocked = renderToString(
    createElement(SettingsPanel, {
      name: '지원자',
      restriction: { until: '2026-11-24T03:00:00Z', permanent: false, misses: 1 },
      busy: false,
      onSignOut: () => {},
    }),
  );
  assert.match(blocked, /동료평가를 내지 않아 11월 24일 12:00까지 프로젝트 만들기·참여 신청·초대 수락·시작을 할 수 없습니다/);
  assert.match(blocked, /제한 중/);
  // 제한 여부를 불러오지 못하면 '정상'이라고 하지 않는다.
  const unknown = renderToString(createElement(SettingsPanel, { name: '지원자', restriction: undefined, busy: false, onSignOut: () => {} }));
  assert.doesNotMatch(unknown, /정상|제한 없음/);
  assert.match(unknown, /확인하지 못했어요/);
});

void test('경험·포트폴리오: 프로젝트 경험과 직접 추가 자료를 한 목록에, 가져올 업무는 위에, 출처 필터', () => {
  const props = {
    experiences: [
      { id: 'ce_1', project_title: '피드백 서비스', task_title: '목록 화면', resume_bullet: '피드백 서비스 프로젝트에서 목록 화면 업무를 수행했습니다.', evidence: 'PR #12 머지', valid: true, skill_ids: ['react'] },
      { id: 'ce_2', project_title: '팀 위키', task_title: '검색', resume_bullet: '검색 업무', evidence: '근거', valid: false, skill_ids: ['sql'] },
    ],
    pending: [{ projectId: 'p_done', projectTitle: '피드백 서비스', taskId: 3, taskVersion: 2, title: '입력 검증', evidence: 'PR #15 머지', skills: ['testing'] }],
    portfolios: [{ id: 'r_1', revision: 1, payload: { title: '동아리 출석 앱', url: 'https://github.com/x/y', text: '출석 앱 본문' } }],
    filter: 'all',
    busy: false,
    onFilter: () => {},
    onRecord: async () => {},
    onMerge: () => {},
    onEdit: () => {},
    onAdd: () => {},
  };
  const html = renderToString(createElement(ExperienceBoard, props));
  assert.match(html, /전체 3[\s\S]*프로젝트에서 2[\s\S]*직접 추가 1/);
  assert.match(html, /가져올 수 있는 업무 1[\s\S]*피드백 서비스[\s\S]*입력 검증/);
  assert.match(html, /본인 확인[\s\S]*목록 화면/);
  assert.match(html, /재확인 필요[\s\S]*<h3>검색/);
  assert.match(html, /동아리 출석 앱[\s\S]*이력서 분석에 합치기/);
  assert.doesNotMatch(html, /아직 수행하지 않습니다/);
  const mine = renderToString(createElement(ExperienceBoard, { ...props, filter: 'portfolio' }));
  assert.doesNotMatch(mine, /목록 화면/);
  assert.match(mine, /동아리 출석 앱/);
  const empty = renderToString(createElement(ExperienceBoard, { ...props, experiences: [], pending: [], portfolios: [] }));
  assert.match(empty, /프로젝트를 끝내고 완료 근거를 남기면/);
});

void test('공유 시트: 꺼져 있으면 설정으로 안내, 켜져 있으면 카드 미리보기·저장·링크·프로필 보기', () => {
  const off = renderToString(createElement(ShareSheet, { handle: null, enabled: false, onSettings: () => {}, onClose: () => {} }));
  assert.match(off, /공개 프로필을 켜면 공유할 수 있어요/);
  assert.match(off, /<button[^>]*>설정에서 켜기<\/button>/);
  assert.doesNotMatch(off, /<img/);
  const on = renderToString(createElement(ShareSheet, { handle: 'harin', enabled: true, onSettings: () => {}, onClose: () => {} }));
  assert.match(on, /<img[^>]*src="\/u\/harin\/card"/);
  assert.match(on, /href="\/u\/harin\/card"[^>]*download[^>]*>이미지 저장|download[^>]*href="\/u\/harin\/card"[^>]*>이미지 저장/);
  assert.match(on, /<button[^>]*>링크 공유<\/button>/);
  assert.match(on, /href="\/u\/harin"[^>]*>프로필 보기/);
});

void test('공개 프로필 설정: 켜기·아이디·이름, GitHub 미연결이면 비활성, 프로젝트·업무 숨김과 근거 보이기', () => {
  const data = {
    settings: null,
    defaults: { displayName: '하린' },
    github: null,
    projects: [{ id: 'p1', title: '동네 가게 예약 페이지' }],
    experiences: [{ id: 'e1', title: '예약 API', projectTitle: '동네 가게 예약 페이지' }],
  };
  const html = renderToString(createElement(PublicProfileSettings, { data, busy: false, error: '', onSave: async () => {} }));
  assert.match(html, /공개 프로필 켜기/);
  assert.match(html, /value="하린"/);
  assert.match(html, /\/u\//);
  assert.match(html, /<input[^>]*type="checkbox"[^>]*disabled=""[^>]*>[^<]*GitHub 아이디 보이기|GitHub 아이디 보이기[\s\S]*연결된 GitHub이 없어요/);
  // GitHub 연결 카드는 이 양식 위에 있다.
  assert.match(html, /위 GitHub 카드에서 연결할 수 있어요/);
  assert.match(html, /동네 가게 예약 페이지/);
  assert.match(html, /예약 API[\s\S]*완료 근거 보이기/);
  const err = renderToString(createElement(PublicProfileSettings, { data, busy: false, error: '이미 쓰는 아이디예요.', onSave: async () => {} }));
  assert.match(err, /role="alert"[^>]*>이미 쓰는 아이디예요\./);
});
