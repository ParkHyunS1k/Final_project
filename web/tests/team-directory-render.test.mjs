import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';

// 팀 찾기 '내 신청' 목록을 서버 렌더링해 버튼 구성을 확인한다. 패키지는 node_modules에서 읽는다.
const cache = join(process.cwd(), 'node_modules', '.cache');
mkdirSync(cache, { recursive: true });
const outfile = join(mkdtempSync(join(cache, 'pm-teams-')), 'team-directory.mjs');
await build({
  entryPoints: ['components/team-directory.tsx'],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  jsx: 'automatic',
  packages: 'external',
  alias: { '@': process.cwd() },
});
const { MyRequests, TeamDirectory, TeamListing, InterestList, TeamCard, TeamPanel, visibleTeams, homeTeamAction, agreementFor } = await import(
  pathToFileURL(outfile).href
);
const at = '2026-10-15T03:50:00.000Z';

void test('내 신청: 대기·승인만 위 띠에 보이고, 대기는 취소, 승인은 프로젝트 열기. 지난 신청은 접어 둔다', () => {
  const html = renderToString(
    createElement(MyRequests, {
      busy: false,
      onCancel: () => {},
      requests: [
        { requestId: 'jr_1', projectId: 'p_hidden', title: '비공개로 바뀐 팀', status: 'pending', createdAt: at },
        { requestId: 'jr_2', projectId: 'p_ok', title: '승인된 팀', status: 'approved', createdAt: at },
        { requestId: 'jr_3', projectId: 'p_no', title: '거절된 팀', status: 'rejected', createdAt: at },
        { requestId: 'jr_4', projectId: 'p_old', title: '마감된 팀', status: 'expired', createdAt: at },
      ],
    }),
  );
  const [now, past] = html.split('<details');
  assert.match(now, /확인 대기[\s\S]*비공개로 바뀐 팀[\s\S]*<button[^>]*>신청 취소<\/button>/);
  assert.match(now, /승인된 팀[\s\S]*href="\/app\?tab=work&amp;project=p_ok"[^>]*>프로젝트 열기/);
  assert.doesNotMatch(now, /거절된 팀|마감된 팀/);
  assert.match(past, /지난 신청 2/);
  assert.match(past, /거절됨[\s\S]*거절된 팀/);
  assert.doesNotMatch(past, /신청 취소/);
  // 지난 신청만 있으면 띠 없이 접힌 목록만.
  const only = renderToString(
    createElement(MyRequests, { busy: false, onCancel: () => {}, requests: [{ requestId: 'jr_3', projectId: 'p_no', title: '거절된 팀', status: 'rejected', createdAt: at }] }),
  );
  assert.match(only, /지난 신청 1/);
  assert.equal(renderToString(createElement(MyRequests, { busy: false, onCancel: () => {}, requests: [] })), '');
});

const team = (over = {}) => ({
  projectId: 'p_a',
  title: '스터디 출석 봇',
  goal: '디스코드 스터디 출석을 기록하고 주간 요약을 보내는 봇을 만든다.',
  scope: '출석 명령어, 주간 요약',
  completionCriteria: '실제 서버에서 7일 출석을 기록한다',
  skills: ['python', 'api'],
  lifecycle: 'active',
  goalVersion: 2,
  members: 3,
  maxMembers: 4,
  startedAt: '2026-11-16T05:00:00.000Z',
  deadlineAt: '2026-11-23T05:00:00.000Z',
  joinUntil: '2026-11-17T05:00:00.000Z',
  joinable: true,
  requested: false,
  ...over,
});
const now = Date.parse('2026-11-17T02:20:00.000Z'); // 시작 21시간 20분 뒤, 신청 마감 2시간 40분 전

