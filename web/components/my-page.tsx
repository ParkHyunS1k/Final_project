'use client';
// 마이페이지(2026-11-17): 요약 + 활동·경험·설정. 이력서·역량은 CareerWorkspace가 그린다.
// 점수·등급·뱃지는 동료평가(GET /api/score/me) 하나다. 학습 기록은 '공부함' 체크인 날짜만 칠한다.
import { LogOut } from 'lucide-react';
import { ExperienceForm } from './experience-form';
import { GithubLink } from './github-link';
import { ThemeToggle } from './theme-toggle';
import { skillName, type SkillId } from '@/lib/career/catalog';
import { sprintDay } from '@/lib/race';
import { restrictionMessage, type Grade, type RestrictionView } from '@/lib/score';

export type HistoryRow = {
  id: string;
  title: string;
  role: string;
  lifecycle: string;
  startedAt: string | null;
  deadlineAt: string | null;
  score: number | null;
  grade: Grade | null;
};
export type MyScore = {
  bestGrade: Grade | 'E';
  average: number | null;
  badges: { id: string; label: string; description: string; earnedAt: string | null; count: number }[];
  history: HistoryRow[];
};
export type PendingTask = {
  projectId: string;
  projectTitle: string;
  taskId: number;
  taskVersion: number;
  title: string;
  evidence: string;
  skills: SkillId[];
};
type ExperienceRow = {
  id: string;
  project_title: string | null;
  task_title: string;
  resume_bullet: string;
  evidence: string;
  valid: boolean;
  skill_ids: string[];
};
type Portfolio = { id: string; revision: number; payload: { title?: string; url?: string; text?: string } };
export type ExperienceFilter = 'all' | 'project' | 'portfolio';

