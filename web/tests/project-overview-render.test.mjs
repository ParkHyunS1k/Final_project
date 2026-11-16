import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';

// 프로젝트 탭(2026-11-16 재구성): 왼쪽 목표·완료, 오른쪽 정보·저장소·팀원. 서버 렌더링으로 구역과 조건을 확인한다.
const cache = join(process.cwd(), 'node_modules', '.cache');
mkdirSync(cache, { recursive: true });
const dir = mkdtempSync(join(cache, 'pm-project-overview-'));
const bundle = async (entry, name) => {
  const outfile = join(dir, name);
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    jsx: 'automatic',
    packages: 'external',
    alias: { '@': process.cwd() },
  });
  return import(pathToFileURL(outfile).href);
};
const { ProjectOverview } = await bundle('components/project-overview.tsx', 'overview.mjs');
const { RepoField } = await bundle('components/github-issues.tsx', 'github-issues.mjs');
const noop = () => {};
const member = (person, name, over = {}) => ({
  display_name: name,
  role: person === 0 ? 'owner' : 'member',
  person,
  agreed_at: '2026-11-09T05:00:00.000Z',
  agreed_goal_version: 1,
  left_at: null,
  left_note: '',
  github_login: null,
  ...over,
});
const four = [member(0, '박현식', { github_login: 'ParkHyunS1k' }), member(1, '토지차'), member(2, '김서버'), member(3, '이화면')];
function state(over = {}) {
  return {
    projectId: 'p1',
    asOf: '2026-11-15T05:00:00.000Z',
    me: { role: 'owner', person: 0, agreedAt: null, agreedGoalVersion: 1, leftAt: null, name: '박현식' },
    details: { goal: '할 일 앱을 배포한다', deliverables: [], completion_criteria: '네 명이 저장하고 다시 불러온다', legacy: false },
    members: four,
    invites: [],
    listed: false,
    joinRequests: [],
    policy: {
      goalVersion: 1,
      durationDays: 7,
      dailyHours: 8,
      completionMode: 'tasks',
      startedAt: '2026-11-09T05:00:00.000Z',
      deadlineAt: '2026-11-16T05:00:00.000Z',
      completedAt: null,
    },
    agreement: null,
    deliverables: [],
    completion: { ready: false, total: 11, confirmed: 9, missing: ['할 일 삭제 API', '배포 주소 연결'] },
    sprint: { revision: 3, tasks: [{}] },
    ...over,
  };
}
function render(over = {}, props = {}) {
  return renderToString(
    createElement(ProjectOverview, {
      state: state(over),
      lifecycle: 'active',
      phaseLabel: '진행 중',
      colors: {},
      writable: true,
      canEdit: true,
      busy: false,
      repo: createElement('span', null, 'REPO-SLOT'),
      teamExtra: createElement('p', null, 'INTEREST-SLOT'),
      inviteLink: '',
      setInviteLink: noop,
      refresh: async () => {},
      onFinish: noop,
      onEvidence: noop,
      onConfirm: noop,
      onExport: noop,
      ...props,
    }),
  );
}

void test('진행 중 4/4: 정보 카드(상태·DAY·기간·저장소), 모집 도구 대신 마감 한 줄, 동의 반복 없음', () => {
  const html = render();
  assert.match(html, /프로젝트 정보/);
  assert.match(html, /진행 중/);
  assert.match(html, /DAY 7\/7/);
  assert.match(html, /11\/09 14:00 ~ 11\/16 14:00/);
  assert.match(html, /REPO-SLOT/);
  assert.match(html, /4\/4/);
  assert.match(html, /자리가 다 찼어요/);
  assert.doesNotMatch(html, /초대 링크 만들기/);
  assert.doesNotMatch(html, /팀 찾기와 홈 공개 모집에 공개/);
  assert.doesNotMatch(html, /INTEREST-SLOT/);
  assert.doesNotMatch(html, /목표 v1 동의/);
  assert.match(html, /@ParkHyunS1k/);
  assert.match(html, /내보내기/);
});

