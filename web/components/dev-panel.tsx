'use client';
// 업무 상세의 개발 현황(2026-11-14). 벤치마킹: Jira 개발 패널의 숫자 요약 줄, Linear의 PR 한 줄 신호(상태·CI·리뷰),
// GitHub 머지 박스의 판단 상자와 커밋 타임라인. 상태는 바꾸지 않고 제안만 한다.
import { useState } from 'react';
import {
  CircleCheck,
  CircleX,
  CircleDashed,
  CircleMinus,
  Copy,
  Check,
  GitBranch,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  PauseCircle,
  TriangleAlert,
  ArrowRight,
  ChevronRight,
  UserCheck,
  MessageSquareWarning,
  UserRound,
  CircleDot,
  CircleSlash,
} from 'lucide-react';
import {
  branchName,
  DETAIL_MAX_PULLS,
  prSuggestion,
  taskIdsIn,
  taskRef,
  type Checks,
  type Pull,
  type PullDetail,
  type Review,
} from '@/lib/github-prs';
import { seoulTime } from '@/lib/sprint';
import type { IssueStatus } from '@/lib/github-issues';

export const PR_LABEL = { open: '열림', merged: '머지됨', closed: '닫힘' } as const;
export const CHECK_LABEL = {
  success: 'CI 통과',
  failure: 'CI 실패',
  pending: 'CI 진행 중',
  none: 'CI 없음',
} as const;
const REVIEW_LABEL = { approved: '승인', changes_requested: '수정 요청', none: '리뷰 없음' } as const;

export function CheckIcon({ checks, size = 12 }: { checks: Checks; size?: number }) {
  const Icon =
    checks === 'success'
      ? CircleCheck
      : checks === 'failure'
        ? CircleX
        : checks === 'pending'
          ? CircleDashed
          : CircleMinus;
  return <Icon size={size} aria-hidden="true" />;
}
function ReviewIcon({ review, size = 12 }: { review: Review; size?: number }) {
  const Icon =
    review === 'approved' ? UserCheck : review === 'changes_requested' ? MessageSquareWarning : UserRound;
  return <Icon size={size} aria-hidden="true" />;
}
function PullIcon({ state, size = 16 }: { state: Pull['state']; size?: number }) {
  const Icon = state === 'merged' ? GitMerge : state === 'closed' ? GitPullRequestClosed : GitPullRequest;
  return <Icon size={size} aria-hidden="true" />;
}

/** 멈춘 시간. 하루 미만은 시간, 이상은 일. */
export function stallText(hours: number) {
  return hours < 24 ? `${hours}시간` : `${Math.floor(hours / 24)}일`;
}
/** 'n분 전' 같은 상대 시각. 기준 시각이 없으면 KST 날짜. */
function ago(iso: string, now?: string) {
  if (!iso) return '';
  if (!now) return seoulTime(iso).slice(5);
  const minutes = Math.floor((Date.parse(now) - Date.parse(iso)) / 60_000);
  if (minutes < 1) return '방금';
  if (minutes < 60) return `${minutes}분 전`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)}시간 전`;
  return `${Math.floor(minutes / 1440)}일 전`;
}
/** 여러 PR의 CI를 하나로: 실패 > 진행 중 > 통과 > 없음. 아직 모르면 null. */
function overallChecks(list: Checks[]): Checks | null {
  if (!list.length) return null;
  for (const c of ['failure', 'pending', 'success'] as const) if (list.includes(c)) return c;
  return 'none';
}
function overallReview(list: Review[]): Review | null {
  if (!list.length) return null;
  if (list.includes('changes_requested')) return 'changes_requested';
  return list.includes('approved') ? 'approved' : 'none';
}
function Avatar({ login }: { login: string }) {
  // 로그인 글자로 색을 고정한다(외부 이미지는 불러오지 않는다).
  let hue = 7;
  for (let i = 0; i < login.length; i++) hue = (hue * 31 + login.charCodeAt(i)) % 360;
  return (
    <span className="dev-avatar" style={{ ['--hue' as string]: hue }} aria-hidden="true">
      {login.slice(0, 1).toUpperCase()}
    </span>
  );
}

/** PR 주소의 저장소(소문자). fixes #n은 그 저장소의 이슈다. */
function pullRepo(url: string) {
  return url.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\//)?.[1].toLowerCase() ?? '';
}
/** 숫자로 끝나는 말 뒤 조사: 2·4·5·9로 끝나면 받침 없음(이/사/오/구). */
function josa(n: number, [vowel, consonant]: [string, string]) {
  return '2459'.includes(String(n).at(-1) ?? '') ? vowel : consonant;
}
const refs = (numbers: number[]) => numbers.map((n) => `#${n}`).join(', ');

