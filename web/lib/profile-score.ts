// 프로필 산정식. 등급·상위 %·카드·공개 프로필은 이 결과만 쓴다. 산정식을 바꾸면 버전도 바꾼다.
// 근거: docs/superpowers/specs/2026-11-17-profile-share-design.md
import { gradeOf, type Grade } from './score.ts';

export const PROFILE_FORMULA = 'v1';
export type ProfileGrade = Grade | 'E';

/** v1: 공개됐고 가려지지 않은 프로젝트별 내 동료평가 점수의 평균. 없으면 null. */
export function profileScore(projects: { score: number | null }[]): number | null {
  const scores = projects.map((p) => p.score).filter((s): s is number => s !== null);
  if (!scores.length) return null;
  return Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10;
}

export function profileGrade(score: number | null): ProfileGrade {
  return gradeOf(score) ?? 'E';
}

/** 순위(나보다 높은 사람 수 + 1)와 전체 인원 → 상위 %(1~100). 1등은 언제나 1%. */
export function topPercent(rank: number, total: number): number {
  return Math.max(1, Math.ceil(((rank - 1) / total) * 100));
}
