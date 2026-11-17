// 프로필 점수 저장과 공개 프로필. 산정식은 lib/profile-score.ts, 근거는
// docs/superpowers/specs/2026-11-17-profile-share-design.md. 다른 사람의 점수는 내보내지 않는다.
import { database, Conflict } from './sprint-store';
import { PolicyError } from './sprint-policy';
import { projectRows, type Identity } from './projects';
import { readExperiences } from './career/store';
import { readGithubAccount } from './github-account';
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

// ---- 공개 프로필 설정 ----

const RESERVED = new Set(['app', 'api', 'admin', 'u', 'new', 'settings', 'login', 'logout', 'me', 'profile', 'projectmate', 'www']);

/** 앞뒤 공백을 빼고 소문자로. 영문 소문자·숫자·-·_ 3~20자, 예약어 불가. */
export function normalizeHandle(value: unknown): string {
  const handle = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!/^[a-z0-9_-]{3,20}$/.test(handle))
    throw new PolicyError('아이디는 영문 소문자·숫자·-·_ 3~20자로 정해주세요.', 400);
  if (RESERVED.has(handle)) throw new PolicyError('쓸 수 없는 아이디예요.', 400);
  return handle;
}

export type ProfileSettings = {
  handle: string;
  displayName: string;
  enabled: boolean;
  showGithub: boolean;
  hiddenProjects: string[];
  hiddenExperiences: string[];
  shownEvidence: string[];
  version: number;
};
type SettingsRow = {
  handle: string;
  display_name: string;
  enabled: boolean;
  show_github: boolean;
  hidden_projects: string[];
  hidden_experiences: string[];
  shown_evidence: string[];
  version: number;
};
const toSettings = (r: SettingsRow): ProfileSettings => ({
  handle: r.handle,
  displayName: r.display_name,
  enabled: Boolean(r.enabled),
  showGithub: Boolean(r.show_github),
  hiddenProjects: r.hidden_projects ?? [],
  hiddenExperiences: r.hidden_experiences ?? [],
  shownEvidence: r.shown_evidence ?? [],
  version: Number(r.version),
});
const SETTINGS_COLUMNS = 'handle,display_name,enabled,show_github,hidden_projects,hidden_experiences,shown_evidence,version';

async function settingsRow(userId: string) {
  return database()
    .prepare(`SELECT ${SETTINGS_COLUMNS} FROM public_profiles WHERE user_id=?`)
    .bind(userId)
    .first<SettingsRow>();
}

/** 공개 프로필에 올릴 수 있는 내 항목: 완주했고 참여 중인 프로젝트, '본인 확인' 경험. */
async function ownItems(userId: string) {
  const [projects, experiences] = await Promise.all([projectRows(userId), readExperiences(userId)]);
  return {
    projects: projects
      .filter((p) => p.lifecycle === 'completed' && !p.left_at)
      .map((p) => ({ id: String(p.id), title: p.title })),
    experiences: experiences
      .filter((e) => e.valid)
      .map((e) => ({ id: e.id, title: e.task_title, projectTitle: e.project_title })),
  };
}

/** GET /api/profile */
export async function readProfileSettings(user: Identity) {
  const [row, github, items] = await Promise.all([settingsRow(user.id), readGithubAccount(user.id), ownItems(user.id)]);
  return {
    settings: row ? toSettings(row) : null,
    defaults: { displayName: user.name },
    github: github?.login ?? null,
    ...items,
  };
}

const idList = (v: unknown, allowed: Set<string>) =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && allowed.has(x)))] : [];

/** POST /api/profile { action: 'save' }. version으로 동시 변경을 막고, 설정과 기록을 한 번에 저장한다. */
export async function saveProfileSettings(user: Identity, b: Record<string, unknown>) {
  const handle = normalizeHandle(b.handle);
  const displayName = typeof b.displayName === 'string' ? b.displayName.trim() : '';
  if (displayName.length < 1 || displayName.length > 30)
    throw new PolicyError('프로필 이름은 1~30자로 정해주세요.', 400);
  const version = Number(b.version);
  if (!Number.isInteger(version) || version < 0) throw new PolicyError('요청 형식이 올바르지 않습니다.', 400);
  const [old, github, items] = await Promise.all([settingsRow(user.id), readGithubAccount(user.id), ownItems(user.id)]);
  if ((old ? Number(old.version) : 0) !== version) throw new Conflict('다른 곳에서 바뀌었어요. 다시 불러와 주세요.');
  const projectIds = new Set(items.projects.map((p) => p.id));
  const experienceIds = new Set(items.experiences.map((e) => e.id));
  const next = {
    handle,
    displayName,
    enabled: b.enabled === true,
    showGithub: b.showGithub === true && Boolean(github),
    hiddenProjects: idList(b.hiddenProjects, projectIds),
    hiddenExperiences: idList(b.hiddenExperiences, experienceIds),
    shownEvidence: idList(b.shownEvidence, experienceIds),
  };
  const taken = await database()
    .prepare('SELECT 1 AS x FROM public_profiles WHERE handle=? AND user_id<>?')
    .bind(handle, user.id)
    .first();
  if (taken) throw new PolicyError('이미 쓰는 아이디예요.', 409);
  const action = !old
    ? 'create'
    : old.handle !== handle
      ? 'handle'
      : Boolean(old.enabled) !== next.enabled
        ? next.enabled ? 'enable' : 'disable'
        : 'update';
  const now = new Date().toISOString();
  const db = database();
  const values = [
    next.handle,
    next.displayName,
    next.enabled,
    next.showGithub,
    JSON.stringify(next.hiddenProjects),
    JSON.stringify(next.hiddenExperiences),
    JSON.stringify(next.shownEvidence),
    now,
  ];
  const write = old
    ? db
        .prepare(
          'UPDATE public_profiles SET handle=?,display_name=?,enabled=?,show_github=?,hidden_projects=?::jsonb,hidden_experiences=?::jsonb,shown_evidence=?::jsonb,updated_at=?,version=version+1 WHERE user_id=? AND version=?',
        )
        .bind(...values, user.id, version)
    : db
        .prepare(
          'INSERT INTO public_profiles(handle,display_name,enabled,show_github,hidden_projects,hidden_experiences,shown_evidence,updated_at,user_id,version) VALUES(?,?,?,?,?::jsonb,?::jsonb,?::jsonb,?,?,1) ON CONFLICT(user_id) DO NOTHING',
        )
        .bind(...values, user.id);
  // 기록은 이번 쓰기가 실제로 반영됐을 때만 남는다(같은 version·시각을 다시 확인).
  const log = db
    .prepare(
      `INSERT INTO public_profile_events(id,user_id,action,detail) SELECT ?,?,?,?::jsonb WHERE EXISTS(SELECT 1 FROM public_profiles WHERE user_id=? AND version=? AND updated_at=?)`,
    )
    .bind('ppe_' + crypto.randomUUID(), user.id, action, JSON.stringify({ handle: next.handle, enabled: next.enabled }), user.id, version + 1, now);
  let changed: number;
  try {
    const [result] = await db.batch([write, log]);
    changed = result.meta.changes;
  } catch (e) {
    if ((e as { code?: string }).code === '23505') throw new PolicyError('이미 쓰는 아이디예요.', 409);
    throw e;
  }
  if (changed !== 1) throw new Conflict('다른 곳에서 바뀌었어요. 다시 불러와 주세요.');
  return { settings: { ...next, version: version + 1 } satisfies ProfileSettings };
}
