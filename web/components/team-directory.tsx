'use client';
// 공개 팀 목록(사이드바 '팀 찾기')과 팀장의 공개·참여 신청 관리. 규칙: docs/superpowers/specs/2026-10-15-team-list-join-design.md
// 참여 가능 여부·인원·목표 버전은 서버가 판단한다. 화면은 받은 값을 보여주고 결과를 다시 불러온다.
// 2026-11-16 재구성: 내 신청을 위로, 팀은 카드 격자로 훑고, 목표 확인과 신청은 패널에서. 템플릿 팀도 같은 '참여 신청'(B안).
import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { apiFetch } from '@/lib/supabase-browser';
import { restrictionMessage, type RestrictionView } from '@/lib/score';
import { skillName } from '@/lib/career/catalog';
import { sprintDay } from '@/lib/race';
import { PageHeader } from './page-header';

export type Team = {
  projectId: string;
  title: string;
  goal: string;
  scope: string;
  completionCriteria: string;
  /** 템플릿 업무의 기술(4개까지). 직접 만든 팀은 빈 목록. */
  skills: string[];
  lifecycle: 'draft' | 'active';
  goalVersion: number;
  members: number;
  maxMembers: number;
  startedAt: string | null;
  deadlineAt: string | null;
  joinUntil: string | null;
  joinable: boolean;
  requested: boolean;
};
export type JoinRequest = {
  requestId: string;
  projectId: string;
  title: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled' | 'expired';
  createdAt: string;
};
const STATUS: Record<JoinRequest['status'], string> = {
  pending: '확인 대기',
  approved: '승인됨',
  rejected: '거절됨',
  cancelled: '취소함',
  expired: '신청 마감',
};
const kst = (at: string) =>
  new Date(at).toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
/** 진행 중 팀의 신청이 이보다 적게 남으면 강조한다. */
const URGENT_MS = 3 * 3_600_000;
const DAY_MS = 86_400_000;

export type TeamFilter = 'all' | 'draft' | 'active';
/** 상태·자리 필터. 신청할 수 없는 팀(꽉 참·이미 신청함 등)은 맨 뒤로 보낸다. */
export function visibleTeams(teams: Team[], filter: TeamFilter, seatsOnly: boolean) {
  const shown = teams.filter(
    (t) => (filter === 'all' || t.lifecycle === filter) && (!seatsOnly || t.members < t.maxMembers),
  );
  return [...shown.filter((t) => t.joinable), ...shown.filter((t) => !t.joinable)];
}

/** 홈 '함께 달리고 있는 팀' 카드의 버튼. 신청은 팀 찾기 패널 한 곳에서 한다. */
export function homeTeamAction(t: { joined: boolean; join_open: boolean; members: number }) {
  if (t.joined) return 'open';
  if (!t.join_open) return 'closed';
  return t.members >= 4 ? 'full' : 'apply';
}

