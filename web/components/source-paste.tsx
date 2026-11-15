'use client';
import { useState } from 'react';
import { seoulTime } from '@/lib/sprint';

export type SourceSummary = {
  id: string;
  authorId: string;
  origin: string;
  capturedAt: string | null;
  hash: string;
  supersedes: string | null;
  createdAt: string;
  size: number;
  /** 첫 줄(80자). 목록에서 어떤 원문인지 알아보게. */
  preview?: string;
  /** 반영된 항목 수(되돌린 항목 제외). */
  applied?: number;
};

const MAX_BODY = 40000;

/**
 * 문서·대화 붙여넣기. 서버는 받은 문자열을 그대로 보존하며, 원문 안의 문장은
 * 데이터로만 다룬다. 외부 메신저 자동 수집이나 파일 가져오기는 제공하지 않는다.
 */
export function SourcePaste({
  busy,
  disabled,
  supersedes,
  submitLabel = '원문 저장',
  onSubmit,
}: {
  busy: boolean;
  disabled: boolean;
  supersedes: string | null;
  submitLabel?: string;
  onSubmit: (input: {
    body: string;
    origin: string;
    capturedAt: string;
    supersedes: string | null;
  }) => Promise<boolean>;
}) {
  const [body, setBody] = useState('');
  const [origin, setOrigin] = useState('');
  const [capturedAt, setCapturedAt] = useState('');
  return (
    <form
      className="ai-paste"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await onSubmit({ body, origin, capturedAt, supersedes })) setBody('');
      }}
    >
      <label className="sr-only" htmlFor="source-body">
        기획서·회의록·대화 붙여넣기
      </label>
      <textarea
        id="source-body"
        rows={10}
        required
        maxLength={MAX_BODY}
        placeholder={'회의록·기획서·팀 대화를 그대로 붙여넣으세요. 줄바꿈과 들여쓰기도 그대로 둬도 돼요.\n\n예: 도윤: 로그인은 목요일까지 내가 할게. 검색 정렬은 아직 기준을 못 정했어…'}
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      <details className="ai-more">
        <summary>출처·대화 시각 추가 (선택)</summary>
        <label className="input-label" htmlFor="source-origin">
          출처
        </label>
        <input
          id="source-origin"
          maxLength={200}
          placeholder="예: 팀 카카오톡, 9월 9일 회의록"
          value={origin}
          onChange={(e) => setOrigin(e.target.value)}
        />
        <label className="input-label" htmlFor="source-captured">
          대화 시각
        </label>
        <input id="source-captured" type="datetime-local" value={capturedAt} onChange={(e) => setCapturedAt(e.target.value)} />
      </details>
      <div className="ai-input-foot">
        <span className="ai-count">
          {supersedes ? '고른 원문의 새 버전으로 저장해요(예전 버전은 남아요) · ' : ''}
          {`${body.length.toLocaleString('ko-KR')}자 / ${MAX_BODY.toLocaleString('ko-KR')}`}
        </span>
        <button className="btn primary" disabled={busy || disabled || !body.trim()}>
          {submitLabel}
        </button>
      </div>
    </form>
  );
}

export function SourceList({
  sources,
  selected,
  onSelect,
}: {
  sources: SourceSummary[];
  selected: string;
  onSelect: (id: string) => void;
}) {
  if (!sources.length) return <p className="empty-copy">아직 넣은 원문이 없어요.</p>;
  return (
    <ul className="ai-sources">
      {sources.map((s) => (
        <li key={s.id}>
          <button type="button" aria-current={s.id === selected ? 'true' : undefined} onClick={() => onSelect(s.id)}>
            <span className="ai-src-title">{s.preview || s.origin || '제목 없는 원문'}</span>
            <span className="ai-src-meta">
              <span className={`ai-tag${s.origin.startsWith('GitHub') ? ' is-github' : ''}`}>
                {s.origin.startsWith('GitHub') ? 'GitHub 이슈' : s.origin || '붙여넣기'}
              </span>
              {`${seoulTime(s.createdAt).slice(5).replace('-', '/')} · ${s.size.toLocaleString('ko-KR')}자`}
              {s.supersedes && <span className="ai-tag">수정본</span>}
              {!!s.applied && <span className="ai-tag is-fact">{`반영 ${s.applied}건`}</span>}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