void test('완료 구역: 이름은 프로젝트 완료, 남은 업무 목록과 진행 막대', () => {
  const html = render();
  assert.match(html, /프로젝트 완료/);
  assert.doesNotMatch(html, /진행 기록/);
  assert.match(html, /9 \/ 11/);
  assert.match(html, /할 일 삭제 API/);
  assert.match(html, /배포 주소 연결/);
  assert.match(html, /width:82%/);
  assert.match(html, /나의 경험으로 가져오기/);
});

void test('준비 중 2/4: 초대·공개 설정·관심 표시가 보이고 재동의가 필요한 사람만 표시', () => {
  const html = render(
    {
      members: [four[0], member(1, '토지차', { agreed_goal_version: 1 })],
      policy: { ...state().policy, goalVersion: 2, startedAt: null, deadlineAt: null },
      me: { ...state().me, agreedGoalVersion: 2 },
    },
    { lifecycle: 'draft', phaseLabel: '준비 중' },
  );
  assert.match(html, /2\/4/);
  assert.match(html, /시작한 시각부터 7일/);
  assert.match(html, /초대 링크 만들기/);
  assert.match(html, /팀 찾기와 홈 공개 모집에 공개/);
  assert.match(html, /INTEREST-SLOT/);
  assert.equal(html.match(/재동의 필요/g)?.length, 2);
  assert.doesNotMatch(html, /자리가 다 찼어요/);
  assert.doesNotMatch(html, /DAY/);
});

void test('꽉 찼어도 공개 중이면 공개 설정을 남겨 내릴 수 있다', () => {
  const html = render({ listed: true });
  assert.match(html, /팀 찾기와 홈 공개 모집에 공개/);
  assert.doesNotMatch(html, /초대 링크 만들기/);
});

void test('팀원에게는 초대·공개 도구가 없다', () => {
  const html = render(
    { members: [four[0], four[1]], me: { ...state().me, role: 'member', person: 1 } },
  );
  assert.doesNotMatch(html, /초대 링크 만들기/);
  assert.doesNotMatch(html, /팀 찾기와 홈 공개 모집에 공개/);
  assert.doesNotMatch(html, /INTEREST-SLOT/);
});

void test('예전 결과물 기준: 결과물 체크리스트와 근거 버튼은 남고 이용료·보증금 예시는 없다', () => {
  const html = render({
    policy: { ...state().policy, completionMode: 'deliverables' },
    completion: { ready: false, total: 1, confirmed: 0, missing: ['배포 주소'] },
    deliverables: [
      {
        deliverableId: 'd1',
        position: 0,
        title: '배포 주소',
        fixedAt: null,
        evidence: '',
        evidenceBy: null,
        evidenceAt: null,
        confirmed: false,
        confirmedBy: null,
        confirmedAt: null,
      },
    ],
  });
  assert.match(html, /배포 주소/);
  assert.match(html, /근거 기록·수정/);
  assert.match(html, /팀장이 직접 확인/);
  assert.match(html, /기한 내 완주 확인/);
  assert.doesNotMatch(html, /이용료|보증금/);
});

void test('저장소 칸: 팀장은 등록 폼, 팀원은 안내, 등록 후 팀장만 변경 버튼', () => {
  const base = { busy: false, writable: true, editing: false, url: '', message: '', onEdit: noop, onCancel: noop, onUrl: noop, onSubmit: noop };
  const repo = { owner: 'team', name: 'app', version: 1, url: 'https://github.com/team/app' };
  const ownerEmpty = renderToString(createElement(RepoField, { ...base, repo: null, canManage: true }));
  assert.match(ownerEmpty, /공개 GitHub 저장소 주소/);
  assert.match(ownerEmpty, /저장소 등록/);
  const memberEmpty = renderToString(createElement(RepoField, { ...base, repo: null, canManage: false }));
  assert.match(memberEmpty, /아직 없어요/);
  assert.doesNotMatch(memberEmpty, /저장소 등록/);
  const ownerSet = renderToString(createElement(RepoField, { ...base, repo, canManage: true }));
  assert.match(ownerSet, /href="https:\/\/github.com\/team\/app"/);
  assert.match(ownerSet, />변경</);
  const memberSet = renderToString(createElement(RepoField, { ...base, repo, canManage: false }));
  assert.match(memberSet, /team\/app/);
  assert.doesNotMatch(memberSet, />변경</);
});
