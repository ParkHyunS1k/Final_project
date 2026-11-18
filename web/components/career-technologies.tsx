'use client';
import { useState } from 'react';
import type { Profile, Technology } from '@/lib/career/profile';
import { skillName } from '@/lib/career/catalog';
export function CareerTechnologies({
  profile,
  disabled,
  onSave,
}: {
  profile: Profile;
  disabled: boolean;
  onSave: (
    changes: { name: string; state: Technology['state'] }[],
  ) => Promise<void>;
}) {
  const [changes, setChanges] = useState<Record<string, Technology['state']>>(
    {},
  );
  const technologies = profile.analysis.technologies;
  const groups = technologies
    ? [
        {
          title: '사용 경험',
          names: technologies
            .filter((t) => t.state === 'used')
            .map((t) => t.name),
        },
        {
          title: '학습 또는 실습',
          names: technologies
            .filter((t) => t.state === 'studied')
            .map((t) => t.name),
        },
        {
          title: '기술 목록에 명시',
          names: technologies
            .filter((t) => t.state === 'listed')
            .map((t) => t.name),
        },
      ]
    : [
        {
          title: '사용 경험',
          names: profile.analysis.skills
            .filter((s) => s.level === 'applied')
            .map((s) => skillName(s.skillId)),
        },
        {
          title: '학습 또는 실습',
          names: profile.analysis.skills
            .filter((s) => s.level === 'learning')
            .map((s) => skillName(s.skillId)),
        },
        {
          title: '언급된 역량',
          names: profile.analysis.skills
            .filter((s) => s.level === 'mentioned')
            .map((s) => skillName(s.skillId)),
        },
      ];
  return (
    <div className="technology-summary">
      {groups
        .filter((g) => g.names.length)
        .map((g) => (
          <div key={g.title}>
            <h3>{g.title}</h3>
            <div className="studio-chips">
              {g.names.map((name) => (
                <span key={name}>
                  {name.replace(
                    /[\u00b7\u2022\u2027\u2219\u22c5\u30fb\uff65]/g,
                    ', ',
                  )}
                </span>
              ))}
            </div>
          </div>
        ))}
      {!groups.some((g) => g.names.length) && (
        <p>현재 이력서에서 사용 또는 학습 근거를 찾지 못했습니다.</p>
      )}
      <p className="cf-help">
        이력서 문맥에 대한 분석 초안입니다. 기술 이름이 있다는 사실만으로
        숙련도를 평가하지 않습니다.
      </p>
      {!!technologies?.length && (
        <details>
          <summary>기술을 찾은 문장 확인</summary>
          {technologies.map((t) => (
            <div className="tech-source" key={t.name}>
              <strong>{t.name}</strong>
              <small>
                {
                  {
                    used: '사용 경험',
                    studied: '학습 또는 실습',
                    listed: '기술 목록에 명시',
                    planned: '계획으로 분류, 사용 목록에서 제외',
                    other: '타인 경험으로 분류, 사용 목록에서 제외',
                    denied: '미사용으로 분류, 사용 목록에서 제외',
                    unclear: '판단 보류',
                  }[t.state]
                }
              </small>
              <label className="cf-help">
                경험 분류 수정
                <select
                  aria-label={`${t.name} 경험 분류`}
                  value={changes[t.name] ?? t.state}
                  disabled={disabled}
                  onChange={(e) =>
                    setChanges((c) => ({
                      ...c,
                      [t.name]: e.target.value as Technology['state'],
                    }))
                  }
                >
                  <option value="used">사용 경험</option>
                  <option value="studied">학습 또는 실습</option>
                  <option value="listed">기술 목록에 명시</option>
                  <option value="planned">계획</option>
                  <option value="other">타인 경험</option>
                  <option value="denied">미사용</option>
                  <option value="unclear">판단 보류</option>
                </select>
              </label>
              {t.reviewed && <small>내가 수정한 분류</small>}
              {[...new Set(t.mentions.map((m) => m.text))].map((text, i) => (
                <blockquote key={i}>{text}</blockquote>
              ))}
            </div>
          ))}
          <p className="cf-help">
            기술명이 등장한 원문 위치입니다. 해당 문장만으로 실제 사용 여부가
            증명되는 것은 아닙니다.
          </p>
          <button
            className="btn"
            disabled={disabled || !Object.keys(changes).length}
            onClick={() =>
              void onSave(
                Object.entries(changes).map(([name, state]) => ({
                  name,
                  state,
                })),
              )
            }
          >
            기술 분류 수정 저장
          </button>
        </details>
      )}
    </div>
  );
}
