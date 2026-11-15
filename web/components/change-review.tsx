'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, Clock3, Sparkles } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { SourceList, SourcePaste, type SourceSummary } from './source-paste';
import { GithubIssues, NonMemberBanner } from './github-issues';
import type { ProjectMeta } from './project-workspace';
import { seoulTime, type Task as ServerTask } from '@/lib/sprint';
import type { Wire } from '@/lib/wire';
// 화면은 JSON으로 받은 값을 다룬다(시각은 ISO 문자열).
type Task = Wire<ServerTask>;
import { text } from '@/lib/utils';
import { apiFetch } from '@/lib/supabase-browser';

type Evidence = { start: number; end: number; quote: string };
export type Change = {
  changeId: string;
  kind: string;
  taskId: number | null;
  newKey: string | null;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  evidence: Evidence | null;
  basis: 'fact' | 'estimate';
  needsReview: string;
  requires: 'owner' | 'assignee';
  blocked: string;
};
type Proposal = {
  id: string;
  sourceId: string;
  baseRevision: number;
  model: string;
  promptVersion: string;
  status: string;
  error: string;
  createdAt: string;
  changes: Change[];
};
type Application = {
  id: string;
  reverts: string | null;
  approvedBy: string;
  approvedAt: string;
  revision: number;
  entries: {
    changeId: string;
    kind: string;
    taskId: number;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
    edited: boolean;
  }[];
};

const KIND_LABEL: Record<string, string> = {
  createTask: '신규 업무',
  status: '진행 상태',
  remaining: '남은 공수',
  assignee: '담당자',
  dueAt: '승인된 마감',
  complete: '완료 보고',
};

// datetime-local은 브라우저 시간대 문자열이다. 저장은 UTC 절대 시각(ISO)으로 한다.
function localInput(iso: unknown) {
  return typeof iso === 'string' && iso
    ? new Date(Date.parse(iso) - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)
    : '';
}
function describe(value: unknown) {
  if (value === null || value === undefined || value === '') return '없음';
  if (typeof value === 'boolean') return value ? '예' : '아니오';
  if (Array.isArray(value)) return value.length ? value.join(', ') : '없음';
  return text(value, '값 있음');
}

function personName(person: unknown, members: ProjectMeta['members']) {
  return typeof person === 'number'
    ? (members.find((m) => m.person === person)?.display_name ?? `팀원 ${person}`)
    : '미정';
}

