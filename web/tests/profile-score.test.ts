// 프로필 산정식(v1)과 상위 %. 근거: docs/superpowers/specs/2026-11-17-profile-share-design.md
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROFILE_FORMULA, profileGrade, profileScore, topPercent } from '../lib/profile-score.ts';

test('v1 점수: 공개된 프로젝트 점수 평균, 없으면 null', () => {
  assert.equal(PROFILE_FORMULA, 'v1');
  assert.equal(profileScore([{ score: 4.5 }, { score: null }, { score: 4.0 }]), 4.3); // 4.25 → 반올림
  assert.equal(profileScore([{ score: null }]), null);
  assert.equal(profileScore([]), null);
});

test('등급: 기존 하한, 점수 없으면 E', () => {
  assert.equal(profileGrade(4.8), 'S');
  assert.equal(profileGrade(4.5), 'A');
  assert.equal(profileGrade(1.5), 'D');
  assert.equal(profileGrade(null), 'E');
});

test('상위 %: 1등은 1%, 동률은 같은 순위로, 꼴찌', () => {
  assert.equal(topPercent(1, 1), 1);
  assert.equal(topPercent(1, 100), 1);
  assert.equal(topPercent(13, 100), 12);
  assert.equal(topPercent(2, 2), 50);
  assert.equal(topPercent(100, 100), 99);
});
