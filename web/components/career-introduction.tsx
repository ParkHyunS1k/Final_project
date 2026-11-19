import type { IntroResult, Profile } from '@/lib/career/profile';

const PROVIDERS = {
  openai: 'OpenAI',
  anthropic: 'Claude',
  google: 'Gemini',
};

export function CareerIntroduction({
  profile,
  disabled,
  onSelect,
}: {
  profile: Profile;
  disabled: boolean;
  onSelect: (provider: IntroResult['provider']) => void;
}) {
  const summaries = profile.analysis.workSummaries ?? [];
  const primary =
    summaries.find(
      (summary) => summary.provider === profile.analysis.workSummaryProvider,
    ) ?? summaries[0];
  const line = primary?.lines[0];
  if (!line) return null;

  return (
    <>
      <div className="intro-selected">
        <h3>한 문장 소개</h3>
        <p>{line.text}</p>
        {summaries.length === 1 && (
          <details>
            <summary>소개 근거와 모델</summary>
            <WorkSummaryDetails result={primary} />
          </details>
        )}
      </div>
      {summaries.length > 1 && (
        <section className="work-summary-compare" aria-label="모델별 소개 비교">
          <h3>모델별 한 문장 비교</h3>
          <div className="work-summary-grid">
            {summaries.map((summary) => (
              <article key={summary.provider} className="work-summary-option">
                <h4>{PROVIDERS[summary.provider]}</h4>
                <p>{summary.lines[0]?.text}</p>
                <details>
                  <summary>근거와 응답 정보</summary>
                  <WorkSummaryDetails result={summary} />
                </details>
                <button
                  type="button"
                  className="btn"
                  disabled={disabled || summary.provider === primary.provider}
                  onClick={() => onSelect(summary.provider)}
                >
                  {summary.provider === primary.provider
                    ? '선택한 소개'
                    : '이 소개 사용하기'}
                </button>
              </article>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

function WorkSummaryDetails({ result }: { result: IntroResult }) {
  const metrics = [
    result.model,
    `${(result.latencyMs / 1000).toFixed(1)}초`,
    result.inputTokens != null ? `입력 ${result.inputTokens} 토큰` : '',
    result.outputTokens != null ? `출력 ${result.outputTokens} 토큰` : '',
  ].filter(Boolean);
  return (
    <div className="work-summary-detail">
      <small>{metrics.join(', ')}</small>
      {result.lines[0]?.evidence.map((quote) => (
        <blockquote key={quote}>{quote}</blockquote>
      ))}
    </div>
  );
}
