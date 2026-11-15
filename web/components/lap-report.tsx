'use client';
// 오늘의 랩 기록(2026-11-16): 진행 보고 패널. 내 미완료 업무를 한 장에 놓고 상태·남은 시간만 고른다.
// 벤치마킹: Geekbot·Standuply(막힌 점 따로), Range(연동 활동을 칩으로), Linear(오른쪽 패널로 맥락 유지).
import { useState } from 'react';
import { CircleCheck, CircleDot, OctagonAlert, GitPullRequest } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { taskRef, type Pull } from '@/lib/github-prs';
import { seoulTime } from '@/lib/sprint';

type Task = { id: number; title: string; remaining: number };
export type RowStatus = 'progress' | 'blocked' | 'done';
export type Row = { status: RowStatus; remaining: number; blocker: string; evidence: string };
export type Chip = { number: number; label: string; text: string };
export type ReportItemInput =
  | { taskId: number; remaining: number; blocker?: string }
  | { taskId: number; done: true; evidence: string };

const STATUS: { id: RowStatus; label: string }[] = [
  { id: 'progress', label: '진행' },
  { id: 'blocked', label: '막힘' },
  { id: 'done', label: '완료' },
];

/** 남은 시간 빠른 선택. 서버와 같은 0.5시간 단위. */
export function quickHours(current: number, kind: 'minus' | 'half' | 'almost') {
  if (kind === 'minus') return Math.max(0, current - 1);
  if (kind === 'half') return Math.max(0.5, Math.round(current) / 2);
  return Math.min(current, 0.5);
}

export function reportItems(rows: Record<number, Row>, tasks: Task[]): ReportItemInput[] {
  return tasks.map((t) => {
    const r = rows[t.id];
    if (r.status === 'done') return { taskId: t.id, done: true, evidence: r.evidence.trim() };
    return r.status === 'blocked'
      ? { taskId: t.id, remaining: r.remaining, blocker: r.blocker.trim() }
      : { taskId: t.id, remaining: r.remaining };
  });
}

/** 저장 버튼을 막는 첫 이유. 없으면 null. */
export function blockReason(rows: Record<number, Row>, tasks: Task[], note: string) {
  if (!note.trim()) return '오늘 한 일을 적어주세요.';
  for (const t of tasks) {
    const r = rows[t.id];
    if (r.status === 'blocked' && !r.blocker.trim()) return `"${t.title}"의 막힌 점을 적어주세요.`;
    if (r.status === 'done' && r.evidence.trim().length < 5) return `"${t.title}"의 완료 근거를 5자 이상 적어주세요.`;
  }
  return null;
}

const day = (iso: string) => seoulTime(iso).slice(0, 10);
const PR_WORD = { merged: '머지', open: '열림', closed: '닫힘' } as const;
const PR_STATE = { merged: '머지됨', open: '열림', closed: '닫힘' } as const;

/** 내 업무에 연결된 PR 중 오늘(KST) 움직인 것. 누르면 '오늘 한 일'에 들어간다. */
export function prChips(pulls: Record<number, Pull[]>, tasks: Task[], now: string): Chip[] {
  const today = day(now);
  const seen = new Set<number>();
  const chips: Chip[] = [];
  for (const t of tasks)
    for (const p of pulls[t.id] ?? []) {
      if (seen.has(p.number) || !p.updatedAt || day(p.updatedAt) !== today) continue;
      seen.add(p.number);
      chips.push({
        number: p.number,
        label: `PR #${p.number} ${PR_WORD[p.state]} · ${p.title}`,
        text: `PR #${p.number} ${p.title} (${PR_STATE[p.state]})`,
      });
    }
  return chips;
}

function initial(tasks: Task[], given?: Record<number, Row>) {
  return Object.fromEntries(
    tasks.map((t) => [t.id, given?.[t.id] ?? { status: 'progress', remaining: t.remaining, blocker: '', evidence: '' }]),
  ) as Record<number, Row>;
}

