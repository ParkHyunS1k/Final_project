'use client';
// 프로젝트 탭(2026-11-16 재구성): 왼쪽은 합의한 목표와 프로젝트 완료, 오른쪽은 정보·저장소·팀원.
// 모집 도구(초대·공개 설정·관심 표시)는 자리가 남았을 때만. 권한·정원은 서버가 다시 검사한다.
import type { ReactNode } from 'react';
import { Check, Clock3 } from 'lucide-react';
import { ProjectDetails, TeamInvites } from '@/components/project-workspace';
import { TeamListing } from '@/components/team-directory';
import { MAX_MEMBERS } from '@/lib/sprint-policy';
import { sprintDay } from '@/lib/race';
import { seoulTime } from '@/lib/sprint';
import type { DashboardState, Deliverable, Lifecycle } from '@/components/project-dashboard';

const shortTime = (at: string) => seoulTime(at).slice(5).replace('-', '/');

export function ProjectOverview({
  state,
  lifecycle,
  phaseLabel,
  colors,
  writable,
  canEdit,
  busy,
  goalEditor,
  repo,
  teamExtra,
  inviteLink,
  setInviteLink,
  refresh,
  onFinish,
  onEvidence,
  onConfirm,
  onExport,
}: {
  state: DashboardState;
  lifecycle: Lifecycle;
  phaseLabel: string;
  colors: Record<number, string | undefined>;
  writable: boolean;
  /** writable이고 최신 목표에 동의한 사람. 근거 기록·확인 버튼에 쓴다. */
  canEdit: boolean;
  busy: boolean;
  goalEditor?: ReactNode;
  repo: ReactNode;
  teamExtra?: ReactNode;
  inviteLink: string;
  setInviteLink: (link: string) => void;
  refresh: () => Promise<unknown>;
  onFinish: () => void;
  onEvidence: (d: Deliverable) => void;
  onConfirm: (d: Deliverable) => void;
  onExport: () => void;
}) {
  const policy = state.policy;
  const isOwner = state.me.role === 'owner';
  const full = state.members.length >= MAX_MEMBERS;
  const recruiting = isOwner && writable && !full;
  // 꽉 찼어도 공개 중이거나 신청이 남아 있으면 공개 설정을 남겨 내리거나 거절할 수 있게 한다.
  const showListing = isOwner && writable && (!full || state.listed || (state.joinRequests?.length ?? 0) > 0);
  const { completion } = state;
  const tasksMode = policy?.completionMode === 'tasks';
  const percent = completion.total ? Math.round((completion.confirmed / completion.total) * 100) : 0;
  const finishDisabled = busy || !isOwner || lifecycle !== 'active' || !completion.ready;
  return (
    <section className="work-section project-layout">
      <div className="project-main">
        <ProjectDetails state={state} />
        {goalEditor}
        <section className="project-panel project-done">
          <span className="eyebrow">프로젝트 완료</span>
          {tasksMode ? (
            <>
              <h3>{`업무 ${completion.confirmed} / ${completion.total}`}</h3>
              <div className="done-bar" aria-hidden>
                <i style={{ width: `${percent}%` }} />
              </div>
              <p className="tiny muted">
                완료하고 근거를 남긴 업무 수예요. 모두 마치면 팀장이 완료를 기록할 수 있어요.
              </p>
              {completion.missing.length > 0 && (
                <ul className="done-left">
                  {completion.missing.slice(0, 5).map((title, i) => (
                    <li key={i}>{title}</li>
                  ))}
                  {completion.missing.length > 5 && <li>외 {completion.missing.length - 5}개</li>}
                </ul>
              )}
              <div className="hub-actions">
                <a className="btn" href={'/app?tab=experience&project=' + encodeURIComponent(state.projectId)}>
                  나의 경험으로 가져오기
                </a>
                <button className="btn primary" disabled={finishDisabled} onClick={onFinish}>
                  {lifecycle === 'completed' ? '완료 기록 저장됨' : '프로젝트 완료 기록'}
                </button>
              </div>
            </>
          ) : (
            <>
              <h3>{`합의한 결과물 ${completion.confirmed} / ${completion.total}`}</h3>
              {state.deliverables.map((d) => (
                <div className="criterion" key={d.deliverableId}>
                  <span className={d.confirmed ? 'criteria-check ok' : 'criteria-check'}>
                    {d.confirmed ? <Check size={16} /> : <Clock3 size={16} />}
                  </span>
                  <div>
                    <b>{d.title}</b>
                    <p>{d.evidence || '근거가 아직 없습니다.'}</p>
                    {canEdit && (
                      <>
                        <button className="text-link" disabled={busy} onClick={() => onEvidence(d)}>
                          근거 기록·수정
                        </button>
                        {isOwner && (
                          <button className="text-link" disabled={busy || !d.evidence} onClick={() => onConfirm(d)}>
                            {d.confirmed ? '확인 취소' : '팀장이 직접 확인'}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              ))}
              <div className="hub-actions">
                <button className="btn primary" disabled={finishDisabled} onClick={onFinish}>
                  {lifecycle === 'completed' ? '완주 기록 저장됨' : '기한 내 완주 확인'}
                </button>
              </div>
              <p className="tiny muted">
                확인 자료는 코드 저장소와 실행 방법, 핵심 기능 데모 또는 영상, 팀원별 기여 내용입니다. 배포 URL은
                프로젝트에서 별도 합의한 경우에만 필요합니다.
              </p>
            </>
          )}
        </section>
      </div>
      <aside className="project-side">
        <section className="project-panel project-info">
          <h3>프로젝트 정보</h3>
          <dl>
            <dt>상태</dt>
            <dd>
              {phaseLabel +
                (lifecycle === 'active' && policy?.startedAt
                  ? ` · DAY ${sprintDay(policy.startedAt, Date.parse(state.asOf), policy.durationDays)}/${policy.durationDays}`
                  : '')}
            </dd>
            {policy && (
              <>
                <dt>기간</dt>
                <dd>
                  {policy.startedAt && policy.deadlineAt
                    ? `${shortTime(policy.startedAt)} ~ ${shortTime(policy.deadlineAt)}`
                    : `시작한 시각부터 ${policy.durationDays}일`}
                </dd>
              </>
            )}
            <dt>저장소</dt>
            <dd>{repo}</dd>
          </dl>
        </section>
        <section className="project-panel project-team">
          <h3>
            팀원 <span>{`${state.members.length}/${MAX_MEMBERS}`}</span>
          </h3>
          <ul className="team-rows">
            {state.members.map((m) => {
              // 2026-10-15에 참여 중단 기능을 뺐다. 그 전에 남은 기록만 표시한다.
              const flag = m.left_at
                ? '참여 중단'
                : policy && m.agreed_goal_version !== policy.goalVersion
                  ? '재동의 필요'
                  : '';
              return (
                <li key={m.person}>
                  <span className="avatar" style={{ background: colors[m.person] ?? '#e2e2de' }}>
                    {m.display_name.slice(0, 1)}
                  </span>
                  <span className="team-name">
                    <b>{m.display_name}</b>
                    {m.github_login && (
                      <a href={'https://github.com/' + m.github_login} target="_blank" rel="noreferrer">
                        {`@${m.github_login}`}
                      </a>
                    )}
                  </span>
                  {flag ? (
                    <span className="team-flag">{flag}</span>
                  ) : (
                    <span className="team-role">{m.role === 'owner' ? '팀장' : '팀원'}</span>
                  )}
                </li>
              );
            })}
          </ul>
          {isOwner && writable && full && <p className="tiny muted">모집 마감 · 자리가 다 찼어요</p>}
          {recruiting && (
            <TeamInvites state={state} refresh={refresh} link={inviteLink} setLink={setInviteLink} writable={writable} />
          )}
          {showListing && <TeamListing state={state} refresh={refresh} writable={writable} />}
          {recruiting && teamExtra}
        </section>
        <button className="text-link project-export" disabled={busy} onClick={onExport}>
          내보내기
        </button>
      </aside>
    </section>
  );
}
