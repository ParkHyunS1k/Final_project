// 프로필 산정식(v2). 등급·상위 %·카드·공개 프로필은 이 결과만 쓴다. 산정식을 바꾸면 버전도 바꾼다.
// 근거: docs/superpowers/specs/2026-11-17-profile-share-design.md
import { gradeOf, type Grade } from './score.ts';

export const PROFILE_FORMULA = 'v2';
export type ProfileGrade = Grade | 'E';
/** 내 프로젝트 하나. endedAt: 완주 시각·마감 시각·나간 시각 중 해당하는 것. */
export type ProfileProject = {
  score: number | null;
  left: boolean;
  lifecycle: string;
  startedAt: string | null;
  endedAt: string | null;
  /** 평가를 내지 않아 결과가 가려졌다. 완주로 세지 않는다(내지 않는 편이 이득이 되지 않게). */
  hidden?: boolean;
};

const DAY_MS = 86400000;
/** 평가 보정: 평균 앞에 이 점수짜리 프로젝트 하나가 더 있다고 본다. 평가가 없으면 이 점수. */
const PEER_PRIOR = 3.5;
const PEER_WEIGHT = 0.7;
/** 완주 1개당 가산점과 상한(10개). */
const FINISH_BONUS = 0.05;
const BONUS_MAX = 0.5;
/** 팀 평가를 한 번도 못 받은 사람의 상한(B). */
const NO_PEER_MAX = 3.9;
/** 마지막 종료 후 쉬는 날이 이만큼 지나면 1주마다 감점. */
const IDLE_GRACE_DAYS = 14;
const IDLE_WEEKLY = 0.1;
const IDLE_MAX = 1.0;

/**
 * v2(사용자 결정 2026-11-18): 평가 70% + 완주율 30% + 완주 가산점 − 휴식 감점, 0~5.
 * 끝난 프로젝트(완주·기한 종료·시작 뒤 참여 중단)가 없으면 null.
 */
export function profileScore(projects: ProfileProject[], now: Date): number | null {
  const finished = projects.filter((p) =>
    p.left ? Boolean(p.startedAt) : p.lifecycle === 'completed' || p.lifecycle === 'expired',
  );
  if (!finished.length) return null;
  const completed = finished.filter((p) => !p.left && !p.hidden && p.lifecycle === 'completed').length;
  const scores = projects.map((p) => p.score).filter((s): s is number => s !== null);
  const peer = (scores.reduce((a, b) => a + b, PEER_PRIOR)) / (scores.length + 1);
  let total =
    peer * PEER_WEIGHT + (completed / finished.length) * 5 * (1 - PEER_WEIGHT) + Math.min(completed * FINISH_BONUS, BONUS_MAX);
  if (!scores.length) total = Math.min(total, NO_PEER_MAX);
  if (!projects.some((p) => !p.left && p.lifecycle === 'active')) {
    const lastEnd = Math.max(...finished.map((p) => (p.endedAt ? Date.parse(p.endedAt) : 0)));
    const idleDays = (now.getTime() - lastEnd) / DAY_MS;
    total -= Math.min(Math.floor(Math.max(0, idleDays - IDLE_GRACE_DAYS) / 7) * IDLE_WEEKLY, IDLE_MAX);
  }
  // 1e-9: 3.5*0.7=2.4499… 같은 부동소수점 오차가 반올림을 뒤집지 않게.
  return Math.round(Math.min(5, Math.max(0, total)) * 10 + 1e-9) / 10;
}

export function profileGrade(score: number | null): ProfileGrade {
  return gradeOf(score) ?? 'E';
}

/** 순위(나보다 높은 사람 수 + 1)와 전체 인원 → 상위 %(1~100). 1등은 언제나 1%. */
export function topPercent(rank: number, total: number): number {
  return Math.max(1, Math.ceil(((rank - 1) / total) * 100));
}

/** 일괄 계산 시각 → "11월 17일 03:00 기준"(서울). */
export function basisLabel(iso: string) {
  return (
    new Date(iso).toLocaleString('ko-KR', {
      timeZone: 'Asia/Seoul',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }) + ' 기준'
  );
}
