// 오늘의 랩 기록(2026-11-16): 내 업무 여러 개를 한 번에 보고한다. 하나라도 틀리면 전체를 거절한다(부분 저장 없음).
// 완료는 기존 완료 규칙과 같이 근거(5자 이상)가 있어야 하고, 막힌 점은 업무별 선택 입력이다.
import { PolicyError } from './sprint-policy';
import { validateHours, type Task } from './sprint';
import { assertEvidence } from './deliverables';

export const MAX_REPORT_ITEMS = 20;
const MAX_NOTE = 1000;
const MAX_BLOCKER = 500;

export type ReportItem = {
  task: Task;
  remaining: number;
  done: boolean;
  evidence: string;
  blocker: string | null;
};

export function parseReport(
  body: { note?: unknown; items?: unknown },
  tasks: Task[],
  actor: { role: string; person: number },
): { note: string; items: ReportItem[] } {
  const note = typeof body.note === 'string' ? body.note.trim() : '';
  if (!note || note.length > MAX_NOTE) throw new PolicyError(`오늘 한 일을 1~${MAX_NOTE}자로 입력해주세요.`);
  const raw = body.items;
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_REPORT_ITEMS)
    throw new PolicyError(`보고할 업무를 1~${MAX_REPORT_ITEMS}개 골라주세요.`);
  const seen = new Set<number>();
  const items = raw.map((value): ReportItem => {
    const i = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
    const task = tasks.find((t) => t.id === i.taskId && !t.done);
    if (!task || seen.has(task.id)) throw new PolicyError('진행 중인 업무를 한 번씩만 골라주세요.');
    seen.add(task.id);
    if (actor.role !== 'owner' && task.person !== actor.person)
      throw new PolicyError('본인의 업무만 보고할 수 있습니다.', 403);
    if (i.blocker != null && typeof i.blocker !== 'string') throw new PolicyError('막힌 점 형식이 올바르지 않습니다.');
    const blocker = typeof i.blocker === 'string' ? i.blocker.trim() : '';
    if (blocker.length > MAX_BLOCKER) throw new PolicyError(`막힌 점은 ${MAX_BLOCKER}자 이내로 입력해주세요.`);
    const done = i.done === true;
    return {
      task,
      done,
      remaining: done ? 0 : validateHours(i.remaining),
      evidence: done ? assertEvidence(i.evidence) : '',
      // 끝낸 업무에는 막힌 점을 남기지 않는다.
      blocker: done ? null : blocker || null,
    };
  });
  return { note, items };
}

/** 이력에 남길 한 줄: 업무 수·완료 수·막힘 수. */
export function reportDetail(items: ReportItem[]) {
  const done = items.filter((i) => i.done).length;
  const blocked = items.filter((i) => i.blocker).length;
  return `진행 보고 · 업무 ${items.length}개${done ? ` · 완료 ${done}` : ''}${blocked ? ` · 막힘 ${blocked}` : ''}`;
}
