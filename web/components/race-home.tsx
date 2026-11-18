'use client';
import { ArrowRight } from 'lucide-react';
import { DeadlineCalendar } from '@/components/deadline-calendar';
import type { ProjectMeta } from '@/components/project-workspace';
import { useFineServerNow, useServerNow } from '@/hooks/use-server-now';
import {
  dueLabel,
  focusClock,
  focusCentis,
  focusTask,
  laneTask,
  tension,
  waitReason,
} from '@/lib/race';
import { seoulTime, type Task as ServerTask } from '@/lib/sprint';
import type { Lifecycle } from '@/lib/sprint-policy';
import type { Wire } from '@/lib/wire';

export { DeadlineCalendar };

type Task = Wire<ServerTask>;

const WAIT_LABEL = {
  done: '내 업무 모두 완료 · 대기 중',
  undated: '마감이 정해진 내 업무 없음 · 대기 중',
  unassigned: '배정된 내 업무 없음 · 대기 중',
};

// 큰 숫자. 이 조각만 화면 새로고침마다 다시 그려 0.01초까지 흐르게 한다(2026-11-12 피드백).
function BigClock({
  target,
  now,
  asOf,
  className,
}: {
  target: number;
  now: number;
  asOf: string | null;
  className: string;
}) {
  const fine = useFineServerNow(asOf, now);
  const left = target - fine;
  const clock = focusClock(left);
  return (
    <div className={className} role="timer">
      {clock.slice(0, -2)}
      <span className="focus-sec" key={clock.slice(-2)}>
        {clock.slice(-2)}
      </span>
      <span className="focus-cs">.{focusCentis(left)}</span>
    </div>
  );
}

// 내 업무 중 마감이 가장 가까운 업무를 크게 센다. now는 서버 기준 시각이다.
export function FocusCountdown({
  tasks,
  person,
  now,
  deadline,
  asOf = null,
}: {
  tasks: Task[];
  person: number;
  now: number;
  /** 프로젝트 마감. 마감 정해진 내 업무가 없으면 이것을 센다(시안 v7·v9). 긴장 효과는 없다. */
  deadline?: string | null;
  /** 있으면 숫자만 화면 새로고침마다 다시 그려 0.01초까지 흐르게 한다. */
  asOf?: string | null;
}) {
  const task = focusTask(tasks, person);
  if (!task && deadline) {
    return (
      <section className="focus-hero" aria-label="프로젝트 마감">
        <p className="focus-label">
          <em>프로젝트 마감</em>까지
        </p>
        <BigClock target={Date.parse(deadline)} now={now} asOf={asOf} className="focus-clock project" />
      </section>
    );
  }
  if (!task)
    return (
      <section className="focus-hero" aria-label="내 업무 마감">
        <p className="focus-label">{WAIT_LABEL[waitReason(tasks, person)]}</p>
        <div className="focus-clock idle">대기 중</div>
      </section>
    );
  const left = Date.parse(task.dueAt!) - now;
  const { stage } = tension(left);
  return (
    <section className="focus-hero" aria-label="내 업무 마감">
      <p className="focus-label">
        <em>{task.title}</em> {stage === 'over' ? '마감 초과' : '마감까지'}
      </p>
      <BigClock target={Date.parse(task.dueAt!)} now={now} asOf={asOf} className={`focus-clock ${stage}`} />
    </section>
  );
}

type FeedCheckin = {
  id?: string;
  task_id: number;
  note?: string;
  remaining?: number;
  created_at: string;
  report_id?: string | null;
  blocker?: string | null;
  /** 보고 당시 담당자·작성자·완료 여부(0014). 예전 체크인은 없어서 지금 담당자로 본다. */
  person?: number | null;
  author_person?: number | null;
  done?: boolean;
};
const kstDay = (iso: string) => seoulTime(iso).slice(0, 10);
const kstClock = (iso: string) => seoulTime(iso).slice(11, 16);
const kstStamp = (iso: string) => `${seoulTime(iso).slice(5, 10).replace('-', '/')} ${kstClock(iso)}`;

// ponytail: 서버 상태의 checkins는 프로젝트 전체 최근 60줄(보고 한 번 = 업무 수만큼 줄). 넘치면 오래된 '마지막 기록'이 빠진다. 필요하면 서버에서 멤버별 마지막 보고를 내려준다.
/** 이 사람(담당 업무 기준)의 마지막 보고. 오늘의 랩 기록이면 같은 report_id 줄을 모두, 예전 체크인이면 그 한 줄. */
function lastReport(checkins: FeedCheckin[], tasks: Task[], person: number) {
  const mine = checkins
    .filter((c) => (c.person ?? tasks.find((t) => t.id === c.task_id)?.person) === person)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  if (!mine.length) return null;
  const key = (c: FeedCheckin) => c.report_id ?? c.id ?? c.created_at;
  const head = mine[0];
  return { at: head.created_at, note: head.note ?? '', rows: mine.filter((c) => key(c) === key(head)) };
}