function Callout({
  tone,
  icon,
  title,
  body,
  action,
}: {
  tone: 'idle' | 'go' | 'done' | 'warn';
  icon: React.ReactNode;
  title: string;
  body?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className={`dev-callout is-${tone}`} role={tone === 'warn' ? 'alert' : undefined}>
      <span className="dev-callout-icon">{icon}</span>
      <div className="dev-callout-text">
        <strong>{title}</strong>
        {body && <span>{body}</span>}
      </div>
      {action}
    </div>
  );
}

export type IssueLink = { repo: string; number: number };
function issueLabel(s: IssueStatus) {
  if (s.state === 'missing') return '찾을 수 없음';
  if (s.state === 'open') return '열림';
  return s.reason === 'completed' ? '완료로 닫힘' : s.reason === 'not_planned' ? '계획 안 함으로 닫힘' : '닫힘';
}
function IssueIcon({ status }: { status?: IssueStatus }) {
  const Icon = status?.state === 'closed' ? (status.reason === 'not_planned' ? CircleSlash : CircleCheck) : status?.state === 'missing' ? CircleMinus : CircleDot;
  return <Icon size={15} aria-hidden="true" />;
}
const sameIssue = (a: IssueLink, b: IssueLink) => a.number === b.number && a.repo.toLowerCase() === b.repo.toLowerCase();

/** 업무가 나온 GitHub 이슈와 지금 상태(2026-11-15). 상태는 업무 상세를 열 때 GitHub에서 다시 읽는다. */
function IssueList({ issues, status, error }: { issues: IssueLink[]; status?: IssueStatus[]; error: string }) {
  return (
    <div className="dev-issues">
      <span className="dev-issues-label">출처 이슈</span>
      <ul>
        {issues.map((l) => {
          const s = status?.find((x) => sameIssue(x, l));
          const tone = !s ? 'unknown' : s.state === 'closed' ? `closed-${s.reason ?? 'other'}` : s.state;
          return (
            <li key={`${l.repo}#${l.number}`} className={`dev-issue is-${tone}`}>
              <span className="dev-issue-icon">
                <IssueIcon status={s} />
              </span>
              <a href={s?.url || `https://github.com/${l.repo}/issues/${l.number}`} target="_blank" rel="noreferrer" title={l.repo}>
                <span className="dev-issue-num">#{l.number}</span>
                {s?.title && <span className="dev-issue-title">{s.title}</span>}
              </a>
              {s ? (
                <span className="dev-issue-tags">
                  <span className="dev-signal dev-issue-state">{issueLabel(s)}</span>
                  {s.changed && (
                    <span className="dev-signal dev-issue-changed" title="가져온 뒤 GitHub에서 제목이나 본문 앞부분(업무를 만들 때 AI가 읽은 부분)이 수정됐어요">
                      가져온 뒤 바뀜
                    </span>
                  )}
                </span>
              ) : status ? (
                <span className="dev-signal is-loading" title="업무당 출처 이슈 3개까지만 상태를 확인해요">
                  확인 안 함
                </span>
              ) : (
                !error && <span className="dev-signal is-loading">불러오는 중</span>
              )}
            </li>
          );
        })}
      </ul>
      {error && <p className="dev-error">{error}</p>}
    </div>
  );
}

