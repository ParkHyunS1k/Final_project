// 프로필 산정식(v2)과 상위 %. 근거: docs/superpowers/specs/2026-11-17-profile-share-design.md, 사용자 결정 2026-11-18.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROFILE_FORMULA, profileGrade, profileScore, topPercent, type ProfileProject } from '../lib/profile-score.ts';

const NOW = new Date('2026-11-18T00:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86400000).toISOString();
const done = (score: number | null, ended = 1): ProfileProject => ({ score, left: false, lifecycle: 'completed', startedAt: daysAgo(ended + 7), endedAt: daysAgo(ended) });
const expired = (score: number | null, ended = 1): ProfileProject => ({ ...done(score, ended), lifecycle: 'expired' });
const running: ProfileProject = { score: null, left: false, lifecycle: 'active', startedAt: daysAgo(1), endedAt: null };

void test('v2 기본: 평가(3.5로 보정) 70% + 완주율 30% + 완주 1개당 0.05', () => {
  assert.equal(PROFILE_FORMULA, 'v2');
  assert.equal(profileScore([done(5)], NOW), 4.5); // (5+3.5)/2*0.7 + 5*0.3 + 0.05 = 4.525
  assert.equal(profileScore([done(5), done(5), done(5)], NOW), 4.9);
  assert.equal(profileScore([done(4.6), expired(4.0)], NOW), 3.6); // 3.57 + 0.05
});

void test('v2: 끝난 프로젝트가 없으면 null(E), 진행 중·준비·예전 프로젝트는 세지 않는다', () => {
  assert.equal(profileScore([], NOW), null);
  const draft: ProfileProject = { score: null, left: false, lifecycle: 'draft', startedAt: null, endedAt: null };
  const legacy: ProfileProject = { ...draft, lifecycle: 'legacy' };
  assert.equal(profileScore([running, draft, legacy], NOW), null);
});

void test('v2: 팀 평가를 한 번도 못 받았으면 최대 3.9(B)', () => {
  assert.equal(profileScore([done(null)], NOW), 3.9); // 4.0 → 3.9
  assert.equal(profileScore([done(null), done(null), done(null), done(null), done(null)], NOW), 3.9);
  assert.equal(profileScore([expired(null)], NOW), 2.5); // 3.5*0.7 + 0 + 0
});

void test('v2: 가산점은 10개(+0.5)까지, 점수는 5를 넘지 않는다', () => {
  assert.equal(profileScore(Array.from({ length: 12 }, () => done(5)), NOW), 5);
  const ten = Array.from({ length: 10 }, () => done(3));
  const twelve = Array.from({ length: 12 }, () => done(3));
  assert.equal(profileScore(ten, NOW), 4.1); // (30+3.5)/11*0.7 + 1.5 + 0.5 = 4.13
  assert.equal(profileScore(twelve, NOW), 4.1); // 가산점은 10개에서 멈춘다: 4.13 → 4.23이 아니다
});

void test('v2 휴식 감점: 마지막 종료 후 2주 지나면 1주마다 0.1, 최대 1.0, 진행 중이면 없음', () => {
  assert.equal(profileScore([done(5, 14)], NOW), 4.5);
  assert.equal(profileScore([done(5, 20)], NOW), 4.5);
  assert.equal(profileScore([done(5, 21)], NOW), 4.4);
  assert.equal(profileScore([done(5, 42)], NOW), 4.1); // 6주 쉼: −0.4
  assert.equal(profileScore([done(5, 84)], NOW), 3.5); // 12주 쉼: −1.0
  assert.equal(profileScore([done(5, 400)], NOW), 3.5); // 최대 −1.0
  assert.equal(profileScore([done(5, 400), running], NOW), 4.5);
  // 가장 최근 종료 기준.
  assert.equal(profileScore([done(5, 400), done(5, 3)], NOW), 4.8); // (10+3.5)/3*0.7+1.5+0.1 = 4.75
  // 상한(3.9)을 먼저 적용하고 감점을 뺀다.
  assert.equal(profileScore([done(null, 42)], NOW), 3.5);
});

void test('v2 참여 중단: 시작 뒤 나가면 실패(나간 시각이 종료), 시작 전에 나가면 세지 않는다', () => {
  const leftAfter: ProfileProject = { score: null, left: true, lifecycle: 'completed', startedAt: daysAgo(10), endedAt: daysAgo(5) };
  const leftBefore: ProfileProject = { score: null, left: true, lifecycle: 'draft', startedAt: null, endedAt: daysAgo(5) };
  assert.equal(profileScore([done(5), leftAfter], NOW), 3.8); // 4.25*0.7 + 2.5*0.3 + 0.05 = 3.775
  assert.equal(profileScore([leftBefore], NOW), null);
});

void test('등급: 기존 하한, 점수 없으면 E', () => {
  assert.equal(profileGrade(4.8), 'S');
  assert.equal(profileGrade(4.5), 'A');
  assert.equal(profileGrade(1.5), 'D');
  assert.equal(profileGrade(null), 'E');
});

void test('상위 %: 1등은 1%, 동률은 같은 순위로, 꼴찌', () => {
  assert.equal(topPercent(1, 1), 1);
  assert.equal(topPercent(1, 100), 1);
  assert.equal(topPercent(13, 100), 12);
  assert.equal(topPercent(2, 2), 50);
  assert.equal(topPercent(100, 100), 99);
});

void test('v2 평가 미제출로 결과가 가려진 프로젝트는 완주로 세지 않는다(내지 않는 쪽이 늘 불리)', () => {
  const hidden: ProfileProject = { ...done(null), hidden: true };
  assert.equal(profileScore([hidden], NOW), 2.5); // 3.5*0.7 + 0 + 0 = 2.45
  // 최저 평가(1.0)를 받고 낸 사람보다 낮다.
  assert.ok(profileScore([hidden], NOW)! < profileScore([done(1)], NOW)!);
});
