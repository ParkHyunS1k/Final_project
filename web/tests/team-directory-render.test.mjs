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
const { MyRequests, TeamDirectory, TeamListing, InterestList } = await import(pathToFileURL(outfile).href);
const at = '2026-10-15T03:50:00.000Z';

void test('공개 카드가 없어도 대기 중인 내 신청에는 취소 버튼이 있고, 처리된 신청에는 없다', () => {
  const html = renderToString(
    createElement(MyRequests, {
      busy: false,
      onCancel: () => {},
      requests: [
        { requestId: 'jr_1', projectId: 'p_hidden', title: '비공개로 바뀐 팀', status: 'pending', createdAt: at },
        { requestId: 'jr_2', projectId: 'p_ok', title: '승인된 팀', status: 'approved', createdAt: at },
        { requestId: 'jr_3', projectId: 'p_no', title: '거절된 팀', status: 'rejected', createdAt: at },
      ],
    }),
  );
  const rows = html.split('<li>').slice(1);
  assert.equal(rows.length, 3);
  assert.match(rows[0], /비공개로 바뀐 팀[\s\S]*팀장 확인 대기[\s\S]*<button[^>]*>신청 취소<\/button>/);
  assert.doesNotMatch(rows[1] + rows[2], /신청 취소/);
  assert.match(html, /href="\/workspace\?project=p_ok"/);
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
