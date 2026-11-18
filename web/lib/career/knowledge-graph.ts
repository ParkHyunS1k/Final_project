import type { Profile } from './profile';
import type { Experience } from './store';
import { skillName } from './catalog';

export type KnowledgeNode = {
  id: string;
  label: string;
  kind: 'person' | 'project' | 'technology' | 'competency';
  description: string;
  evidence: string[];
  degree: number;
};
export type KnowledgeLink = { source: string; target: string; label: string };
export type KnowledgeGraph = { nodes: KnowledgeNode[]; links: KnowledgeLink[] };
type Portfolio = {
  id: string;
  kind: string;
  payload: { title?: string; text?: string; skills?: string[] };
};
type GraphExperience = Pick<
  Experience,
  | 'id'
  | 'project_id'
  | 'task_title'
  | 'skill_ids'
  | 'evidence'
  | 'contribution'
  | 'resume_bullet'
  | 'valid'
>;
const clean = (text: string) =>
  text.replace(/[\u00b7\u2022\u2027\u2219\u22c5\u30fb\uff65]/g, ', ');

/** Explicit project headings only. Shared text does not prove use in that project. */
export function resumeProjects(text: string) {
  const lines = text.split('\n');
  const result: { title: string; text: string }[] = [];
  let current: { title: string; text: string } | undefined;
  for (const line of lines) {
    if (
      /^\s*(?:#{1,4}\s*)?(?:프로젝트|project)\s*(?:\d+\s*)?[.:：)-]\s*\S/i.test(
        line,
      )
    ) {
      current = { title: line.replace(/^\s*#{1,4}\s*/, '').trim(), text: line };
      result.push(current);
    } else if (
      /^\s*(?:#{1,4}\s*)?(?:\d+[.)]\s*)?(?:교육|자격|학력|보유 기술|기술 스택|학습|개인 학습|경력|자기소개|지원 동기|협업|성장|기타)(?:\s*[:：]|[^.!?\n]{0,35}$)/.test(
        line,
      )
    )
      current = undefined;
    else if (current) current.text += '\n' + line;
  }
  return result.slice(0, 15);
}

export function buildKnowledgeGraph(
  profile: Profile | null,
  experiences: GraphExperience[] = [],
  portfolios: Portfolio[] = [],
): KnowledgeGraph {
  const nodes = new Map<string, KnowledgeNode>();
  const links = new Map<string, KnowledgeLink>();
  const add = (
    id: string,
    label: string,
    kind: KnowledgeNode['kind'],
    description: string,
    evidence: string[],
  ) => {
    const prior = nodes.get(id);
    nodes.set(id, {
      id,
      label: clean(label),
      kind,
      description,
      evidence: [...new Set([...(prior?.evidence ?? []), ...evidence])],
      degree: 0,
    });
  };
  const link = (source: string, target: string, label: string) => {
    if (source !== target && nodes.has(source) && nodes.has(target))
      links.set(`${source}|${target}`, { source, target, label });
  };
  if (
    !profile &&
    !experiences.some((e) => e.valid) &&
    !portfolios.some((p) => p.kind === 'portfolio')
  )
    return { nodes: [], links: [] };
  add(
    'me',
    '나',
    'person',
    '내 계정에 저장한 경험과 기술의 연결입니다. 이력서의 기재 내용은 실력 인증이 아닙니다.',
    [],
  );
  const projects = resumeProjects(profile?.resumeText ?? '');
  projects.forEach((p, i) => {
    add(`resume:${i}`, p.title, 'project', '이력서에 직접 적은 프로젝트', [
      p.text,
    ]);
    link('me', `resume:${i}`, '이력서에 기재');
  });
  for (const t of profile?.analysis.technologies ?? []) {
    if (!['used', 'studied', 'listed'].includes(t.state)) continue;
    const id = `tech:${t.name}`;
    const state =
      t.state === 'used'
        ? '사용 경험으로 분류'
        : t.state === 'studied'
          ? '학습 또는 실습으로 분류'
          : '기술 목록에 명시';
    add(
      id,
      t.name,
      'technology',
      `${state}. 전체 이력서 문맥에 대한 모델의 초안입니다.`,
      t.mentions.map((m) => m.text),
    );
    link('me', id, state);
    projects.forEach((p, i) => {
      if (t.mentions.some((m) => p.text.includes(m.text)))
        link(`resume:${i}`, id, '프로젝트 원문에 함께 등장');
    });
  }
  for (const s of profile?.analysis.skills ?? []) {
    if (profile?.noExperience.includes(s.skillId)) continue;
    const name = clean(skillName(s.skillId));
    const existing = [...nodes.values()].find(
      (n) =>
        n.kind === 'technology' && n.label.toLowerCase() === name.toLowerCase(),
    );
    const id = existing?.id ?? `skill:${s.skillId}`;
    if (!existing)
      add(id, name, 'competency', '저장된 역량 분석에서 가져온 항목', [
        s.quote,
      ]);
    link('me', id, '역량 분석에 기재');
    projects.forEach((p, i) => {
      if (s.quote && p.text.includes(s.quote))
        link(`resume:${i}`, id, '역량 근거가 있는 경험');
    });
  }
  for (const e of experiences.filter((e) => e.valid)) {
    const id = `experience:${e.id}`;
    add(
      id,
      e.task_title,
      'project',
      '사이트에서 완료한 업무의 유효한 경험 기록',
      [e.contribution, e.resume_bullet, e.evidence].filter(Boolean),
    );
    link('me', id, '완료한 업무');
    for (const skill of e.skill_ids) {
      const sid = `skill:${skill}`;
      add(sid, skillName(skill), 'competency', '경험 기록에 연결한 역량', [
        e.resume_bullet,
      ]);
      link(id, sid, '경험 기록의 역량');
    }
  }
  for (const p of portfolios
    .filter((p) => p.kind === 'portfolio')
    .slice(0, 15)) {
    const id = `portfolio:${p.id}`;
    add(
      id,
      p.payload.title || '포트폴리오',
      'project',
      '내가 등록한 포트폴리오',
      [p.payload.text || '본문이 아직 없습니다.'],
    );
    link('me', id, '포트폴리오 등록');
    for (const skill of p.payload.skills ?? []) {
      const sid = `skill:${skill}`;
      add(
        sid,
        skillName(skill),
        'competency',
        '내가 포트폴리오에 연결한 역량',
        [p.payload.text || '등록자가 선택한 역량입니다.'],
      );
      link(id, sid, '등록자가 연결');
    }
  }
  for (const l of links.values()) {
    nodes.get(l.source)!.degree++;
    nodes.get(l.target)!.degree++;
  }
  return { nodes: [...nodes.values()], links: [...links.values()] };
}
