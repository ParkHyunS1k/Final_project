import type { Profile } from '@/lib/career/profile';

export function CareerIntroduction({ profile }: { profile: Profile }) {
  const { workSummary, introductions, selectedIntroduction } = profile.analysis;
  const savedIntroduction =
    workSummary ??
    introductions?.find((item) => item.provider === selectedIntroduction);
  const line = savedIntroduction?.lines[0];
  if (!line) return null;

  return (
    <div className="intro-selected">
      <h3>한 문장 소개</h3>
      <p>{line.text}</p>
      {line.evidence.length > 0 && (
        <details className="work-summary-detail">
          <summary>소개 근거</summary>
          {line.evidence.map((quote) => (
            <blockquote key={quote}>{quote}</blockquote>
          ))}
        </details>
      )}
    </div>
  );
}