/** 업무 상세의 개발 현황. 요약 줄 → 판단 상자(멈춤·제안) → PR 목록(펼치면 커밋 타임라인). */
export function PrPanel({
  task,
  pulls,
  details = {},
  detailError = '',
  stalled = null,
  asOf,
  canEdit,
  onStart,
  onUseEvidence,
  issues = [],
  issueStatus,
  issueError = '',
}: {
  task: { id: number; title: string; done: boolean; status?: string | null; touchedAt?: string | Date | null };
  pulls: Pull[];
  /** PR 번호별 CI·리뷰·최근 커밋. 상세를 열 때 읽는다. */
  details?: Record<number, PullDetail>;
  detailError?: string;
  /** 진행 중인데 활동이 없는 시간(시). 12시간 미만이면 null. */
  stalled?: number | null;
  /** 상대 시각 기준(서버 시각). 없으면 날짜로 보인다. */
  asOf?: string;
  canEdit: boolean;
  onStart: () => void;
  onUseEvidence: (text: string) => void;
  /** 이 업무가 나온 GitHub 이슈(가져오기 → AI 변경안 승인). */
  issues?: IssueLink[];
  /** 출처 이슈의 지금 상태. 아직 모르면 undefined. */
  issueStatus?: IssueStatus[];
  issueError?: string;
}) {
  const [copied, setCopied] = useState(false);
  const branch = branchName(task.id, task.title);
  const known = pulls.map((p) => details[p.number]).filter((d): d is PullDetail => !!d);
  const checks = Object.fromEntries(known.map((d) => [d.number, d.checks]));
  // 완료는 CI를 확인한 뒤에만 제안한다(확인 중·실패면 지난 결과나 모름으로 권하지 않는다).
  const ciUnknown = !!detailError || pulls.slice(0, DETAIL_MAX_PULLS).some((p) => !details[p.number]);
  const raw = canEdit ? prSuggestion(task, pulls, checks) : null;
  const suggestion = raw === 'complete' && ciUnknown ? null : raw;
  const open = pulls.find((p) => p.state === 'open');
  const merged = pulls.filter((p) => p.state === 'merged');
  const ci = overallChecks(known.map((d) => d.checks));
  const review = overallReview(known.filter((d) => pulls.find((p) => p.number === d.number)?.state === 'open').map((d) => d.review));
  const commitCount = known.reduce((n, d) => n + d.commits.length, 0);
  // 멈춤 판정과 같은 기준: 업무 변경·PR 수정·커밋 중 가장 최근.
  const last = [
    task.touchedAt ? new Date(task.touchedAt).toISOString() : '',
    ...pulls.map((p) => p.updatedAt),
    ...known.flatMap((d) => d.commits.map((c) => c.date)),
  ]
    .filter(Boolean)
    .map((v) => new Date(v).toISOString())
    .sort()
    .at(-1);
  // 이 PR이 본문 fixes로 닫는 이 업무의 출처 이슈(같은 저장소만).
  const fixedBy = (p: Pull) =>
    issues.filter((l) => (p.fixes ?? []).includes(l.number) && pullRepo(p.url) === l.repo.toLowerCase()).map((l) => l.number);
  const fixers = merged.filter((p) => fixedBy(p).length);
  const solved = [...new Set(fixers.flatMap(fixedBy))].sort((a, b) => a - b);
  const isSolved = (n: number) => solved.includes(n);
  // 이슈는 닫혔는데 업무는 남았다(GitHub 쪽에서 먼저 끝났거나 계획이 바뀜). 머지된 PR이 닫은 이슈는 완료 제안이 대신 알린다.
  // 완료 제안이 실제로 보일 때만 그 안내로 대신한다(팀원·다른 PR이 열림이면 닫힘 안내를 그대로 둔다).
  const replaced = (n: number) => suggestion === 'complete' && isSolved(n);
  const closedIssues = task.done
    ? []
    : (issueStatus ?? []).filter((s) => s.state === 'closed' && !replaced(s.number) && issues.some((l) => sameIssue(s, l)));
  // 상태를 확인한 열린 이슈만(조회 실패·찾을 수 없음은 단정하지 않는다).
  const openLeft = solved.length
    ? issues
        .filter((l) => !isSolved(l.number) && (issueStatus ?? []).some((s) => s.state === 'open' && sameIssue(s, l)))
        .map((l) => l.number)
    : [];
  const lastFixer = fixers.at(-1)?.number ?? 0;
  const loading = (n: number, i: number) => !details[n] && !detailError && i < DETAIL_MAX_PULLS;
  return (
    <section className="detail-section dev-panel" aria-label="개발 현황">
      <header className="dev-head">
        <h3>
          개발 현황 <span className="pr-ref">{taskRef(task.id)}</span>
        </h3>
        <button
          type="button"
          className="dev-branch"
          title="이 이름으로 브랜치를 만들면 PR이 이 업무에 연결돼요"
          onClick={() => void navigator.clipboard?.writeText(branch).then(() => setCopied(true))}
        >
          <GitBranch size={13} aria-hidden="true" />
          <code>{branch}</code>
          <span className="dev-branch-action">
            {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
            {copied ? '복사했어요' : '브랜치 이름 복사'}
          </span>
        </button>
      </header>
      <p className="detail-caption dev-hint">
        {issues.length
          ? `PR 제목·브랜치에 ${taskRef(task.id)}${josa(task.id, ['를', '을'])} 넣거나, 본문에 fixes #${issues[0].number}를 쓰면 이 업무에 연결돼요.`
          : `PR 제목이나 브랜치 이름에 이 번호(${taskRef(task.id)})를 넣으면 이 업무에 연결돼요.`}
      </p>

      {!!issues.length && <IssueList issues={issues} status={issueStatus} error={issueError} />}

      {!!pulls.length && (
        <dl className="dev-summary">
          <div>
            <dt>PR</dt>
            <dd>
              <b>{pulls.length}</b>
              <small>
                {[
                  open && `열림 ${pulls.filter((p) => p.state === 'open').length}`,
                  merged.length && `머지 ${merged.length}`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </small>
            </dd>
          </div>
          <div className={ci ? `is-${ci}` : undefined}>
            <dt>CI</dt>
            <dd>
              {ci ? <CheckIcon checks={ci} size={14} /> : null}
              <b>{ci ? CHECK_LABEL[ci].replace('CI ', '') : '…'}</b>
              {ci && known.length < pulls.length && <small>{`${known.length}/${pulls.length}개 기준`}</small>}
            </dd>
          </div>
          <div className={review ? `is-review-${review}` : undefined}>
            <dt>리뷰</dt>
            <dd>
              {review ? <ReviewIcon review={review} size={14} /> : null}
              <b>{review ? REVIEW_LABEL[review] : open ? '…' : '—'}</b>
            </dd>
          </div>
          <div>
            <dt>마지막 활동</dt>
            <dd>
              <b>{last ? ago(last, asOf) : '—'}</b>
              {!!commitCount && <small>커밋 {commitCount}</small>}
            </dd>
          </div>
        </dl>
      )}

      {stalled !== null && (
        <Callout
          tone="idle"
          icon={<PauseCircle size={16} />}
          title={`${stallText(stalled)}째 활동이 없어요`}
          body="막힌 곳이 있으면 체크인으로 남겨주세요."
        />
      )}
      {!!closedIssues.length && (
        <Callout
          tone="idle"
          icon={<CircleCheck size={16} />}
          title={`GitHub에서 닫힌 이슈가 있어요: ${closedIssues.map((s) => `#${s.number}`).join(', ')}`}
          body={
            closedIssues.some((s) => s.reason === 'not_planned')
              ? '계획 안 함으로 닫힌 이슈가 있어요. 이 업무를 계속할지 팀과 정해주세요.'
              : '업무도 끝났다면 완료 근거를 남기고 완료해주세요.'
          }
        />
      )}
      {suggestion === 'start' && open && (
        <Callout
          tone="go"
          icon={<GitPullRequest size={16} />}
          title={`열린 PR #${open.number}이 있어요. 진행 중으로 바꿀까요?`}
          action={
            <button type="button" className="btn" onClick={onStart}>
              진행 중으로 바꾸기 <ArrowRight size={14} aria-hidden="true" />
            </button>
          }
        />
      )}
      {suggestion === 'ci_failed' && (
        <Callout
          tone="warn"
          icon={<TriangleAlert size={16} />}
          title="PR이 머지됐지만 CI가 실패했어요. 확인이 필요해요."
          body="CI를 고친 뒤 다시 열면 완료 근거를 채울 수 있어요."
        />
      )}
      {suggestion === 'complete' && (
        <Callout
          tone="done"
          icon={<GitMerge size={16} />}
          title={
            solved.length
              ? `PR ${refs(fixers.map((p) => p.number))}${josa(lastFixer, ['가', '이'])} 머지되며 이슈 ${refs(solved)}${josa(solved.at(-1)!, ['를', '을'])} 해결했어요. 이걸 근거로 완료할까요?`
              : `PR ${merged.map((p) => `#${p.number}`).join(', ')}이(가) 머지됐어요. 이걸 근거로 완료할까요?`
          }
          body={openLeft.length ? `이슈 ${refs(openLeft)}${josa(openLeft.at(-1)!, ['는', '은'])} 아직 열려 있어요.` : undefined}
          action={
            <button
              type="button"
              className="btn primary"
              onClick={() => onUseEvidence(merged.map((p) => `PR #${p.number} ${p.title} ${p.url}`).join('\n'))}
            >
              완료 근거로 채우기
            </button>
          }
        />
      )}

      {pulls.length ? (
        <ul className="dev-prs">
          {pulls.map((p, i) => {
            const d = details[p.number];
            return (
              <li key={p.number} className={`dev-pr is-${p.state}`}>
                <details open={i === 0}>
                  <summary>
                    <span className={`dev-pr-icon pr-${p.state}`} title={PR_LABEL[p.state]}>
                      <PullIcon state={p.state} />
                    </span>
                    <span className="dev-pr-main">
                      <span className="dev-pr-title">
                        <a href={p.url} target="_blank" rel="noreferrer">
                          {p.title}
                        </a>
                        <span className="dev-pr-num">#{p.number}</span>
                      </span>
                      <span className="dev-pr-meta">
                        <span className={`pr-state pr-${p.state}`}>{PR_LABEL[p.state]}</span>
                        {p.branch && <code>{p.branch}</code>}
                        {!taskIdsIn(p.title, p.branch).includes(task.id) && !!fixedBy(p).length && (
                          <span className="dev-via">{`fixes ${refs(fixedBy(p))}${'036'.includes(String(fixedBy(p).at(-1)).at(-1)!) ? '으로' : '로'} 연결`}</span>
                        )}
                        {p.author && (
                          <span className="dev-who">
                            <Avatar login={p.author} />@{p.author}
                          </span>
                        )}
                        {p.updatedAt && <span>{ago(p.updatedAt, asOf)}</span>}
                      </span>
                    </span>
                    <span className="dev-pr-signals">
                      {d ? (
                        <>
                          <span className={`dev-signal pr-check-${d.checks}`}>
                            <CheckIcon checks={d.checks} />
                            {CHECK_LABEL[d.checks]}
                          </span>
                          <span className={`dev-signal pr-review-${d.review}`}>
                            <ReviewIcon review={d.review} />
                            {REVIEW_LABEL[d.review]}
                          </span>
                        </>
                      ) : loading(p.number, i) ? (
                        <span className="dev-signal is-loading">불러오는 중</span>
                      ) : null}
                    </span>
                    {!!d?.commits.length && <ChevronRight className="dev-chevron" size={14} aria-hidden="true" />}
                  </summary>
                  {!!d?.commits.length && (
                    <ol className="dev-commits" aria-label={`PR #${p.number} 최근 커밋`}>
                      {d.commits.map((c) => (
                        <li key={c.sha || c.date}>
                          <span className="dev-commit-msg">{c.message}</span>
                          <span className="dev-commit-meta">
                            <code>{c.sha.slice(0, 7)}</code>
                            {c.author && ` @${c.author}`}
                            {c.date && ` · ${ago(c.date, asOf)}`}
                          </span>
                        </li>
                      ))}
                    </ol>
                  )}
                </details>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="dev-empty">
          <GitPullRequest size={18} aria-hidden="true" />
          <div>
            <strong>연결된 PR이 없어요.</strong>
            <span>위 브랜치 이름으로 작업을 시작하면 PR과 CI·리뷰·커밋이 여기에 모여요.</span>
          </div>
        </div>
      )}
      {detailError && <p className="dev-error">{detailError}</p>}
    </section>
  );
}
