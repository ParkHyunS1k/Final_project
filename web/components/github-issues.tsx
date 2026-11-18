'use client';
// GitHub 이슈 가져오기(2026-11-09). 팀장이 저장소를 등록하고, 열린 이슈 중 고른 것만 원문으로 가져온다.
// 가져온 원문은 기존 '변경안 만들기'로 이어진다. 서버가 팀장 여부·공개 저장소·번호를 다시 검사한다.
import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/supabase-browser';

export type PickerIssue = {
  number: number;
  title: string;
  author: string;
  authorIsMember: boolean;
  assignees: string[];
  labels: string[];
  url: string;
  imported: boolean;
};
type RepoView = { owner: string; name: string; version: number; url: string } | null;
type Excluded = { number: number; reason: 'closed' | 'pull_request' | 'missing' };

// 서버 한도와 같다(lib/github-issues.ts parseIssueNumbers).
const MAX_PICK = 20;
const REASON: Record<Excluded['reason'], string> = { closed: '닫힘', pull_request: 'PR', missing: '없음' };

async function call<T>(path: string, body?: Record<string, unknown>): Promise<T> {
  const res = await apiFetch(path, {
    cache: 'no-store',
    ...(body
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : {}),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? '처리하지 못했습니다.');
  return data;
}

/** 처음 체크: 이미 가져온 이슈만 해제한다(팀원 아님도 체크, 사용자 결정 2026-11-09). */
export function initialChecked(issues: PickerIssue[]): Record<number, boolean> {
  return Object.fromEntries(issues.map((i) => [i.number, !i.imported]));
}

export function GithubIssuePicker({
  issues,
  checked,
  busy,
  onToggle,
  onImport,
}: {
  issues: PickerIssue[];
  checked: Record<number, boolean>;
  busy: boolean;
  onToggle: (n: number) => void;
  onImport: () => void;
}) {
  const count = issues.filter((i) => checked[i.number]).length;
  const tooMany = count > MAX_PICK;
  return (
    <div className="issue-picker">
      {issues.length === 0 ? (
        <p className="tiny muted">열린 이슈가 없습니다.</p>
      ) : (
        <ul className="task-list">
          {issues.map((i) => (
            <li key={i.number}>
              <label>
                <input type="checkbox" checked={Boolean(checked[i.number])} onChange={() => onToggle(i.number)} />{' '}
                <a href={i.url} target="_blank" rel="noreferrer">
                  {`#${i.number}`}
                </a>{' '}
                {i.title}
                <span className="tiny muted">
                  {' '}
                  · @{i.author || '알 수 없음'}
                  {i.assignees.length > 0 && ` → ${i.assignees.map((a) => '@' + a).join(', ')}`}
                </span>
                {!i.authorIsMember && <span className="badge"> 팀원 아님</span>}
                {i.imported && <span className="badge"> 이미 가져옴</span>}
              </label>
            </li>
          ))}
        </ul>
      )}
      {tooMany && <p className="tiny muted">{`한 번에 ${MAX_PICK}개까지 가져올 수 있어요. 체크를 줄여주세요.`}</p>}
      <button className="btn primary" disabled={busy || count === 0 || tooMany} onClick={onImport}>
        {`${count}개 가져오기`}
      </button>
    </div>
  );
}

/** 이슈 원문에 팀원이 아닌 사람이 쓴 이슈가 있으면 경고한다(승인은 막지 않음). */
export function NonMemberBanner({ spans }: { spans: { authorLogin: string; authorIsMember: boolean }[] }) {
  const outside = spans.filter((s) => !s.authorIsMember);
  if (!outside.length) return null;
  const who = [...new Set(outside.map((s) => s.authorLogin).filter(Boolean))].map((l) => '@' + l).join(', ');
  return (
    <p className="hub-alert" role="alert">
      {`팀원이 아닌 사람이 쓴 이슈 ${outside.length}건이 포함되어 있습니다 (${who})`}
    </p>
  );
}

export function GithubIssues({
  projectId,
  writable,
  onImported,
  onSetupRepo,
}: {
  projectId: string;
  writable: boolean;
  onImported: (sourceId: string) => Promise<void>;
  /** 저장소 등록·변경은 프로젝트 탭에서 한다(2026-11-16). 그 탭으로 옮겨 준다. */
  onSetupRepo?: () => void;
}) {
  const [repo, setRepo] = useState<RepoView>(null);
  const [canManage, setCanManage] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [issues, setIssues] = useState<PickerIssue[] | null>(null);
  // 목록을 만든 저장소 version. 가져오기 요청에 함께 보내 저장소가 바뀐 뒤의 오래된 선택을 서버가 거절하게 한다.
  const [listVersion, setListVersion] = useState(0);
  const [checked, setChecked] = useState<Record<number, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    void call<{ repo: RepoView; canManage: boolean }>(`/api/github-issues?project=${encodeURIComponent(projectId)}`)
      .then((d) => {
        setRepo(d.repo);
        setCanManage(d.canManage);
        setLoaded(true);
      })
      .catch((e: Error) => setMessage(e.message));
  }, [projectId]);

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setMessage('');
    try {
      await work();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '처리하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) return message ? <output className="tiny muted">{message}</output> : null;
  // 팀원에게는 등록된 저장소만 보인다. 등록·가져오기는 팀장만.
  if (!canManage)
    return (
      <p className="tiny muted">
        {repo && (
          <>
            프로젝트 저장소: <a href={repo.url}>{`${repo.owner}/${repo.name}`}</a> ·{' '}
          </>
        )}
        GitHub 이슈 가져오기는 팀장만 할 수 있어요.
      </p>
    );
  if (!repo)
    return (
      <section className="github-issues github-empty">
        <p>이슈를 가져오려면 먼저 프로젝트 저장소를 등록해 주세요.</p>
        {onSetupRepo && (
          <button className="btn" onClick={onSetupRepo}>
            프로젝트 탭에서 등록
          </button>
        )}
      </section>
    );

  return (
    <section className="github-issues">
      <div className="section-heading">
        <span className="tiny muted">
          저장소 <a href={repo.url} target="_blank" rel="noreferrer">{`${repo.owner}/${repo.name}`}</a>
        </span>
        {onSetupRepo && (
          <button className="text-link" onClick={onSetupRepo}>
            프로젝트 탭에서 변경
          </button>
        )}
      </div>
      {issues === null ? (
        <button
          className="btn"
          disabled={busy || !writable}
          onClick={() =>
            void run(async () => {
              const d = await call<{ issues: PickerIssue[]; repoVersion: number }>(
                `/api/github-issues?project=${encodeURIComponent(projectId)}&list=1`,
              );
              setIssues(d.issues);
              setListVersion(d.repoVersion);
              setChecked(initialChecked(d.issues));
            })
          }
        >
          이슈 목록 보기
        </button>
      ) : (
        <GithubIssuePicker
          issues={issues}
          checked={checked}
          busy={busy || !writable}
          onToggle={(n) => setChecked((prev) => ({ ...prev, [n]: !prev[n] }))}
          onImport={() =>
            void run(async () => {
              const numbers = issues.filter((i) => checked[i.number]).map((i) => i.number);
              const d = await call<{ sourceId: string | null; excluded: Excluded[]; error?: string }>(
                '/api/github-issues',
                { action: 'import', projectId, numbers, repoVersion: listVersion },
              );
              const skipped = d.excluded.map((x) => `#${x.number}(${REASON[x.reason]})`).join(', ');
              if (!d.sourceId) {
                setMessage(d.error ?? '가져올 수 있는 이슈가 없습니다.');
                return;
              }
              setIssues(null);
              await onImported(d.sourceId);
              if (skipped) setMessage(`제외: ${skipped}`);
            })
          }
        />
      )}
      {message && <output className="tiny muted">{message}</output>}
    </section>
  );
}