/** 패널 본문(머리·업무 줄·오늘 한 일·막힌 점·바닥 요약). Sheet 없이도 그려 테스트한다. */
export function LapReportForm({
  tasks,
  initialRows,
  chips = [],
  evidenceFor,
  busy,
  error,
  onSubmit,
}: {
  tasks: Task[];
  initialRows?: Record<number, Row>;
  chips?: Chip[];
  /** 완료로 바꿀 때 근거 칸에 미리 넣을 문장(머지된 PR 등). */
  evidenceFor?: (taskId: number) => string;
  busy: boolean;
  error?: string;
  onSubmit: (body: { note: string; items: ReportItemInput[] }) => Promise<boolean>;
}) {
  const [rows, setRows] = useState(() => initial(tasks, initialRows));
  const [note, setNote] = useState('');
  if (!tasks.length) return <p className="lap-empty">보고할 업무가 없어요. 나에게 배정된 진행 중 업무가 생기면 여기서 한 번에 보고해요.</p>;
  const set = (id: number, patch: Partial<Row>) => setRows((r) => ({ ...r, [id]: { ...r[id], ...patch } }));
  const before = tasks.reduce((n, t) => n + t.remaining, 0);
  const after = tasks.reduce((n, t) => n + (rows[t.id].status === 'done' ? 0 : rows[t.id].remaining), 0);
  const reason = blockReason(rows, tasks, note);
  return (
    <form
      className="lap-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!reason) void onSubmit({ note: note.trim(), items: reportItems(rows, tasks) });
      }}
    >
      <div className="lap-body">
        <section>
          <div className="lap-h">
            <b>내 업무 {tasks.length}개</b>
            <span>상태와 남은 시간만 고르면 돼요</span>
          </div>
          <ul className="lap-rows">
            {tasks.map((t) => {
              const r = rows[t.id];
              return (
                <li key={t.id} className={`lap-row is-${r.status}`}>
                  <div className="lap-title">
                    <code>{taskRef(t.id)}</code>
                    {t.title}
                  </div>
                  <div className="lap-controls">
                    <fieldset className="lap-seg">
                      <legend className="sr-only">{`${t.title} 상태`}</legend>
                      {STATUS.map((s) => (
                        <label key={s.id} className={r.status === s.id ? `on is-${s.id}` : ''}>
                          <input
                            type="radio"
                            className="sr-only"
                            name={`lap-status-${t.id}`}
                            checked={r.status === s.id}
                            onChange={() =>
                              set(t.id, {
                                status: s.id,
                                ...(s.id === 'done' && !r.evidence ? { evidence: evidenceFor?.(t.id) ?? '' } : {}),
                              })
                            }
                          />
                          {s.id === 'progress' ? (
                            <CircleDot size={13} aria-hidden="true" />
                          ) : s.id === 'blocked' ? (
                            <OctagonAlert size={13} aria-hidden="true" />
                          ) : (
                            <CircleCheck size={13} aria-hidden="true" />
                          )}
                          {s.label}
                        </label>
                      ))}
                    </fieldset>
                    {r.status !== 'done' && (
                      <div className="lap-hours">
                        <span>남은 시간</span>
                        <button type="button" onClick={() => set(t.id, { remaining: quickHours(r.remaining, 'minus') })}>
                          −1h
                        </button>
                        <button type="button" onClick={() => set(t.id, { remaining: quickHours(r.remaining, 'half') })}>
                          절반
                        </button>
                        <button type="button" onClick={() => set(t.id, { remaining: quickHours(r.remaining, 'almost') })}>
                          거의 끝
                        </button>
                        <input
                          type="number"
                          min="0"
                          max="200"
                          step="0.5"
                          required
                          aria-label={`${t.title} 남은 시간`}
                          className={r.remaining !== t.remaining ? 'is-changed' : ''}
                          value={r.remaining}
                          onChange={(e) => set(t.id, { remaining: Number(e.target.value) })}
                        />
                      </div>
                    )}
                  </div>
                  {r.status === 'blocked' && (
                    <label className="lap-sub">
                      막힌 점
                      <textarea
                        rows={2}
                        maxLength={500}
                        value={r.blocker}
                        placeholder="무엇 때문에 멈췄는지, 누구의 도움이 필요한지"
                        onChange={(e) => set(t.id, { blocker: e.target.value })}
                      />
                    </label>
                  )}
                  {r.status === 'done' && (
                    <label className="lap-sub">
                      완료 근거
                      <textarea
                        rows={2}
                        maxLength={2000}
                        value={r.evidence}
                        placeholder="PR·저장소 링크, 실행 방법, 데모 등"
                        onChange={(e) => set(t.id, { evidence: e.target.value })}
                      />
                    </label>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
        <section>
          <div className="lap-h">
            <b>오늘 한 일</b>
            {!!chips.length && <span>GitHub 활동을 눌러 넣을 수 있어요</span>}
          </div>
          {!!chips.length && (
            <div className="lap-chips">
              {chips.map((c) => (
                <button
                  key={c.number}
                  type="button"
                  onClick={() => setNote((n) => (n.includes(c.text) ? n : (n.trim() ? n.trimEnd() + '\n' : '') + c.text))}
                >
                  <GitPullRequest size={12} aria-hidden="true" />+ {c.label}
                </button>
              ))}
            </div>
          )}
          <textarea
            className="lap-note"
            rows={4}
            maxLength={1000}
            required
            aria-label="오늘 한 일"
            value={note}
            placeholder="오늘 끝낸 것, 진행한 것"
            onChange={(e) => setNote(e.target.value)}
          />
          <p className="lap-hint">막힘으로 고른 업무는 진행 현황의 팀원 기록에 빨간 띠로 보여요.</p>
        </section>
      </div>
      <footer className="lap-foot">
        <div className="lap-sum">
          남은 시간 합계{' '}
          <b>{`${before}h → ${after}h`}</b>
          {(reason || error) && <small role={error ? 'alert' : undefined}>{error || reason}</small>}
        </div>
        <button className="btn primary" disabled={busy || !!reason}>
          {busy ? '저장 중…' : '저장하고 재계산'}
        </button>
      </footer>
    </form>
  );
}

/** 오른쪽 패널. 열 때마다 새로 시작한다(지난 입력을 남기지 않음). */
export function LapReportSheet({
  open,
  onOpenChange,
  subtitle,
  ...form
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subtitle: string;
} & React.ComponentProps<typeof LapReportForm>) {
  return (
    <Sheet open={open} onOpenChange={(next) => (!form.busy || next) && onOpenChange(next)}>
      <SheetContent side="right" className="lap-sheet">
        <div className="lap-head">
          <SheetTitle>오늘의 랩 기록</SheetTitle>
          <SheetDescription>{subtitle}</SheetDescription>
        </div>
        {open && <LapReportForm {...form} />}
      </SheetContent>
    </Sheet>
  );
}