const DAY_MS = 86_400_000;
const seoulDate = (d: Date) => new Date(d.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
const shortDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric' }) : '';
const ROLE: Record<string, string> = { owner: '팀장', member: '팀원' };

/** 오늘(서울)로 끝나는 weeks주 칸. 공부한 날만 on. */
export function studyCalendar(dates: string[], now: Date, weeks = 12) {
  const studied = new Set(dates);
  const today = Date.parse(seoulDate(now) + 'T00:00:00Z');
  return Array.from({ length: weeks * 7 }, (_, i) => {
    const date = new Date(today - (weeks * 7 - 1 - i) * DAY_MS).toISOString().slice(0, 10);
    return { date, on: studied.has(date) };
  });
}

export function stateLabel(p: Pick<HistoryRow, 'lifecycle' | 'startedAt'> & Partial<HistoryRow>, now: Date) {
  if (p.lifecycle === 'active' && p.startedAt) {
    const days = p.deadlineAt ? Math.round((Date.parse(p.deadlineAt) - Date.parse(p.startedAt)) / DAY_MS) : 7;
    return `진행 중 · DAY ${sprintDay(p.startedAt, now.getTime(), days)}`;
  }
  return { draft: '준비 중', completed: '완주', expired: '기한 종료' }[p.lifecycle] ?? '이전 프로젝트';
}

export function MySummary({
  name,
  target,
  score,
  stats,
}: {
  name: string;
  target: string;
  score: MyScore | null;
  stats: { streak: number; days: number };
}) {
  const finished = score?.history.filter((p) => p.lifecycle === 'completed').length ?? 0;
  return (
    <section className="my-summary" aria-label="내 요약">
      <div className="my-me">
        <span className="my-avatar" aria-hidden="true">
          {name.slice(0, 1) || '나'}
        </span>
        <div>
          <h2>{name || '나'}</h2>
          <p>{target ? `${target} 목표` : '목표 직무를 이력서·역량에서 정할 수 있어요'}</p>
        </div>
        <div className="my-grade">
          <b>{score?.bestGrade ?? 'E'}</b>
          <span>최고 등급</span>
        </div>
      </div>
      <dl className="my-stats">
        <div className="hot">
          <dt>연속 학습</dt>
          <dd>{`${stats.streak}일`}</dd>
        </div>
        <div>
          <dt>학습한 날</dt>
          <dd>{`${stats.days}일`}</dd>
        </div>
        <div>
          <dt>완주한 프로젝트</dt>
          <dd>{`${finished}개`}</dd>
        </div>
        <div>
          <dt>동료평가 평균 (5점)</dt>
          <dd>{score?.average ?? '—'}</dd>
        </div>
      </dl>
    </section>
  );
}

export function ActivityPanel({
  score,
  dates,
  pendingRequests,
  jobs,
  now,
  onOpenProject,
  onTeams,
  onJobs,
}: {
  score: MyScore | null;
  dates: string[];
  pendingRequests: number;
  jobs: number;
  now: Date;
  onOpenProject: (id: string) => void;
  onTeams: () => void;
  onJobs: () => void;
}) {
  const cells = studyCalendar(dates, now);
  const studied = cells.filter((c) => c.on).length;
  const earned = score?.badges.filter((b) => b.earnedAt) ?? [];
  return (
    <div className="my-activity">
      <section className="hub-card my-projects">
        <h3>내 프로젝트 기록</h3>
        {!score ? (
          <p className="hub-empty">기록을 불러오는 중입니다.</p>
        ) : score.history.length ? (
          <ul>
            {score.history.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => onOpenProject(p.id)}>
                  <b>{p.title}</b>
                  <span className="my-meta">
                    {[ROLE[p.role] ?? '팀원', p.startedAt && `${shortDate(p.startedAt)} – ${shortDate(p.deadlineAt)}`]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                  <span className={'pill' + (p.lifecycle === 'completed' ? ' green' : p.lifecycle === 'active' ? ' orange' : '')}>
                    {stateLabel(p, now) + (p.grade ? ` · ${p.grade}` : '')}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="hub-empty">
            <p>아직 참여한 프로젝트가 없어요.</p>
            <button className="btn" onClick={onTeams}>
              팀 찾기
            </button>
          </div>
        )}
      </section>
      <div className="my-side">
        <section className="hub-card">
          <div className="my-card-head">
            <h3>학습한 날</h3>
            <span>최근 12주</span>
          </div>
          <p className="sr-only">{`최근 12주 중 ${studied}일 학습`}</p>
          <div className="my-calendar" aria-hidden="true">
            {cells.map((c, i) => (
              <i key={c.date} className={(c.on ? 'on' : '') + (i === cells.length - 1 ? ' today' : '')} title={c.date} />
            ))}
          </div>
        </section>
        <section className="hub-card">
          <h3>{`뱃지 ${earned.length} / ${score?.badges.length ?? 0}`}</h3>
          <ul className="my-badges">
            {score?.badges.map((b) => (
              <li key={b.id} className={b.earnedAt ? 'my-badge' : 'my-badge off'} title={b.description}>
                <b>{b.label}</b>
                {b.count > 1 && <small>{`×${b.count}`}</small>}
              </li>
            ))}
          </ul>
        </section>
        <section className="hub-card my-now">
          <button type="button" onClick={onTeams}>
            <span>참여 신청</span>
            <span className={'pill' + (pendingRequests ? ' orange' : '')}>
              {pendingRequests ? `확인 대기 ${pendingRequests}` : '대기 없음'}
            </span>
          </button>
          <button type="button" onClick={onJobs}>
            <span>관심 공고</span>
            <span className="pill">{`${jobs}개`}</span>
          </button>
        </section>
      </div>
    </div>
  );
}

export function ExperienceBoard({
  experiences,
  pending,
  portfolios,
  filter,
  busy,
  onFilter,
  onRecord,
  onMerge,
  onEdit,
  onAdd,
}: {
  experiences: ExperienceRow[];
  pending: PendingTask[];
  portfolios: Portfolio[];
  filter: ExperienceFilter;
  busy: boolean;
  onFilter: (f: ExperienceFilter) => void;
  onRecord: (task: PendingTask, values: Record<string, unknown>) => Promise<void>;
  onMerge: (p: Portfolio) => void;
  onEdit: (p: Portfolio) => void;
  onAdd: () => void;
}) {
  const filters: [ExperienceFilter, string, number][] = [
    ['all', '전체', experiences.length + portfolios.length],
    ['project', '프로젝트에서', experiences.length],
    ['portfolio', '직접 추가', portfolios.length],
  ];
  const empty = !experiences.length && !portfolios.length && !pending.length;
  return (
    <div className="my-experience">
      <div className="my-toolbar">
        <div className="team-filters">
          {filters.map(([id, label, n]) => (
            <button
              key={id}
              type="button"
              className={'team-chip' + (filter === id ? ' on' : '')}
              aria-pressed={filter === id}
              onClick={() => onFilter(id)}
            >
              {`${label} ${n}`}
            </button>
          ))}
        </div>
        <button className="btn primary" onClick={onAdd}>
          자료 추가
        </button>
      </div>
      {!!pending.length && filter !== 'portfolio' && (
        <section className="hub-card my-pending">
          <h3>{`가져올 수 있는 업무 ${pending.length}`}</h3>
          <p>완료 근거가 있는 내 담당 업무예요. 직접 한 역량과 기여를 확인하면 이력서 문장이 만들어져요.</p>
          {pending.map((t) => (
            <details key={`${t.projectId}:${t.taskId}:${t.taskVersion}`}>
              <summary>
                <span className="my-meta">{t.projectTitle}</span>
                <b>{t.title}</b>
              </summary>
              <ExperienceForm
                task={{ title: t.title, evidence: t.evidence, skills: t.skills }}
                busy={busy}
                onSave={(values) => onRecord(t, values)}
              />
            </details>
          ))}
        </section>
      )}
      {filter !== 'portfolio' &&
        experiences.map((e) => (
          <article className="hub-card my-exp" key={e.id}>
            <div className="my-exp-head">
              <span className="pill green">{`프로젝트${e.project_title ? ' · ' + e.project_title : ''}`}</span>
              <span className={e.valid ? 'pill' : 'pill orange'}>{e.valid ? '본인 확인' : '재확인 필요'}</span>
            </div>
            <h3>{e.task_title}</h3>
            <p>{e.resume_bullet}</p>
            <p className="my-meta">{e.skill_ids.map((s) => skillName(s)).join(' · ')}</p>
            <details>
              <summary>완료 근거</summary>
              <blockquote>{e.evidence}</blockquote>
            </details>
            {!e.valid && <p className="my-meta">업무·담당·완료 근거가 바뀌어 역량 계산에서 뺐어요. 다시 가져올 수 있어요.</p>}
          </article>
        ))}
      {filter !== 'project' &&
        portfolios.map((p) => (
          <article className="hub-card my-exp" key={p.id}>
            <div className="my-exp-head">
              <span className="pill">직접 추가 · 비공개</span>
            </div>
            <h3>{p.payload.title}</h3>
            <p className="hub-excerpt">{p.payload.text || '본문을 추가하면 역량 분석에 함께 쓸 수 있어요.'}</p>
            <div className="hub-actions">
              {p.payload.url && (
                <a className="btn" href={p.payload.url} target="_blank" rel="noopener noreferrer">
                  원본 열기 ↗
                </a>
              )}
              <button className="btn" disabled={!p.payload.text} onClick={() => onMerge(p)}>
                이력서 분석에 합치기
              </button>
              <button className="btn" onClick={() => onEdit(p)}>
                수정
              </button>
            </div>
          </article>
        ))}
      {empty && (
        <p className="hub-empty">
          프로젝트를 끝내고 완료 근거를 남기면 내 업무가 여기에 모여요.
          <br />
          학교·회사에서 한 프로젝트는 &lsquo;자료 추가&rsquo;로 직접 정리해 둘 수 있어요.
        </p>
      )}
      <p className="my-meta">본인이 기여를 확인한 기록이에요. 시스템이 결과물을 자동으로 검증한 것은 아니에요.</p>
    </div>
  );
}

export function SettingsPanel({
  name,
  restriction,
  busy,
  onSignOut,
}: {
  name: string;
  restriction: RestrictionView | null;
  busy: boolean;
  onSignOut: () => void;
}) {
  return (
    <div className="my-settings">
      <section className="hub-card my-rows">
        <div>
          <div>
            <b>Google 계정</b>
            <p>{`${name} · 로그인에 쓰는 계정이에요.`}</p>
          </div>
          <span className="pill">연결됨</span>
        </div>
        <div>
          <div>
            <b>참여 제한</b>
            <p>
              {restriction
                ? restrictionMessage(restriction, '프로젝트 만들기·참여 신청·초대 수락·시작을 할')
                : '제한 없음. 끝난 프로젝트의 동료평가를 24시간 안에 내지 않으면 7일 → 30일 → 영구로 제한돼요.'}
            </p>
          </div>
          <span className={'pill' + (restriction ? ' orange' : ' my-ok')}>{restriction ? '제한 중' : '정상'}</span>
        </div>
        <div>
          <div>
            <b>화면 테마</b>
            <p>밝게·어둡게를 바꿔요. 이 브라우저에만 기억해요.</p>
          </div>
          <ThemeToggle />
        </div>
        <div>
          <div>
            <b>로그아웃</b>
            <p>이 기기에서 로그아웃해요.</p>
          </div>
          <button className="btn" disabled={busy} onClick={onSignOut}>
            <LogOut size={15} /> 로그아웃
          </button>
        </div>
      </section>
      <GithubLink />
    </div>
  );
}