/** 프로젝트 탭 '프로젝트 정보'의 저장소 칸(2026-11-16, 업무 탭에서 옮김). 등록·변경은 팀장만, 서버가 다시 검사한다. */
export function ProjectRepo({ projectId, writable }: { projectId: string; writable: boolean }) {
  const [repo, setRepo] = useState<RepoView>(null);
  const [canManage, setCanManage] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    void call<{ repo: RepoView; canManage: boolean }>(`/api/github-issues?project=${encodeURIComponent(projectId)}`)
      .then((d) => {
        setRepo(d.repo);
        setCanManage(d.canManage);
        setLoaded(true);
      })
      .catch((e: Error) => setMessage(e.message));
  }, [projectId]);
  if (!loaded) return <span className="tiny muted">{message || '불러오는 중…'}</span>;
  return (
    <RepoField
      repo={repo}
      canManage={canManage}
      writable={writable}
      busy={busy}
      editing={editing}
      url={url}
      message={message}
      onEdit={() => {
        setUrl(repo?.url ?? '');
        setEditing(true);
      }}
      onCancel={() => setEditing(false)}
      onUrl={setUrl}
      onSubmit={() => {
        setBusy(true);
        setMessage('');
        call<{ repo: RepoView }>('/api/github-issues', {
          action: 'setRepo',
          projectId,
          repoUrl: url,
          version: repo?.version ?? 0,
        })
          .then((d) => {
            setRepo(d.repo);
            setEditing(false);
            setMessage('저장소를 저장했어요.');
          })
          .catch((e: Error) => setMessage(e.message))
          .finally(() => setBusy(false));
      }}
    />
  );
}

export function RepoField({
  repo,
  canManage,
  writable,
  busy,
  editing,
  url,
  message,
  onEdit,
  onCancel,
  onUrl,
  onSubmit,
}: {
  repo: RepoView;
  canManage: boolean;
  writable: boolean;
  busy: boolean;
  editing: boolean;
  url: string;
  message: string;
  onEdit: () => void;
  onCancel: () => void;
  onUrl: (url: string) => void;
  onSubmit: () => void;
}) {
  const note = message && <output className="tiny muted">{message}</output>;
  if (!canManage || (repo && !editing))
    return (
      <span className="repo-field">
        {repo ? (
          <a href={repo.url} target="_blank" rel="noreferrer">{`${repo.owner}/${repo.name}`}</a>
        ) : (
          <span className="muted">아직 없어요 · 팀장이 등록해요</span>
        )}
        {canManage && (
          <button className="text-link" disabled={busy || !writable} onClick={onEdit}>
            변경
          </button>
        )}
        {note}
      </span>
    );
  return (
    <form
      className="repo-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <input
        aria-label="공개 GitHub 저장소 주소"
        placeholder="https://github.com/아이디/저장소"
        value={url}
        onChange={(e) => onUrl(e.target.value)}
      />
      <span className="repo-form-actions">
        <button className="btn primary" disabled={busy || !writable || !url.trim()}>
          {repo ? '바꾸기' : '저장소 등록'}
        </button>
        {repo && (
          <button type="button" className="btn" disabled={busy} onClick={onCancel}>
            취소
          </button>
        )}
      </span>
      <span className="tiny muted">공개 저장소만 돼요. 등록하면 업무 탭에서 이슈를 가져오고, PR이 업무에 연결돼요.</span>
      {note}
    </form>
  );
}
