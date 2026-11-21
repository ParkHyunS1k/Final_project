// 팀 찾기 목록을 채우는 예시 팀 6개(준비 중·공개). 사용자 결정 2026-11-21: 운영에도 표시 없이 넣는다.
// 실제 생성 경로(createTemplateProject)를 그대로 쓰고, 팀원만 직접 넣는다. 같은 request_id라 다시 실행해도 중복되지 않는다.
// 사용: npx tsx scripts/seed-demo-teams.ts  (DATABASE_URL이 있으면 그 DB, 없으면 로컬 PGlite)
// 지우기: user_id가 'demo-team-'로 시작하는 팀장의 프로젝트.
import { createTemplateProject } from '../lib/hub';
import { database } from '../lib/db';

const TEAMS = [
  { template: 'job-tracker', scope: 2, lead: '하준', mates: ['지우'] },
  { template: 'study-checkin', scope: 1, lead: '서윤', mates: [] },
  { template: 'review-insights', scope: 2, lead: '민재', mates: ['예린', '도현'] },
  { template: 'faq-assistant', scope: 3, lead: '수아', mates: ['태윤'] },
  { template: 'team-wiki', scope: 1, lead: '지호', mates: [] },
  { template: 'issue-triage', scope: 2, lead: '은서', mates: ['시우'] },
];
const who = (key: string, name: string) => ({
  id: `demo-team-${key}`,
  email: `demo-team-${key}@projectmate.local`,
  name,
});

const db = database();
for (const [i, t] of TEAMS.entries()) {
  const lead = who(`${i + 1}-lead`, t.lead);
  const id = await createTemplateProject(lead, {
    templateId: t.template,
    scopeLevel: t.scope,
    mode: 'team',
    listed: true,
    agreed: true,
    requestId: `demo-team-seed-${i + 1}`,
  });
  for (const [j, name] of t.mates.entries()) {
    const mate = who(`${i + 1}-mate${j + 1}`, name);
    await db
      .prepare(
        "INSERT INTO project_members(project_id,user_id,display_name,role,person,agreed_at,agreed_goal_version,joined_at,email) VALUES(?,?,?,'member',?,now(),1,now(),?) ON CONFLICT DO NOTHING",
      )
      .bind(id, mate.id, mate.name, j + 1, mate.email)
      .run();
  }
  console.log(`${id}  ${t.template}  팀원 ${t.mates.length + 1}명`);
}
process.exit(0);