// 오늘의 랩 기록 피드(2026-11-16). 체크인 여부만 보이던 목록을 서로의 오늘 기록을 읽는 피드로 바꿨다.
export function TeamCheckins({
  members,
  me,
  tasks,
  checkins,
  now,
  active,
}: {
  members: ProjectMeta['members'];
  me: ProjectMeta['me'];
  tasks: Task[];
  checkins: FeedCheckin[];
  now: number;
  /** 진행 중일 때만 오늘 기록 여부를 묻는다. */
  active: boolean;
}) {
  const today = kstDay(new Date(now).toISOString());
  const entries = members
    .filter((m) => !m.left_at)
    .map((m, order) => {
      const report = lastReport(checkins, tasks, m.person);
      return { m, order, report, today: !!report && kstDay(report.at) === today };
    })
    // 오늘 기록한 사람이 먼저(최근 순), 나머지는 원래 순서.
    .sort((a, b) =>
      a.today !== b.today ? (a.today ? -1 : 1) : a.today ? b.report!.at.localeCompare(a.report!.at) : a.order - b.order,
    );
  const reported = entries.filter((e) => e.today).length;
  const blocked = entries.reduce((n, e) => n + (e.today ? e.report!.rows.filter((r) => r.blocker).length : 0), 0);
  return (
    <section className="lap-feed">
      <div className="section-heading task-heading">
        <h2>오늘의 랩 기록</h2>
        {active && (
          <span className="tiny muted">
            {`${reported} / ${entries.length}명 기록 · 오늘(KST)`}
            {blocked > 0 && <b className="lap-feed-count">{`막힘 ${blocked}`}</b>}
          </span>
        )}
      </div>
      <ul className="lap-feed-list">
        {entries.map(({ m, report, today: done }) => {
          // 기록이 없으면 카운트다운과 같은 업무(가장 가까운 마감)를 보여준다.
          const lane = focusTask(tasks, m.person) ?? laneTask(tasks, m.person);
          const rows = report?.rows ?? [];
          const left = rows.reduce((n, r) => n + (r.remaining ?? 0), 0);
          // 완료 수는 그 보고 당시 값(나중에 완료·재개돼도 그날 기록은 그대로).
          const finished = rows.filter((r) => r.done).length;
          const author = rows.find((r) => r.author_person != null && r.author_person !== m.person)?.author_person;
          const authorName = author == null ? null : members.find((x) => x.person === author)?.display_name;
          return (
            <li key={m.person} className={`lap-feed-item${done ? ' is-today' : ''}`}>
              <span className="lap-feed-avatar" aria-hidden="true">
                {m.display_name.slice(0, 1)}
              </span>
              <div className="lap-feed-main">
                <div className="lap-feed-who">
                  <b>{m.display_name}</b>
                  {m.person === me.person && <small>나</small>}
                  <small>{done ? kstClock(report!.at) : report ? `마지막 기록 ${kstStamp(report.at)}` : '기록 없음'}</small>
                  {done && authorName && <small>{`${authorName}님이 대신 기록`}</small>}
                  {active && !done && <span className="lap-feed-tag">아직 안 함</span>}
                  {active && done && rows.some((r) => r.blocker) && <span className="lap-feed-tag is-blocked">막힘</span>}
                </div>
                {report?.note && <p className={done ? 'lap-feed-note' : 'lap-feed-note is-old'}>{report.note}</p>}
                {done &&
                  rows
                    .filter((r) => r.blocker)
                    .map((r) => (
                      <p key={r.task_id} className="lap-feed-blocker">
                        {`PM-${r.task_id} · ${r.blocker}`}
                      </p>
                    ))}
                {done ? (
                  <div className="lap-feed-facts">
                    <span>{`업무 ${rows.length}개`}</span>
                    <span>{`남은 ${left}h`}</span>
                    {finished > 0 && <span>{`완료 ${finished}`}</span>}
                  </div>
                ) : (
                  <p className="lap-feed-lane">
                    {lane ? `지금 업무 · ${lane.title} · ${dueLabel(lane.dueAt)}` : '진행 중인 업무 없음'}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// 홈 = 내 업무 마감 카운트다운 + 일차별 마감. 체크인 현황·회의 제안은 page.tsx가 아래에 둔다.
export function RaceHome({
  lifecycle,
  asOf,
  startedAt,
  deadline,
  tasks,
  me,
  people,
  onTasks,
}: {
  lifecycle: Lifecycle;
  asOf: string;
  startedAt: string | null;
  deadline: string | null;
  tasks: Task[];
  me: ProjectMeta['me'];
  people: { name: string }[];
  onTasks: () => void;
}) {
  const active = lifecycle === 'active';
  const live = useServerNow(active ? asOf : null);
  const now = live || Date.parse(asOf);
  return (
    <>
      {!tasks.length ? (
        <div className="race-alert calm">
          <div>
            <b>업무가 아직 없습니다.</b> 업무와 담당자를 등록하면 마감까지 남은 시간을 셉니다.
            <button className="text-link" onClick={onTasks}>
              업무로 이동 <ArrowRight size={15} />
            </button>
          </div>
        </div>
      ) : (
        active && (
          <FocusCountdown tasks={tasks} person={me.person} now={now} deadline={deadline} asOf={asOf} />
        )
      )}
      <DeadlineCalendar
        startedAt={startedAt}
        deadline={deadline}
        now={now}
        tasks={tasks}
        people={people}
        active={active}
      />
    </>
  );
}