void test('팀 카드: 상태·DAY·인원 점·기술 태그·남은 신청 시간(3시간 미만은 강조)·자세히 보고 신청', () => {
  const html = renderToString(createElement(TeamCard, { team: team(), now, busy: false, restricted: false, onOpen: () => {} }));
  assert.match(html, /진행 중 · DAY 1/);
  assert.match(html, /3\/4/);
  assert.equal(html.match(/class="seat on"/g)?.length, 3);
  assert.equal(html.match(/class="seat"/g)?.length, 1);
  assert.match(html, /Python/);
  assert.match(html, /신청 마감 2시간 40분/);
  assert.match(html, /class="team-time urgent"/);
  assert.match(html, />자세히 보고 신청</);
  assert.doesNotMatch(html, /실제 서버에서 7일/, '완료 기준 전문은 패널에서 읽는다');
  const draft = renderToString(
    createElement(TeamCard, { team: team({ lifecycle: 'draft', startedAt: null, deadlineAt: null, joinUntil: null, skills: [] }), now, busy: false, restricted: false, onOpen: () => {} }),
  );
  assert.match(draft, /준비 중/);
  assert.match(draft, /시작하면 7일/);
  assert.match(draft, /직접 만든 팀/);
  const full = renderToString(createElement(TeamCard, { team: team({ members: 4, joinable: false }), now, busy: false, restricted: false, onOpen: () => {} }));
  assert.match(full, /<button[^>]*disabled=""[^>]*>인원 마감/);
  const asked = renderToString(createElement(TeamCard, { team: team({ requested: true, joinable: false }), now, busy: false, restricted: false, onOpen: () => {} }));
  assert.match(asked, /<button[^>]*disabled=""[^>]*>신청함 · 확인 대기/);
});

void test('신청 패널: 목표 버전·기능 범위·완료 기준 전문, 확인 체크 전에는 보내기가 꺼지고, 제한 중이면 꺼진다', () => {
  const props = { team: team(), now, agreed: false, busy: false, restricted: false, onAgree: () => {}, onSubmit: () => {}, onClose: () => {} };
  const html = renderToString(createElement(TeamPanel, props));
  assert.match(html, /목표 v2/);
  assert.match(html, /출석 명령어, 주간 요약/);
  assert.match(html, /실제 서버에서 7일 출석을 기록한다/);
  assert.match(html, /<button[^>]*disabled=""[^>]*>참여 신청 보내기/);
  const ready = renderToString(createElement(TeamPanel, { ...props, agreed: true }));
  assert.doesNotMatch(ready, /<button[^>]*disabled=""[^>]*>참여 신청 보내기/);
  // 템플릿 팀은 완료 기준 문장이 없다. 빈 칸 대신 업무 완료 규칙을 알린다.
  const tmpl = renderToString(createElement(TeamPanel, { ...props, team: team({ completionCriteria: '' }) }));
  assert.match(tmpl, /모든 업무를 완료하고 근거를 남기면/);
  const blocked = renderToString(createElement(TeamPanel, { ...props, agreed: true, restricted: true }));
  assert.match(blocked, /<button[^>]*disabled=""[^>]*>참여 신청 보내기/);
});

// Codex 리뷰(2026-11-16): 확인 체크는 그 팀·그 목표 버전에만 유효하다.
void test('동의는 확인한 팀과 목표 버전에 묶여, 다른 팀이나 바뀐 목표에는 이어지지 않는다', () => {
  const key = agreementFor(team({ projectId: 'p_a', goalVersion: 2 }));
  assert.equal(key, agreementFor(team({ projectId: 'p_a', goalVersion: 2 })));
  assert.notEqual(key, agreementFor(team({ projectId: 'p_b', goalVersion: 2 })));
  assert.notEqual(key, agreementFor(team({ projectId: 'p_a', goalVersion: 3 })));
});

void test('신청 실패 이유는 열린 패널 안에서 알린다(모달 바깥은 보조기술이 읽지 못한다)', () => {
  const base = { team: team(), now, agreed: false, busy: false, restricted: false, onAgree: () => {}, onSubmit: () => {}, onClose: () => {} };
  const html = renderToString(createElement(TeamPanel, { ...base, error: '팀 목표가 바뀌었습니다.' }));
  assert.match(html, /role="alert"[^>]*>팀 목표가 바뀌었습니다\./);
  assert.doesNotMatch(renderToString(createElement(TeamPanel, base)), /role="alert"/);
});

