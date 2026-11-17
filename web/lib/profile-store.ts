// 프로필 점수 저장과 공개 프로필. 산정식은 lib/profile-score.ts, 근거는
// docs/superpowers/specs/2026-11-17-profile-share-design.md. 다른 사람의 점수는 내보내지 않는다.
import { database } from './sprint-store';
import { scoreSummary } from './score-store';
import { PROFILE_FORMULA, profileGrade, profileScore, topPercent, type ProfileGrade } from './profile-score';

export type ProfileStanding = {
  score: number | null;
  grade: ProfileGrade;
  /** 점수가 없으면 null. */
  percentile: number | null;
  /** 같은 산정식 버전에서 점수가 있는 사용자 수. */
  total: number;
  computedAt: string;
};

/** 매일 한 번: 프로젝트 멤버였던 모든 사용자의 프로필 점수를 다시 계산해 덮어쓴다. */
export async function refreshAllProfileScores(now = new Date()) {
  const db = database();
  const users = await db
    .prepare('SELECT DISTINCT user_id FROM project_members ORDER BY user_id')
    .all<{ user_id: string }>();
  // ponytail: 사용자별 순차 계산. 사용자가 많아져 시간이 모자라면 묶음 병렬로 바꾼다.
  for (const { user_id } of users.results) {
    const summary = await scoreSummary(user_id, now);
    const score = profileScore(summary.history);
    await db
      .prepare(
        `INSERT INTO profile_scores(user_id,score,grade,formula_version,computed_at) VALUES(?,?,?,?,?)
         ON CONFLICT(user_id) DO UPDATE SET score=excluded.score,grade=excluded.grade,formula_version=excluded.formula_version,computed_at=excluded.computed_at`,
      )
      .bind(user_id, score, profileGrade(score), PROFILE_FORMULA, now.toISOString())
      .run();
  }
  return { users: users.results.length };
}

/** 저장된 내 프로필 점수와 상위 %. 같은 버전 저장값이 없으면 null. */
export async function profileStanding(userId: string): Promise<ProfileStanding | null> {
  const row = await database()
    .prepare(
      `SELECT m.score,m.grade,m.computed_at,
        (SELECT count(*)::int FROM profile_scores o WHERE o.formula_version=m.formula_version AND o.score IS NOT NULL AND o.score>m.score) AS above,
        (SELECT count(*)::int FROM profile_scores o WHERE o.formula_version=m.formula_version AND o.score IS NOT NULL) AS total
       FROM profile_scores m WHERE m.user_id=? AND m.formula_version=?`,
    )
    .bind(userId, PROFILE_FORMULA)
    .first<{ score: number | null; grade: ProfileGrade; computed_at: Date; above: number; total: number }>();
  if (!row) return null;
  const score = row.score === null ? null : Number(row.score);
  const total = Number(row.total);
  return {
    score,
    grade: row.grade,
    percentile: score === null ? null : topPercent(Number(row.above) + 1, total),
    total,
    computedAt: new Date(row.computed_at).toISOString(),
  };
}
