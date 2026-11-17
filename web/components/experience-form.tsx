'use client';
// 완료한 내 업무를 경험으로 가져오는 확인 양식. 커리어 작업 공간과 마이페이지가 같이 쓴다.
import { useState } from 'react';
import { skillName, type SkillId } from '@/lib/career/catalog';

function toggle<T>(items: T[], item: T) {
  return items.includes(item) ? items.filter((v) => v !== item) : [...items, item];
}
export function ExperienceForm({
  task,
  busy,
  onSave,
}: {
  task: { title: string; evidence: string; skills: SkillId[] };
  busy: boolean;
  onSave: (values: Record<string, unknown>) => Promise<void>;
}) {
  const [skills, setSkills] = useState<SkillId[]>([]);
  const [contribution, setContribution] = useState('');
  return (
    <form
      className="cf-experience cf-form"
      onSubmit={(e) => {
        e.preventDefault();
        void onSave({ skillIds: skills, contribution, confirmed: true });
      }}
    >
      <fieldset disabled={busy}>
        <h4>{task.title}</h4>
        <blockquote>{task.evidence}</blockquote>
        <legend className="sr-only">개인 기여 확인</legend>
        <p>실제로 직접 수행한 역량만 선택해주세요.</p>
        <div className="cf-choice-grid">
          {task.skills.map((s) => (
            <label key={s}>
              <input
                type="checkbox"
                checked={skills.includes(s)}
                onChange={() => setSkills(toggle(skills, s))}
              />
              {skillName(s)}
            </label>
          ))}
        </div>
        <label>
          구체적인 본인 기여
          <textarea
            required
            minLength={10}
            maxLength={1000}
            rows={3}
            value={contribution}
            onChange={(e) => setContribution(e.target.value)}
            placeholder="직접 구현·검증한 부분과 협업한 부분을 구분해주세요."
          />
        </label>
        <label className="cf-agreement">
          <input type="checkbox" required />위 근거와 설명이 본인이 수행한
          내용을 나타내는지 확인했습니다.
        </label>
        <button className="btn" disabled={busy || !skills.length}>
          경험 기록에 추가하기
        </button>
      </fieldset>
    </form>
  );
}