function leftText(ms: number) {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h}시간${m ? ` ${m}분` : ''}` : `${m}분`;
}

function TeamState({ team, now }: { team: Team; now: number }) {
  const days =
    team.startedAt && team.deadlineAt
      ? Math.round((Date.parse(team.deadlineAt) - Date.parse(team.startedAt)) / DAY_MS)
      : 7;
  return team.lifecycle === 'active' && team.startedAt ? (
    <span className="pill orange">{`진행 중 · DAY ${sprintDay(team.startedAt, now, days)}`}</span>
  ) : (
    <span className="pill">준비 중</span>
  );
}

function Seats({ team }: { team: Team }) {
  return (
    <span className="team-seats" aria-label={`인원 ${team.members}/${team.maxMembers}명`}>
      {Array.from({ length: team.maxMembers }, (_, i) => (
        <i key={i} className={i < team.members ? 'seat on' : 'seat'} aria-hidden="true" />
      ))}
      <em>{`${team.members}/${team.maxMembers}`}</em>
    </span>
  );
}

function TeamTime({ team, now }: { team: Team; now: number }) {
  if (!team.deadlineAt || !team.joinUntil)
    return (
      <div className="team-time">
        <span>시작 전</span>
        <b>시작하면 7일</b>
      </div>
    );
  const left = Date.parse(team.joinUntil) - now;
  return (
    <div className={left < URGENT_MS ? 'team-time urgent' : 'team-time'}>
      <span>{`${kst(team.deadlineAt)} 마감`}</span>
      <b>{team.members >= team.maxMembers ? '자리 없음' : `신청 마감 ${leftText(left)}`}</b>
    </div>
  );
}

function Skills({ skills }: { skills: string[] }) {
  return (
    <div className="team-tags">
      {skills.length ? skills.map((s) => <span key={s}>{skillName(s)}</span>) : <span>직접 만든 팀</span>}
    </div>
  );
}

const closedLabel = (t: Team) =>
  t.requested ? '신청함 · 확인 대기' : t.members >= t.maxMembers ? '인원 마감' : '신청 불가';

/** 훑어보기용 카드. 기능 범위·완료 기준 전문은 패널에서 읽는다. */
export function TeamCard({
  team,
  now,
  busy,
  restricted,
  onOpen,
}: {
  team: Team;
  now: number;
  busy: boolean;
  restricted: boolean;
  onOpen: () => void;
}) {
  return (
    <li className={team.joinable ? 'team-card' : 'team-card is-closed'}>
      <div className="team-card-top">
        <TeamState team={team} now={now} />
        <Seats team={team} />
      </div>
      <h2>{team.title}</h2>
      <p className="team-goal">{team.goal}</p>
      <Skills skills={team.skills} />
      <TeamTime team={team} now={now} />
      <button className="btn wide" disabled={!team.joinable || busy || restricted} onClick={onOpen}>
        {team.joinable ? '자세히 보고 신청' : closedLabel(team)}
      </button>
    </li>
  );
}

/** 목표 확인과 참여 신청. 데스크톱은 오른쪽 패널, 좁은 화면은 아래 시트(CSS). Esc·닫기 버튼으로 닫는다. */
export function TeamPanel({
  team,
  now,
  agreed,
  busy,
  restricted,
  onAgree,
  onSubmit,
  onClose,
}: {
  team: Team;
  now: number;
  agreed: boolean;
  busy: boolean;
  restricted: boolean;
  onAgree: (agreed: boolean) => void;
  onSubmit: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="team-panel"
      aria-labelledby="team-panel-title"
      onClose={onClose}
    >
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        <button type="button" className="team-panel-close" aria-label="닫기" onClick={onClose}>
          <X size={18} aria-hidden="true" />
        </button>
        <div className="team-card-top">
          <TeamState team={team} now={now} />
          <Seats team={team} />
        </div>
        <h2 id="team-panel-title">{team.title}</h2>
        <TeamTime team={team} now={now} />
        <section>
          <h3>{`목표 v${team.goalVersion}`}</h3>
          <p>{team.goal}</p>
        </section>
        <section>
          <h3>기능 범위</h3>
          <p>{team.scope}</p>
        </section>
        <section>
          <h3>완료 기준</h3>
          {/* 템플릿 팀은 따로 적은 완료 기준 없이 업무 완료·근거로 끝낸다(completion_mode=tasks). */}
          <p>{team.completionCriteria || '모든 업무를 완료하고 근거를 남기면 팀장이 완료를 기록해요.'}</p>
        </section>
        {team.skills.length > 0 && (
          <section>
            <h3>필요한 기술</h3>
            <Skills skills={team.skills} />
          </section>
        )}
        <label className="agreement">
          <input type="checkbox" checked={agreed} onChange={(e) => onAgree(e.target.checked)} />
          {`목표 v${team.goalVersion}·기능 범위·완료 기준을 확인했고, 이 목표로 참여를 신청합니다.`}
        </label>
        <button className="btn primary wide" disabled={!agreed || busy || restricted}>
          참여 신청 보내기
        </button>
        <p className="tiny muted">
          팀장이 승인하면 이 프로젝트가 홈에 나타나요. 팀장에게는 이름과 로그인 이메일이 전달돼요. 대기 신청은 5개까지예요.
        </p>
      </form>
    </dialog>
  );
}

const FILTERS: { id: TeamFilter; label: string }[] = [
  { id: 'all', label: '전체' },
  { id: 'draft', label: '준비 중' },
  { id: 'active', label: '진행 중' },
];

function withTeam(list: Team[] | null, fresh: Team) {
  return list?.map((t) => (t.projectId === fresh.projectId ? { ...t, ...fresh } : t)) ?? null;
}

async function call<T>(path: string, body?: Record<string, unknown>) {
  const res = await apiFetch(path, {
    cache: 'no-store',
    ...(body
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : {}),
  });
  const data = (await res.json()) as T & { error?: string; details?: Team };
  if (!res.ok) {
    const failure = new Error(
      res.status === 401 ? '로그인이 필요합니다.' : data.error || '처리하지 못했습니다.',
    ) as Error & { details?: Team };
    if (res.status === 409 && data.details) failure.details = data.details;
    throw failure;
  }
  return data;
}


export function TeamDirectory({
  restriction = null,
  initialTeam = '',
}: {
  restriction?: RestrictionView | null;
  /** 홈 카드에서 고른 팀. 목록에 있으면 그 팀 패널을 바로 연다. */
  initialTeam?: string;
} = {}) {
  const [teams, setTeams] = useState<Team[] | null>(null);
  const [requests, setRequests] = useState<JoinRequest[]>([]);
  const [open, setOpen] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [filter, setFilter] = useState<TeamFilter>('all');
  const [seatsOnly, setSeatsOnly] = useState(false);
  // 남은 신청 시간 표시용. 목록을 받을 때 다시 잰다(서버 판단과 별개인 안내).
  const [now, setNow] = useState(0);
  // 처음 열 때와 신청·취소 뒤에 서버 목록을 다시 받는다.
  function load() {
    return call<{ teams: Team[]; requests: JoinRequest[] }>('/api/teams').then((data) => {
      setTeams(data.teams);
      setRequests(data.requests);
      setNow(Date.now());
      return data;
    });
  }
  useEffect(() => {
    call<{ teams: Team[]; requests: JoinRequest[] }>('/api/teams')
      .then((data) => {
        setTeams(data.teams);
        setRequests(data.requests);
        setNow(Date.now());
        if (!initialTeam) return;
        const chosen = data.teams.find((t) => t.projectId === initialTeam);
        if (chosen?.joinable) setOpen(chosen.projectId);
        else if (chosen?.requested) setMessage('이미 참여를 신청한 팀이에요. 위 내 신청에서 상태를 볼 수 있어요.');
        else setMessage('이 팀은 지금 참여 신청을 받지 않아요.');
      })
      .catch((e: Error) => setMessage(e.message));
  }, [initialTeam]);
  async function run(work: () => Promise<unknown>, done: string) {
    setBusy(true);
    setMessage('');
    try {
      await work();
      setOpen('');
      setAgreed(false);
      // 목록을 다시 받은 뒤에 결과를 알린다. 안내와 화면 상태가 어긋나지 않게.
      await load();
      setMessage(done);
    } catch (e) {
      const changed = (e as { details?: Team }).details;
      // 저장 시점에 목표가 바뀌었으면 최신 목표로 다시 확인받는다(패널은 열어 둔다).
      if (changed) {
        setTeams(withTeam(teams, changed));
        setAgreed(false);
      }
      setMessage((e as Error).message);
      await load().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }
  const cancel = (r: { requestId: string }) =>
    void run(() => call('/api/teams', { action: 'cancel', requestId: r.requestId }), '신청을 취소했습니다.');
  const chosen = teams?.find((t) => t.projectId === open);
  const count = (f: TeamFilter) => (teams ?? []).filter((t) => f === 'all' || t.lifecycle === f).length;
  const shown = visibleTeams(teams ?? [], filter, seatsOnly);
  return (
    <section className="team-directory">
      <PageHeader
        title="팀 찾기"
        description="공개된 팀에 참여를 신청하면 팀장이 승인해요. 진행 중인 팀은 시작 후 24시간까지만 받아요."
      />
      {restriction && (
        <output className="hint restriction-hint">{restrictionMessage(restriction, '참여 신청할')}</output>
      )}
      {message && <output className="hint">{message}</output>}
      <MyRequests requests={requests} busy={busy} onCancel={cancel} />
      {teams === null ? (
        <p className="tiny muted">팀 목록을 불러오는 중입니다.</p>
      ) : !teams.length ? (
        <p className="muted">지금 합류할 수 있는 공개 팀이 없습니다.</p>
      ) : (
        <>
          <div className="team-filters">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                className={filter === f.id ? 'team-chip on' : 'team-chip'}
                aria-pressed={filter === f.id}
                onClick={() => setFilter(f.id)}
              >
                {f.label} <i>{count(f.id)}</i>
              </button>
            ))}
            <label className="team-seats-only">
              <input type="checkbox" checked={seatsOnly} onChange={(e) => setSeatsOnly(e.target.checked)} />
              자리 있는 팀만
            </label>
          </div>
          {shown.length ? (
            <ul className="team-grid">
              {shown.map((t) => (
                <TeamCard
                  key={t.projectId}
                  team={t}
                  now={now}
                  busy={busy}
                  restricted={Boolean(restriction)}
                  onOpen={() => {
                    setOpen(t.projectId);
                    setAgreed(false);
                  }}
                />
              ))}
            </ul>
          ) : (
            <p className="muted">조건에 맞는 팀이 없어요.</p>
          )}
        </>
      )}
      {chosen && (
        <TeamPanel
          key={chosen.projectId}
          team={chosen}
          now={now}
          agreed={agreed}
          busy={busy}
          restricted={Boolean(restriction)}
          onAgree={setAgreed}
          onClose={() => setOpen('')}
          onSubmit={() =>
            void run(
              () =>
                call('/api/teams', {
                  action: 'request',
                  projectId: chosen.projectId,
                  // 이 화면에서 실제로 확인한 목표 버전을 보낸다.
                  goalVersion: chosen.goalVersion,
                  agreed,
                }),
              `${chosen.title}에 참여를 신청했습니다. 팀장이 승인하면 홈에 나타납니다.`,
            )
          }
        />
      )}
    </section>
  );
}

// 내 신청. 대기·승인은 맨 위 띠에, 거절·취소·마감은 '지난 신청'으로 접는다.
// 팀이 비공개로 바뀌어 카드가 사라져도 대기 신청은 여기서 취소할 수 있어야 한다(대기 신청은 사용자당 한도를 차지한다).
export function MyRequests({
  requests,
  busy,
  onCancel,
}: {
  requests: JoinRequest[];
  busy: boolean;
  onCancel: (r: JoinRequest) => void;
}) {
  if (!requests.length) return null;
  const live = requests.filter((r) => r.status === 'pending' || r.status === 'approved');
  const past = requests.filter((r) => !live.includes(r));
  return (
    <section className="team-mine" aria-label="내 신청">
      {live.length > 0 && (
        <ul>
          {live.map((r) => (
            <li key={r.requestId}>
              <span className={r.status === 'approved' ? 'pill green' : 'pill orange'}>{STATUS[r.status]}</span>
              <b>{r.title}</b>
              <small>{`${kst(r.createdAt)} 신청`}</small>
              {r.status === 'pending' ? (
                <button className="text-link" disabled={busy} onClick={() => onCancel(r)}>
                  신청 취소
                </button>
              ) : (
                <a className="btn primary" href={'/app?tab=work&project=' + encodeURIComponent(r.projectId)}>
                  프로젝트 열기
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
      {past.length > 0 && (
        <details>
          <summary>{`지난 신청 ${past.length}`}</summary>
          <ul>
            {past.map((r) => (
              <li key={r.requestId}>
                <span className="pill">{STATUS[r.status]}</span>
                <b>{r.title}</b>
                <small>{`${kst(r.createdAt)} 신청`}</small>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

export type Interest = {
  user_id: string;
  display_name: string;
  email: string | null;
  created_at: string;
  invited: boolean;
};

// 팀장 전용: 홈 공개 모집에서 관심을 보낸 사람과 초대(관심 표시 → 팀장 초대). 공개 설정 바로 아래, 프로젝트 탭 팀원 구역에 둔다.
export function InterestList({
  interests,
  busy,
  onInvite,
}: {
  interests: Interest[];
  busy: boolean;
  onInvite: (userId: string) => void;
}) {
  if (!interests.length) return null;
  return (
    <div className="team-interests">
      <h3>홈에서 관심을 보낸 사람 {interests.length}명</h3>
      <p className="hint">초대를 보내면 상대방 홈에 초대가 도착해요. 팀 합류는 상대방이 목표를 확인한 뒤 확정돼요.</p>
      <ul>
        {interests.map((i) => (
          <li key={i.user_id}>
            <span>
              {i.display_name} · {kst(i.created_at)} 관심
            </span>
            <button className="btn" disabled={busy || !i.email} onClick={() => onInvite(i.user_id)}>
              {i.invited ? '초대 상태 확인·재발급' : '초대 보내기'}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// 팀장 전용: 팀 목록 공개와 들어온 참여 신청 처리. 프로젝트 메뉴의 팀원 구역에 둔다.
export function TeamListing({
  state,
  refresh,
  writable,
}: {
  state: {
    projectId: string;
    me: { role: string };
    sprint: { revision: number };
    listed?: boolean;
    joinRequests?: { id: string; display_name: string; goal_version: number; created_at: string; restricted?: boolean }[];
    policy?: { goalVersion: number } | null;
  };
  refresh: () => Promise<unknown>;
  writable: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  if (state.me.role !== 'owner' || !state.policy) return null;
  async function run(body: Record<string, unknown>, done: string) {
    setBusy(true);
    setMessage('');
    try {
      await call('/api/projects', { projectId: state.projectId, revision: state.sprint.revision, ...body });
      await refresh();
      setMessage(done);
    } catch (e) {
      await refresh();
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const requests = state.joinRequests ?? [];
  return (
    <div className="team-listing">
      <label className="agreement">
        <input
          type="checkbox"
          checked={Boolean(state.listed)}
          disabled={busy || !writable}
          onChange={(e) =>
            void run(
              { action: 'setListed', listed: e.target.checked },
              e.target.checked ? '팀 찾기 목록에 공개했습니다.' : '팀 찾기 목록에서 내렸습니다.',
            )
          }
        />
        팀 찾기와 홈 공개 모집에 공개 (이름·목표·범위·완료 기준·인원·기술 태그·남은 기간이 보입니다)
      </label>
      {requests.length > 0 && (
        <ul>
          {requests.map((r) => (
            <li key={r.id}>
              {r.display_name} · {kst(r.created_at)} 신청
              {state.policy && r.goal_version !== state.policy.goalVersion && ' · 이전 목표에 동의(승인 후 재동의 필요)'}
              {r.restricted && ' · 이 사람은 지금 참여할 수 없어요'}{' '}
              <button
                className="btn primary"
                disabled={busy || !writable || Boolean(r.restricted)}
                onClick={() => void run({ action: 'decideJoin', requestId: r.id, approve: true }, `${r.display_name}님을 팀원으로 받았습니다.`)}
              >
                승인
              </button>{' '}
              <button
                className="btn"
                disabled={busy || !writable}
                onClick={() => void run({ action: 'decideJoin', requestId: r.id, approve: false }, '신청을 거절했습니다.')}
              >
                거절
              </button>
            </li>
          ))}
        </ul>
      )}
      {message && <output>{message}</output>}
    </div>
  );
}
