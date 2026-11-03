'use client';
import { useState, type SubmitEvent } from 'react';
import { SKILLS, type SkillId } from '@/lib/career/catalog';
import type { Profile, SkillEvidence, Requirement } from '@/lib/career/profile';

export function CareerAnalysisReview({
  profile,
  disabled,
  unsaved,
  onSave,
}: {
  profile: Profile;
  disabled: boolean;
  unsaved: boolean;
  onSave: (
    skills: SkillEvidence[],
    requirements: Requirement[],
  ) => Promise<void>;
}) {
  const [skills, setSkills] = useState(profile.analysis.skills);
  const [requirements, setRequirements] = useState(
    profile.analysis.requirements,
  );
  function toggleSkill(id: SkillId) {
    setSkills((rows) =>
      rows.some((r) => r.skillId === id)
        ? rows.filter((r) => r.skillId !== id)
        : [
            ...rows,
            { skillId: id, level: 'mentioned', quote: '', source: 'resume' },
          ],
    );
  }
  function toggleRequirement(id: SkillId) {
    setRequirements((rows) =>
      rows.some((r) => r.skillId === id)
        ? rows.filter((r) => r.skillId !== id)
        : [...rows, { skillId: id, importance: 'required', quote: '' }],
    );
  }
  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    await onSave(skills, requirements);
  }
  return (
    <details className="cf-analysis-review">
      <summary>역량과 공고 요건 검토 및 수정</summary>
      <p className="cf-help">
        잘못 찾은 항목은 체크를 해제하고, 누락한 항목은 추가하세요. 근거는
        저장된 원문에서 그대로 복사해주세요. 기술 목록이나 팀원의 구현을 본인의
        수행 근거로 올리지 마세요.
      </p>
      {unsaved && (
        <output>
          왼쪽 원문에 수정사항이 있습니다. 먼저 역량 분석을 저장한 뒤
          검토해주세요.
        </output>
      )}
      <form onSubmit={submit} className="cf-form">
        <fieldset disabled={disabled || unsaved}>
          <legend>이력서 역량</legend>
          {SKILLS.map(({ id, name }) => {
            const row = skills.find((s) => s.skillId === id);
            return (
              <div className="cf-review-row" key={id}>
                <label>
                  <input
                    type="checkbox"
                    checked={!!row}
                    onChange={() => toggleSkill(id)}
                  />
                  {name}
                </label>
                {row && (
                  <>
                    <label>
                      경험 구분
                      <select
                        aria-label={`${name} 경험 구분`}
                        value={row.level}
                        onChange={(e) =>
                          setSkills((rows) =>
                            rows.map((s) =>
                              s.skillId === id
                                ? {
                                    ...s,
                                    level: e.target
                                      .value as SkillEvidence['level'],
                                  }
                                : s,
                            ),
                          )
                        }
                      >
                        <option value="mentioned">단순 언급</option>
                        <option value="learning">학습 및 실습</option>
                        <option value="applied">수행 근거</option>
                      </select>
                    </label>
                    <label>
                      이력서 원문 근거
                      <textarea
                        aria-label={`${name} 이력서 근거`}
                        value={row.quote}
                        required
                        minLength={3}
                        maxLength={2000}
                        rows={3}
                        onChange={(e) =>
                          setSkills((rows) =>
                            rows.map((s) =>
                              s.skillId === id
                                ? { ...s, quote: e.target.value }
                                : s,
                            ),
                          )
                        }
                      />
                    </label>
                  </>
                )}
              </div>
            );
          })}
        </fieldset>
        {!!profile.targetPosting && (
          <fieldset disabled={disabled || unsaved}>
            <legend>목표 공고 요건</legend>
            {SKILLS.map(({ id, name }) => {
              const row = requirements.find((s) => s.skillId === id);
              return (
                <div className="cf-review-row" key={id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={!!row}
                      onChange={() => toggleRequirement(id)}
                    />
                    {name}
                  </label>
                  {row && (
                    <>
                      <label>
                        요건 구분
                        <select
                          aria-label={`${name} 요건 구분`}
                          value={row.importance}
                          onChange={(e) =>
                            setRequirements((rows) =>
                              rows.map((s) =>
                                s.skillId === id
                                  ? {
                                      ...s,
                                      importance: e.target
                                        .value as Requirement['importance'],
                                    }
                                  : s,
                              ),
                            )
                          }
                        >
                          <option value="required">필수</option>
                          <option value="preferred">우대</option>
                        </select>
                      </label>
                      <label>
                        공고 원문 근거
                        <textarea
                          aria-label={`${name} 공고 근거`}
                          value={row.quote}
                          required
                          minLength={3}
                          maxLength={2000}
                          rows={3}
                          onChange={(e) =>
                            setRequirements((rows) =>
                              rows.map((s) =>
                                s.skillId === id
                                  ? { ...s, quote: e.target.value }
                                  : s,
                              ),
                            )
                          }
                        />
                      </label>
                    </>
                  )}
                </div>
              );
            })}
          </fieldset>
        )}
        <p className="cf-help">
          저장하면 새 프로필 버전으로 보관하고 추천을 다시 계산합니다. 외부 AI
          호출은 하지 않습니다. 근거가 실제 능력을 입증하는지는 본인이
          확인해주세요.
        </p>
        <button
          className="btn btn-primary"
          type="submit"
          disabled={disabled || unsaved}
        >
          수정한 근거 저장
        </button>
      </form>
    </details>
  );
}