async function call(path: string, body?: Record<string, unknown>) {
  const res = await apiFetch(path, {
    cache: 'no-store',
    ...(body
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const data = (await res.json()) as Record<string, unknown> & {
    error?: string;
  };
  if (!res.ok) throw new Error(data.error ?? '처리하지 못했습니다.');
  return data;
}

const STATUS_LABEL: Record<string, string> = { todo: '시작 전', in_progress: '진행 중', done: '완료' };
/** 변경 종류별로 값을 사람이 읽는 말로. */
function valueText(kind: string, value: unknown, members: ProjectMeta['members']) {
  if (kind === 'assignee') return personName(value, members);
  if (kind === 'remaining') return typeof value === 'number' ? `${value}시간` : '미정';
  if (kind === 'dueAt') return typeof value === 'string' && value ? seoulTime(value).slice(5).replace('-', '/') : '없음';
  if (kind === 'status') return STATUS_LABEL[text(value)] ?? describe(value);
  return describe(value);
}

/** 검토 요약: 원문 사실·AI 추정 수, 선택한 새 업무·바뀌는 업무 수, 남은 공수 변화(편집 반영). */
export function proposalSummary(
  changes: Change[],
  selected: Record<string, boolean>,
  edits: Record<string, Record<string, unknown>>,
) {
  const num = (v: unknown) => (typeof v === 'number' ? v : 0);
  const chosen = changes.filter((c) => selected[c.changeId]);
  const created = chosen.filter((c) => c.kind === 'createTask').length;
  // ponytail: 완료 보고로 0이 되는 공수는 세지 않는다(완료는 공수 변화보다 근거 확인이 핵심).
  const hours = chosen.reduce((n, c) => {
    const after = { ...c.after, ...edits[c.changeId] };
    if (c.kind === 'createTask') return n + num(after.remaining);
    if (c.kind === 'remaining') return n + num(after.remaining) - num(c.before.remaining);
    return n;
  }, 0);
  return {
    total: changes.length,
    fact: changes.filter((c) => c.basis === 'fact').length,
    estimate: changes.filter((c) => c.basis !== 'fact').length,
    selected: chosen.length,
    created,
    changed: chosen.length - created,
    hours,
  };
}

type ReviewProps = {
  proposal: Proposal;
  tasks: Task[];
  members: ProjectMeta['members'];
  selected: Record<string, boolean>;
  edits: Record<string, Record<string, unknown>>;
  stale: boolean;
  busy: boolean;
  writable: boolean;
  onToggle: (changeId: string, on: boolean) => void;
  onEdit: (changeId: string, field: string, value: unknown) => void;
  onApply: () => void;
  onReanalyze: () => void;
};

/** 변경안 한 줄: 체크 · 제목 · (새 업무는 값 칩 / 바뀌는 업무는 취소선→새 값) · 근거 접기 · 승인 주체. */
function ChangeItem({ c, tasks, members, selected, edits, writable, onToggle, onEdit }: { c: Change } & ReviewProps) {
  const after = { ...c.after, ...edits[c.changeId] };
  const edited = !!edits[c.changeId];
  const title =
    c.kind === 'createTask' ? text(after.title) : (tasks.find((t) => t.id === c.taskId)?.title ?? `업무 ${c.taskId}`);
  const field = Object.keys(c.before)[0] ?? c.kind;
  // AI가 추정한 공수·마감은 사용자가 고치기 전까지 추정으로 표시한다.
  const hoursEstimated = after.remainingEstimated === true && !(edits[c.changeId] && 'remaining' in edits[c.changeId]);
  const dueEstimated = after.dueEstimated === true && !(edits[c.changeId] && 'dueAt' in edits[c.changeId]);
  const id = `sel-${c.changeId}`;
  const personChip = (
    <label className={`ai-chip${typeof after.person === 'number' ? '' : ' is-missing'}`}>
      <small>담당</small>
      <NativeSelect
        value={typeof after.person === 'number' ? after.person : ''}
        onChange={(e) => onEdit(c.changeId, 'person', e.target.value === '' ? null : Number(e.target.value))}
      >
        <NativeSelectOption value="">정해 주세요</NativeSelectOption>
        {members
          .filter((m) => !m.left_at)
          .map((m) => (
            <NativeSelectOption key={m.person} value={m.person}>
              {m.display_name}
            </NativeSelectOption>
          ))}
      </NativeSelect>
    </label>
  );
  const hoursChip = (
    <label className={`ai-chip${hoursEstimated ? ' is-estimated' : ''}`}>
      <small>공수</small>
      <input
        type="number"
        min="0.5"
        max="200"
        step="0.5"
        value={typeof after.remaining === 'number' ? after.remaining : ''}
        onChange={(e) => onEdit(c.changeId, 'remaining', e.target.value === '' ? null : Number(e.target.value))}
      />
      <small>h</small>
    </label>
  );
  return (
    <li className={`ai-item${c.blocked ? ' is-blocked' : ''}`}>
      <Checkbox
        id={id}
        checked={!!selected[c.changeId]}
        disabled={!!c.blocked || !writable}
        onCheckedChange={(v) => onToggle(c.changeId, Boolean(v))}
      />
      <div className="ai-item-main">
        <label htmlFor={id} className="ai-item-title">
          {c.kind !== 'createTask' && <code>{`PM-${c.taskId}`}</code>}
          {title}
        </label>
        {c.kind === 'createTask' ? (
          <div className="ai-chips">
            {personChip}
            {hoursChip}
            <label className={`ai-chip${dueEstimated ? ' is-estimated' : ''}`}>
              <small>마감</small>
              <input
                type="datetime-local"
                value={localInput(after.dueAt)}
                onChange={(e) => onEdit(c.changeId, 'dueAt', e.target.value ? new Date(e.target.value).toISOString() : null)}
              />
            </label>
          </div>
        ) : (
          <div className="ai-chips">
            <p className="ai-diff">
              <span>{KIND_LABEL[c.kind] ?? c.kind}</span>
              <del>{valueText(c.kind, c.before[field], members)}</del>
              <ArrowRight size={13} aria-label="에서" />
              <ins>{c.kind === 'complete' ? '완료' : valueText(c.kind, after[field], members)}</ins>
            </p>
            {c.kind === 'assignee' && personChip}
            {c.kind === 'remaining' && hoursChip}
          </div>
        )}
        {c.kind === 'complete' && (
          <label className="ai-evidence">
            완료 근거
            <textarea
              rows={2}
              maxLength={2000}
              value={text(after.evidence)}
              onChange={(e) => onEdit(c.changeId, 'evidence', e.target.value)}
            />
          </label>
        )}
        <div className="ai-meta">
          <span className={`ai-tag ${c.basis === 'fact' ? 'is-fact' : 'is-estimate'}`}>
            {c.basis === 'fact' ? '원문 사실' : 'AI 추정'}
          </span>
          {edited && <span className="ai-tag">사용자 수정함</span>}
          {c.evidence ? (
            <details className="ai-why">
              <summary>근거 보기</summary>
              <blockquote>
                “{c.evidence.quote}”<small>{` 원문 ${c.evidence.start}~${c.evidence.end}자`}</small>
              </blockquote>
            </details>
          ) : (
            <small className="ai-noevidence">원문 근거 없음</small>
          )}
        </div>
        {c.needsReview && (
          <p className="ai-warn">
            <Clock3 size={13} aria-hidden="true" /> 확인 필요: {c.needsReview}
          </p>
        )}
        {c.blocked && <p className="ai-warn">{c.blocked}</p>}
      </div>
      <span className="ai-who">{c.requires === 'owner' ? '팀장 승인' : '담당자 승인'}</span>
    </li>
  );
}

/** 검토 → 반영. 종류별로 묶고(새 업무 / 바뀌는 업무), 요약·거르기·반영 버튼 하나. */
export function ProposalReview(props: ReviewProps) {
  const { proposal, selected, edits, stale, busy, writable, onApply, onReanalyze } = props;
  const [filter, setFilter] = useState<'all' | 'new' | 'change'>('all');
  if (proposal.status === 'failed')
    return (
      <div className="empty-copy">
        변경안을 만들지 못했습니다: {proposal.error}. 업무 기록은 바뀌지 않았습니다.{' '}
        <button className="text-link" disabled={busy || !writable} onClick={onReanalyze}>
          다시 분석
        </button>
      </div>
    );
  if (!proposal.changes.length)
    return (
      <p className="empty-copy">
        적용할 수 있는 변경 후보를 찾지 못했습니다.{' '}
        <button className="text-link" disabled={busy || !writable} onClick={onReanalyze}>
          다시 분석
        </button>
      </p>
    );
  const sum = proposalSummary(proposal.changes, selected, edits);
  const created = proposal.changes.filter((c) => c.kind === 'createTask');
  const changed = proposal.changes.filter((c) => c.kind !== 'createTask');
  const group = (title: string, items: Change[]) =>
    !!items.length && (
      <section className="ai-group">
        <h4>
          {title} <span>{items.length}</span>
        </h4>
        <ul className="ai-list">
          {items.map((c) => (
            <ChangeItem key={c.changeId} c={c} {...props} />
          ))}
        </ul>
      </section>
    );
  return (
    <div className="ai-review">
      <div className="ai-summary">
        <p>
          <b>{`AI가 ${sum.total}건을 제안했어요`}</b>
          <small>{` 원문 사실 ${sum.fact} · AI 추정 ${sum.estimate}${stale ? ' · 그사이 업무가 바뀜, 다시 분석을 권해요' : ''}`}</small>
        </p>
        <fieldset className="ai-filters">
          <legend className="sr-only">변경안 거르기</legend>
          {(
            [
              ['all', `전체 ${sum.total}`],
              ['new', `새 업무 ${created.length}`],
              ['change', `바뀌는 업무 ${changed.length}`],
            ] as const
          ).map(([id, label]) => (
            <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)}>
              {label}
            </button>
          ))}
        </fieldset>
      </div>
      {filter !== 'change' && group('새 업무', created)}
      {filter !== 'new' && group('바뀌는 업무', changed)}
      <div className="ai-footbar">
        <p>{`선택 ${sum.selected}건 · 새 업무 ${sum.created} · 바뀌는 업무 ${sum.changed} · 남은 공수 ${sum.hours >= 0 ? '+' : ''}${sum.hours}h`}</p>
        <button className="btn ghost" disabled={busy || !writable} onClick={onReanalyze}>
          다시 분석
        </button>
        <button className="btn primary" disabled={busy || !writable || !sum.selected} onClick={onApply}>
          {`선택한 ${sum.selected}건 반영`}
        </button>
      </div>
    </div>
  );
}

/**
 * 원문에서 업무 만들기(2026-11-16 정리): 원문 넣기 → AI 변경안 검토 → 반영.
 * 서버가 권한·버전·마감을 다시 검사하므로 이 화면의 편집이 권한을 넓히지 않는다.
 */
export function ChangeReview({
  projectId,
  revision,
  tasks,
  members,
  me,
  writable,
  onApplied,
}: {
  projectId: string;
  revision: number;
  tasks: Task[];
  members: ProjectMeta['members'];
  me: ProjectMeta['me'];
  writable: boolean;
  onApplied: (state: unknown) => void;
}) {
  const [sources, setSources] = useState<SourceSummary[]>([]);
  const [sourceId, setSourceId] = useState('');
  const [sourceBody, setSourceBody] = useState('');
  const [duplicates, setDuplicates] = useState<{ id: string }[]>([]);
  // GitHub 이슈로 만든 원문의 이슈별 작성자(팀원 아님 경고용). 붙여넣기 원문은 빈 배열.
  const [issueSpans, setIssueSpans] = useState<{ authorLogin: string; authorIsMember: boolean }[]>([]);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [applications, setApplications] = useState<Application[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [edits, setEdits] = useState<Record<string, Record<string, unknown>>>({});
  const [busy, setBusy] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [inputTab, setInputTab] = useState<'paste' | 'github'>('paste');
  // 고른 원문을 고친 새 버전으로 다시 붙여넣는 중이면 그 원문 id.
  const [revising, setRevising] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const historyRef = useRef<HTMLDetailsElement>(null);
  // 서버가 운영 모델이 없다고 알리면(false) 붙여넣기·변경안 만들기 대신 준비 중 안내를 보여준다.
  const [aiAvailable, setAiAvailable] = useState<boolean | null>(null);

  const refresh = useCallback(async () => {
    const list = (await call('/api/sources?project=' + encodeURIComponent(projectId))) as { sources: SourceSummary[] };
    setSources(list.sources);
    const history = (await call('/api/change-proposals?project=' + encodeURIComponent(projectId))) as {
      applications: Application[];
      aiAvailable?: boolean;
    };
    setApplications(history.applications);
    setAiAvailable(history.aiAvailable === true);
  }, [projectId]);

  useEffect(() => {
    // 렌더 중이 아니라 마이크로태스크 이후에만 상태를 갱신한다.
    void Promise.resolve()
      .then(refresh)
      .catch((e: unknown) => setError((e as Error).message));
  }, [refresh]);

  async function run(work: () => Promise<void>, message = '') {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
      if (message) setNotice(message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function openSource(id: string) {
    await run(async () => {
      const data = (await call(
        `/api/sources?project=${encodeURIComponent(projectId)}&source=${encodeURIComponent(id)}`,
      )) as {
        source: { body: string };
        duplicates: { id: string }[];
        issueSpans?: { authorLogin: string; authorIsMember: boolean }[];
      };
      setSourceId(id);
      setSourceBody(data.source.body);
      setDuplicates(data.duplicates);
      setIssueSpans(data.issueSpans ?? []);
      setProposal(null);
      setRevising(null);
    });
  }

  async function createProposal(id = sourceId) {
    setAnalyzing(true);
    try {
      await run(async () => {
        const data = (await call('/api/change-proposals', {
          action: 'create',
          projectId,
          sourceId: id,
        })) as { proposal: Proposal; error: string };
        setProposal(data.proposal);
        setSelected(Object.fromEntries(data.proposal.changes.filter((c) => !c.blocked).map((c) => [c.changeId, false])));
        setEdits({});
        if (data.error) setError(data.error);
      }, '변경안을 만들었습니다. 아직 아무것도 반영되지 않았습니다.');
    } finally {
      setAnalyzing(false);
    }
  }

  // 원문을 열고 바로 변경안까지(버튼 한 번).
  async function openAndAnalyze(id: string) {
    await refresh();
    await openSource(id);
    await createProposal(id);
  }

  async function apply() {
    const selections = Object.entries(selected)
      .filter(([, on]) => on)
      .map(([changeId]) => ({ changeId, edited: edits[changeId] ?? {} }));
    if (!selections.length) {
      setError('반영할 항목을 선택해주세요.');
      return;
    }
    await run(async () => {
      const data = await call('/api/change-proposals', {
        action: 'apply',
        projectId,
        revision,
        proposalId: proposal!.id,
        // 같은 승인의 재전송이 중복 적용되지 않도록 요청 식별자를 붙인다.
        mutationId: 'apply-' + crypto.randomUUID(),
        selections,
      });
      onApplied(data.state);
      setProposal(null);
      await refresh();
    }, '선택한 변경만 반영하고 기록을 남겼습니다.');
  }

  async function revert(applicationId: string) {
    await run(async () => {
      const data = await call('/api/change-proposals', {
        action: 'revert',
        projectId,
        revision,
        applicationId,
        mutationId: 'revert-' + crypto.randomUUID(),
      });
      onApplied(data.state);
      await refresh();
    }, '되돌리기를 새 변경으로 저장했습니다. 원래 기록은 남습니다.');
  }

  function setEdit(changeId: string, field: string, value: unknown) {
    setEdits((prev) => ({ ...prev, [changeId]: { ...prev[changeId], [field]: value } }));
  }

  // 변경안을 만든 뒤 업무가 바뀌었으면 다시 분석을 권한다(반영 때 서버가 최신 값과 다시 비교한다).
  const stale = !!proposal && proposal.baseRevision !== revision;
  const viewing = sourceId && !revising ? sources.find((x) => x.id === sourceId) : undefined;
  const lastApplied = applications[0];
  const steps = ['원문 넣기', 'AI 변경안 검토', '반영'];
  const step = proposal ? 1 : 0;

  return (
    <section className="work-section ai-flow">
      <header className="ai-head">
        <div>
          <h2>
            <Sparkles size={18} aria-hidden="true" /> 원문에서 업무 만들기
          </h2>
          <p>회의록·기획서·GitHub 이슈를 넣으면 AI가 업무 변경안을 만들고, 고른 것만 반영돼요.</p>
        </div>
        <button
          className="btn ghost"
          onClick={() => {
            setHistoryOpen(true);
            historyRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }}
        >
          {`반영 기록 ${applications.length}`}
        </button>
      </header>
      <ol className="ai-steps" aria-label="진행 단계">
        {steps.map((label, i) => (
          <li key={label} className={i < step ? 'is-done' : i === step ? 'is-on' : ''} aria-current={i === step ? 'step' : undefined}>
            <b>{i < step ? <Check size={12} aria-hidden="true" /> : i + 1}</b>
            {label}
          </li>
        ))}
      </ol>

      {aiAvailable === null ? (
        // 서버가 사용 가능하다고 알리기 전(로딩·조회 실패)에는 입력을 열지 않는다.
        <output className="empty-copy" aria-live="polite">
          AI 변경안 사용 가능 여부를 불러오는 중입니다.
        </output>
      ) : aiAvailable === false ? (
        <p className="empty-copy" role="note">
          AI 변경안은 준비 중입니다. 계획서를 붙여넣어 업무 변경안을 받는 기능은 아직 열리지 않았습니다.
        </p>
      ) : proposal ? (
        <>
          <div className="ai-source-line">
            <span>{`기준 원문 · ${viewing?.preview || '선택한 원문'}`}</span>
            <button className="text-link" disabled={busy} onClick={() => setProposal(null)}>
              원문 넣기로 돌아가기
            </button>
          </div>
          <NonMemberBanner spans={issueSpans} />
          <ProposalReview
            proposal={proposal}
            tasks={tasks}
            members={members}
            selected={selected}
            edits={edits}
            stale={stale}
            busy={busy}
            writable={writable}
            onToggle={(id, on) => setSelected((prev) => ({ ...prev, [id]: on }))}
            onEdit={setEdit}
            onApply={() => void apply()}
            onReanalyze={() => void createProposal()}
          />
        </>
      ) : (
        <div className="ai-cols">
          <div className="ai-input">
            {viewing ? (
              <div className="ai-source">
                <div className="ai-source-head">
                  <b>{viewing.preview || '원문'}</b>
                  <button className="text-link" disabled={busy} onClick={() => setSourceId('')}>
                    새로 넣기
                  </button>
                </div>
                <NonMemberBanner spans={issueSpans} />
                <pre className="source-body">{sourceBody}</pre>
                {duplicates.length > 0 && (
                  <p className="tiny muted">같은 내용의 이전 원문이 {duplicates.length}건 있습니다. 같은 자료인지는 직접 확인해주세요.</p>
                )}
                <div className="ai-input-foot">
                  <button className="btn ghost" disabled={busy || !writable} onClick={() => setRevising(sourceId)}>
                    고친 내용으로 다시 붙여넣기
                  </button>
                  <button className="btn primary" disabled={busy || !writable} onClick={() => void createProposal()}>
                    {analyzing ? '만드는 중…' : 'AI 변경안 만들기'}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="ai-tabs" role="tablist" aria-label="원문 넣는 방법">
                  {(
                    [
                      ['paste', '붙여넣기'],
                      ['github', 'GitHub 이슈'],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      role="tab"
                      aria-selected={(revising ? 'paste' : inputTab) === id}
                      disabled={!!revising && id !== 'paste'}
                      onClick={() => setInputTab(id)}
                    >
                      {label}
                    </button>
                  ))}
                  {revising && (
                    <button type="button" className="text-link ai-tab-cancel" onClick={() => setRevising(null)}>
                      수정본 취소
                    </button>
                  )}
                </div>
                {inputTab === 'github' && !revising ? (
                  <div className="ai-tab-panel" role="tabpanel">
                    <GithubIssues projectId={projectId} writable={writable} onImported={openAndAnalyze} />
                  </div>
                ) : (
                  <div className="ai-tab-panel" role="tabpanel">
                    <SourcePaste
                      busy={busy}
                      disabled={!writable}
                      supersedes={revising}
                      submitLabel={analyzing ? '만드는 중…' : 'AI 변경안 만들기'}
                      onSubmit={async (input) => {
                        let saved = '';
                        await run(async () => {
                          const data = (await call('/api/sources', {
                            projectId,
                            ...input,
                            supersedes: input.supersedes,
                          })) as { sourceId: string };
                          saved = data.sourceId;
                        });
                        if (!saved) return false;
                        await openAndAnalyze(saved);
                        return true;
                      }}
                    />
                  </div>
                )}
              </>
            )}
          </div>
          <aside className="ai-rail">
            <h3>
              최근 원문 <small>{`${sources.length}개`}</small>
            </h3>
            <SourceList sources={sources} selected={sourceId} onSelect={(id) => void openSource(id)} />
            <p className="ai-note">원문은 고치지 않고 보존하며, 안의 지시문은 실행하지 않고 인용 자료로만 써요.</p>
          </aside>
        </div>
      )}

      <details
        ref={historyRef}
        className="ai-history"
        open={historyOpen}
        onToggle={(e) => setHistoryOpen(e.currentTarget.open)}
      >
        <summary>
          <b>{`반영 기록 ${applications.length}`}</b>
          <span>
            {lastApplied
              ? `마지막 ${new Date(lastApplied.approvedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} · ${lastApplied.approvedBy} · ${lastApplied.reverts ? '되돌리기' : '반영'} ${lastApplied.entries.length}건 · 되돌리기도 새 기록으로 남아요`
              : '아직 반영한 AI 변경이 없어요'}
          </span>
        </summary>
        <div className="task-list">
          {applications.map((a) => (
            <div className="task-row" key={a.id}>
              <Check size={18} />
              <div>
                <b>
                  {a.reverts ? '되돌리기' : 'AI 변경안 반영'} · {a.entries.length}건
                </b>
                <span>
                  {new Date(a.approvedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} · 버전 {a.revision} ·{' '}
                  {members.find((m) => m.display_name === a.approvedBy)?.display_name ?? a.approvedBy}
                </span>
                <p className="tiny">{a.entries.map((e) => `${KIND_LABEL[e.kind] ?? e.kind}${e.edited ? '(수정)' : ''}`).join(', ')}</p>
                {!a.reverts && writable && !applications.some((x) => x.reverts === a.id) && (
                  <button className="text-link" disabled={busy} onClick={() => void revert(a.id)}>
                    이 반영 되돌리기
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </details>
      {error && (
        <div className="error-notice" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <output className="notice">
          <Check size={16} />
          {notice}
        </output>
      )}
      <p className="tiny muted">
        사용자가 선택·편집·승인한 내용만 반영됩니다. AI 제안을 따르지 않아도 처음 약속한 결과물을 완성하면 완주할 수
        있습니다.
        {me.role === 'owner'
          ? ' 신규 업무·담당 변경·마감 변경은 팀장인 회원님이 승인합니다.'
          : ' 본인 업무의 상태·남은 공수·완료 보고만 승인할 수 있습니다.'}
      </p>
    </section>
  );
}