void test('필터: 상태 칩과 자리 있는 팀만. 꽉 찼거나 신청할 수 없는 팀은 맨 뒤로', () => {
  const list = [
    team({ projectId: 'full', members: 4, joinable: false }),
    team({ projectId: 'draft', lifecycle: 'draft' }),
    team({ projectId: 'live' }),
  ];
  assert.deepEqual(visibleTeams(list, 'all', false).map((t) => t.projectId), ['draft', 'live', 'full']);
  assert.deepEqual(visibleTeams(list, 'draft', false).map((t) => t.projectId), ['draft']);
  assert.deepEqual(visibleTeams(list, 'active', true).map((t) => t.projectId), ['live']);
});

void test('홈 카드 버튼: 내 팀은 열기, 신청 창이 열렸고 자리가 있으면 신청, 아니면 마감', () => {
  assert.equal(homeTeamAction({ joined: true, join_open: false, members: 4 }), 'open');
  assert.equal(homeTeamAction({ joined: false, join_open: true, members: 2 }), 'apply');
  assert.equal(homeTeamAction({ joined: false, join_open: true, members: 4 }), 'full');
  assert.equal(homeTeamAction({ joined: false, join_open: false, members: 2 }), 'closed');
});

void test('금지 중이면 팀 찾기에 언제까지 참여 신청할 수 없는지 알린다', () => {
  const html = renderToString(
    createElement(TeamDirectory, { restriction: { until: null, permanent: true, misses: 3 } }),
  );
  assert.match(html, /3번 내지 않아 더 이상 참여 신청할 수 없습니다/);
});

void test('팀장 화면: 금지 중인 신청자는 승인 버튼이 꺼지고 안내가 붙는다', () => {
  const html = renderToString(
    createElement(TeamListing, {
      writable: true,
      refresh: async () => {},
      state: {
        projectId: 'p_1',
        me: { role: 'owner' },
        sprint: { revision: 1 },
        listed: true,
        policy: { goalVersion: 1 },
        joinRequests: [
          { id: 'jr_1', display_name: '지호', goal_version: 1, created_at: at, restricted: true },
          { id: 'jr_2', display_name: '하린', goal_version: 1, created_at: at, restricted: false },
        ],
      },
    }),
  );
  const rows = html.split('<li>').slice(1);
  assert.match(rows[0], /이 사람은 지금 참여할 수 없어요/);
  assert.match(rows[0], /<button[^>]*disabled=""[^>]*>승인/);
  assert.doesNotMatch(rows[1], /참여할 수 없어요/);
  assert.doesNotMatch(rows[1], /<button[^>]*disabled=""[^>]*>승인/);
});

// 2026-11-15 중복 정리: 공개 설정은 프로젝트 탭 한 곳. 같은 설정이 팀 찾기와 홈 공개 모집에 함께 쓰인다.
void test('팀 공개 설정 문구는 팀 찾기와 홈 공개 모집 둘 다에 보인다는 걸 알린다', () => {
  const html = renderToString(
    createElement(TeamListing, {
      writable: true,
      refresh: async () => {},
      state: { projectId: 'p_1', me: { role: 'owner' }, sprint: { revision: 1 }, listed: false, policy: { goalVersion: 1 } },
    }),
  );
  assert.match(html, /팀 찾기와 홈 공개 모집에 공개/);
});

void test('홈에서 관심을 보낸 사람: 이름·초대 버튼, 이미 초대했으면 재발급, 이메일이 없으면 버튼이 꺼진다. 없으면 아무것도 안 보인다', () => {
  const html = renderToString(
    createElement(InterestList, {
      busy: false,
      onInvite: () => {},
      interests: [
        { user_id: 'u1', display_name: '지호', email: 'a@x.dev', created_at: at, invited: false },
        { user_id: 'u2', display_name: '하린', email: 'b@x.dev', created_at: at, invited: true },
        { user_id: 'u3', display_name: '도윤', email: null, created_at: at, invited: false },
      ],
    }),
  );
  assert.match(html, /홈에서 관심을 보낸 사람 (<!-- -->)?3(<!-- -->)?명/);
  const rows = html.split('<li').slice(1);
  assert.match(rows[0], /지호[\s\S]*>초대 보내기<\/button>/);
  assert.match(rows[1], /초대 상태 확인·재발급/);
  assert.match(rows[2], /<button[^>]*disabled=""[^>]*>초대 보내기/);
  assert.equal(renderToString(createElement(InterestList, { busy: false, onInvite: () => {}, interests: [] })), '');
});
