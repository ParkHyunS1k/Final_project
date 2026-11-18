'use client';
import { useEffect, useState } from 'react';
import { Sparkles, Check, Clock3 } from 'lucide-react';
import { apiFetch } from '@/lib/supabase-browser';
import type { Profile, IntroResult } from '@/lib/career/profile';

type Provider = {
  id: IntroResult['provider'];
  label: string;
  model: string;
  configured: boolean;
  keyName: string;
};
export function CareerIntroduction({
  profile,
  disabled,
  onSaved,
  onBusy,
}: {
  profile: Profile;
  disabled: boolean;
  onSaved: (p: Profile) => void;
  onBusy: (b: boolean) => void;
}) {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [selected, setSelected] = useState<string[]>([
    'openai',
    'anthropic',
    'google',
  ]);
  const [consent, setConsent] = useState(false);
  const [running, setRunning] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    const controller = new AbortController();
    apiFetch('/api/career/introduction', { signal: controller.signal })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error);
        setProviders(data.providers);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setErrors({ status: e.message });
      });
    return () => controller.abort();
  }, []);
  async function run(action: 'generate' | 'select', ids: string[]) {
    let current = profile;
    setErrors({});
    onBusy(true);
    try {
      for (const id of ids) {
        setRunning(id);
        const response = await apiFetch('/api/career/introduction', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action,
            provider: id,
            version: current.version,
            consent,
          }),
        });
        const value = await response.json();
        if (!response.ok) {
          setErrors((e) => ({
            ...e,
            [id]: value.error || '소개를 생성하지 못했습니다.',
          }));
          if (response.status === 409 || response.status === 429) break;
          continue;
        }
        current = value.profile;
        onSaved(current);
      }
    } catch {
      setErrors((e) => ({
        ...e,
        network: '연결이 끊겼습니다. 새로고침해서 저장 결과를 확인해주세요.',
      }));
    } finally {
      setRunning('');
      onBusy(false);
    }
  }
  const chosen = profile.analysis.introductions?.find(
    (r) => r.provider === profile.analysis.selectedIntroduction,
  );
  const available = providers.filter(
    (p) => p.configured && selected.includes(p.id),
  );
  return (
    <section className="intro-card">
      <div className="studio-heading">
        <div>
          <h2>경험으로 소개하는 나</h2>
          <p>어떤 일을 해왔고, 어떻게 풀어왔는지 짧게 전해요.</p>
        </div>
        <Sparkles size={25} />
      </div>
      {chosen && (
        <div className="intro-selected">
          <small>선택한 소개</small>
          {chosen.lines.map((l, i) => (
            <p key={i}>{l.text}</p>
          ))}
        </div>
      )}
      <div className="intro-options">
        {providers.map((p) => (
          <label key={p.id} aria-label={`${p.label} 요약 모델 선택`}>
            <input
              type="checkbox"
              disabled={disabled || !p.configured}
              checked={selected.includes(p.id)}
              onChange={() =>
                setSelected((a) =>
                  a.includes(p.id) ? a.filter((x) => x !== p.id) : [...a, p.id],
                )
              }
            />
            <span>
              <strong>{p.label}</strong>
              <small>{p.model}</small>
              <em>{p.configured ? '연결 준비됨' : 'API 키 설정 필요'}</em>
            </span>
          </label>
        ))}
      </div>
      <label className="intro-consent">
        <input
          type="checkbox"
          checked={consent}
          disabled={disabled}
          onChange={(e) => setConsent(e.target.checked)}
        />
        선택한 외부 서비스에 저장된 이력서 본문을 전송합니다. 연락처 등
        개인정보를 확인했습니다.
      </label>
      <button
        className="btn primary"
        disabled={disabled || !consent || !available.length}
        onClick={() =>
          void run(
            'generate',
            available.map((p) => p.id),
          )
        }
      >
        <Sparkles size={16} />
        {running ? '소개를 만들고 있어요…' : '선택한 모델로 3줄 소개 비교'}
      </button>
      <p className="cf-help">
        같은 이력서와 요청 조건으로 비교합니다. 같은 모델의 저장 결과는
        재사용합니다. 소개는 최대 3문장이며 화면 너비에 따라 줄이 바뀔 수
        있습니다.
      </p>
      {Object.entries(errors).map(([id, error]) => (
        <p role="alert" className="studio-error" key={id}>
          {error}
        </p>
      ))}
      <div className="intro-results">
        {providers.map((p) => {
          const r = profile.analysis.introductions?.find(
            (x) => x.provider === p.id,
          );
          if (!r) return null;
          return (
            <article
              key={p.id}
              className={chosen?.provider === p.id ? 'chosen' : ''}
            >
              <div className="studio-heading">
                <h3>{p.label}</h3>
                {chosen?.provider === p.id && <Check size={18} />}
              </div>
              <small>{r.model}</small>
              <div className="intro-lines">
                {r.lines.map((l, i) => (
                  <p key={i}>{l.text}</p>
                ))}
              </div>
              <div className="intro-metrics">
                <span>
                  <Clock3 size={13} /> {(r.latencyMs / 1000).toFixed(1)}초
                </span>
                <span>
                  입력 {r.inputTokens ?? '미제공'} / 출력{' '}
                  {r.outputTokens ?? '미제공'} 토큰
                </span>
              </div>
              <details>
                <summary>문장별 원문 근거</summary>
                {r.lines.map((l, i) => (
                  <div key={i}>
                    <b>{i + 1}번째 문장</b>
                    {l.evidence.map((q, j) => (
                      <blockquote key={j}>{q}</blockquote>
                    ))}
                  </div>
                ))}
              </details>
              <button
                className="btn"
                disabled={disabled || chosen?.provider === p.id}
                onClick={() => void run('select', [p.id])}
              >
                {chosen?.provider === p.id
                  ? '나의 소개로 선택됨'
                  : '이 소개 선택'}
              </button>
            </article>
          );
        })}
      </div>
      {!providers.some((p) => p.configured) && (
        <details>
          <summary>API 연결 준비하기</summary>
          <p className="cf-help">
            서버의 .env.local에 발급받은 키를 넣고 개발 서버를 다시 실행하세요.
            키는 브라우저 입력란에 넣지 않습니다.
          </p>
          <div className="studio-chips">
            {providers.map((p) => (
              <code key={p.id}>{p.keyName}</code>
            ))}
          </div>
        </details>
      )}
      <p className="cf-help">
        모델의 초안입니다. 원문 근거가 문장을 충분히 뒷받침하는지, 한국어가
        자연스러운지 확인한 뒤 선택해주세요.
      </p>
    </section>
  );
}
