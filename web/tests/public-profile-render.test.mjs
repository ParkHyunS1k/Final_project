import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';

// 공개 프로필 화면과 카드를 서버 렌더링해 보이는 내용을 확인한다.
const cache = join(process.cwd(), 'node_modules', '.cache');
mkdirSync(cache, { recursive: true });
const outfile = join(mkdtempSync(join(cache, 'pm-public-')), 'public.mjs');
await build({
  stdin: {
    contents: "export { PublicProfileView } from './components/public-profile'; export { ProfileCard } from './components/profile-card';",
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  jsx: 'automatic',
  packages: 'external',
  alias: { '@': process.cwd() },
});
const { PublicProfileView, ProfileCard } = await import(pathToFileURL(outfile).href);
const now = new Date('2026-11-17T03:00:00Z');
const profile = {
  handle: 'harin',
  displayName: '하린',
  target: '프론트엔드 개발',
  github: 'harin-dev',
  standing: { score: 4.5, grade: 'A', percentile: 12, total: 40, computedAt: '2026-11-16T18:00:00Z' },
  finished: 2,
  streak: 5,
  dates: ['2026-11-17', '2026-11-16'],
  badges: [{ id: 'finish', label: '7일 완주', count: 2 }, { id: 'top_communicator', label: '소통왕', count: 1 }],
  projects: [
    { id: 'p1', title: '동네 가게 예약 페이지', startedAt: '2026-10-28T03:00:00Z', deadlineAt: '2026-11-04T03:00:00Z', members: 3, role: 'owner', grade: 'A' },
    { id: 'p2', title: '내 프로젝트 포트폴리오', startedAt: '2026-11-08T03:00:00Z', deadlineAt: '2026-11-15T03:00:00Z', members: 1, role: 'solo', grade: null },
  ],
  experiences: [
    { id: 'e1', projectTitle: '내 프로젝트 포트폴리오', title: '반응형 화면', bullet: '반응형 화면 업무를 수행했습니다.', skills: ['react'], evidence: null },
    { id: 'e2', projectTitle: '동네 가게 예약 페이지', title: '예약 API', bullet: '예약 API를 만들었습니다.', skills: ['api'], evidence: 'PR #12 머지' },
  ],
};
const render = (p) => renderToString(createElement(PublicProfileView, { profile: p, now }));

void test('요약: 이름·목표·등급·점수·상위 %·완주·연속 학습·계산 기준 시각, GitHub', () => {
  const html = render(profile);
  assert.match(html, /하린/);
  assert.match(html, /프론트엔드 개발/);
  assert.match(html, /<b class="pp-grade">A<\/b>/);
  assert.match(html, /4\.5 \/ 5/);
  assert.match(html, /상위 12%/);
  assert.match(html, /완주한 프로젝트<\/dt><dd>2개/);
  assert.match(html, /연속 학습<\/dt><dd>5일/);
  assert.match(html, /11월 17일 03:00 기준/);
  assert.match(html, /@harin-dev/);
  assert.match(html, /최근 12주 중 2일 학습/);
});

void test('저장값이 없으면 새벽 계산 안내, 점수가 없으면 E와 상위 % 없음, GitHub 없음', () => {
  const none = render({ ...profile, standing: null, github: null });
  assert.match(none, /매일 새벽에 계산돼요/);
  assert.match(none, /<b class="pp-grade">E<\/b>/);
  assert.doesNotMatch(none, /@harin-dev/);
  const empty = render({ ...profile, standing: { ...profile.standing, score: null, grade: 'E', percentile: null } });
  assert.match(empty, /<b class="pp-grade">E<\/b>/);
  assert.doesNotMatch(empty, /상위 \d+%/);
});

void test('프로젝트: 이름·기간·인원·역할·등급, 경험: 문장·역량·켠 근거만', () => {
  const html = render(profile);
  assert.match(html, /동네 가게 예약 페이지[\s\S]*3인 팀 · 팀장[\s\S]*A/);
  assert.match(html, /내 프로젝트 포트폴리오[\s\S]*솔로/);
  assert.match(html, /반응형 화면 업무를 수행했습니다\.[\s\S]*React/);
  assert.match(html, /PR #12 머지/);
  assert.equal((html.match(/완료 근거/g) ?? []).length, 1);
  assert.match(html, /href="\/"[^>]*>나도 7일 스프린트 시작하기/);
});

void test('카드: 등급·점수·상위 %·이름·완주·주소, 저장값 없으면 E와 안내', () => {
  for (const size of ['og', 'story']) {
    const html = renderToString(createElement(ProfileCard, { profile, size }));
    assert.match(html, />A</);
    assert.match(html, /4\.5 \/ 5 · 상위 12%/);
    assert.match(html, /하린/);
    assert.match(html, /완주 2/);
    assert.match(html, /\/u\/harin/);
    assert.match(html, /소통왕/);
  }
  const none = renderToString(createElement(ProfileCard, { profile: { ...profile, standing: null }, size: 'og' }));
  assert.match(none, />E</);
  assert.match(none, /평가를 받으면 상위 %가 나와요/);
});
