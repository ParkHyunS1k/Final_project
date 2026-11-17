// 공개 프로필(/u/<아이디>) 화면. 로그인 없이 누구나 본다. 본인 기록만 담고 팀원 정보는 없다.
// 숫자는 매일 일괄 계산한 저장값(standing)이라 마이페이지·카드와 같다.
import { skillName } from '@/lib/career/catalog';
import { studyCalendar } from '@/lib/study-calendar';
import type { PublicProfile } from '@/lib/profile-store';

const HOME_HREF = '/';
const ROLE = { owner: '팀장', member: '팀원', solo: '솔로' } as const;
const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric' }) : '';
export const basisLabel = (iso: string) =>
  new Date(iso).toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }) + ' 기준';

export function PublicProfileView({ profile, now }: { profile: PublicProfile; now: Date }) {
  const s = profile.standing;
  const cells = studyCalendar(profile.dates, now);
  return (
    <main className="pp">
      <section className="pp-hero">
        <div className="pp-who">
          <p className="pp-brand">
            <span>p.</span> projectmate · 7일 스프린트 기록
          </p>
          <h1>{profile.displayName}</h1>
          <p>
            {[profile.target && `${profile.target} 목표`, profile.github && `@${profile.github}`].filter(Boolean).join(' · ')}
          </p>
        </div>
        <div className="pp-score">
          <b className="pp-grade">{s?.grade ?? 'E'}</b>
          {s?.score != null && <span>{`${s.score} / 5`}</span>}
          {s?.percentile != null && <span className="pp-top">{`상위 ${s.percentile}%`}</span>}
          <small>{s ? basisLabel(s.computedAt) : '매일 새벽에 계산돼요'}</small>
        </div>
      </section>
      <dl className="pp-stats">
        <div>
          <dt>완주한 프로젝트</dt>
          <dd>{`${profile.finished}개`}</dd>
        </div>
        <div>
          <dt>연속 학습</dt>
          <dd>{`${profile.streak}일`}</dd>
        </div>
        <div>
          <dt>받은 뱃지</dt>
          <dd>{`${profile.badges.length}개`}</dd>
        </div>
      </dl>
      {!!profile.badges.length && (
        <section className="pp-card">
          <h2>뱃지</h2>
          <ul className="pp-badges">
            {profile.badges.map((b) => (
              <li key={b.id}>
                <b>{b.label}</b>
                {b.count > 1 && <small>{`×${b.count}`}</small>}
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="pp-card">
        <h2>학습한 날</h2>
        <p className="sr-only">{`최근 12주 중 ${cells.filter((c) => c.on).length}일 학습`}</p>
        <div className="pp-calendar" aria-hidden="true">
          {cells.map((c) => (
            <i key={c.date} className={c.on ? 'on' : undefined} />
          ))}
        </div>
      </section>
      {!!profile.projects.length && (
        <section className="pp-card">
          <h2>완주한 프로젝트</h2>
          <ul className="pp-projects">
            {profile.projects.map((p) => (
              <li key={p.id}>
                <div>
                  <b>{p.title}</b>
                  <span>
                    {[
                      p.startedAt && `${day(p.startedAt)} – ${day(p.deadlineAt)}`,
                      p.role === 'solo' ? '솔로' : `${p.members}인 팀 · ${ROLE[p.role]}`,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </div>
                {p.grade && <span className="pp-pill">{p.grade}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {!!profile.experiences.length && (
        <section className="pp-card">
          <h2>내가 한 업무</h2>
          {profile.experiences.map((e) => (
            <article key={e.id} className="pp-exp">
              {e.projectTitle && <span className="pp-meta">{e.projectTitle}</span>}
              <h3>{e.title}</h3>
              <p>{e.bullet}</p>
              <p className="pp-meta">{e.skills.map((id) => skillName(id)).join(' · ')}</p>
              {e.evidence && (
                <details>
                  <summary>완료 근거</summary>
                  <blockquote>{e.evidence}</blockquote>
                </details>
              )}
            </article>
          ))}
        </section>
      )}
      <footer className="pp-foot">
        <a className="pp-cta" href={HOME_HREF}>
          나도 7일 스프린트 시작하기
        </a>
      </footer>
    </main>
  );
}
