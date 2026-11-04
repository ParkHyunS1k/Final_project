import { CareerError, type ProfileInput } from './profile';

export function sourceLines(text: string) {
  const lines: { id: number; start: number; end: number; text: string }[] = [];
  let start = 0;
  while (start < text.length) {
    const newline = text.indexOf('\n', start);
    const end = Math.min(newline < 0 ? text.length : newline, start + 240);
    if (end > start && text.slice(start, end).trim())
      lines.push({
        id: lines.length + 1,
        start,
        end,
        text: text.slice(start, end),
      });
    start = end === newline ? end + 1 : end;
  }
  return lines;
}

export function resolveLocalEvidence(raw: unknown, input: ProfileInput) {
  if (!raw || typeof raw !== 'object')
    throw new CareerError('로컬 모델의 JSON 형식을 확인하지 못했습니다.', 502);
  const value = raw as Record<string, unknown>;
  const result: Record<string, unknown> = {
    summary: value.summary,
    questions: value.questions,
  };
  for (const [field, source] of [
    ['skills', input.resumeText],
    ['requirements', input.targetPosting],
  ] as const) {
    const rows = value[field];
    if (!Array.isArray(rows) || rows.length > 12)
      throw new CareerError(
        '로컬 모델의 근거 목록을 확인하지 못했습니다.',
        502,
      );
    const lines = sourceLines(source);
    result[field] = rows.map((row: unknown) => {
      if (!row || typeof row !== 'object')
        throw new CareerError(
          '로컬 모델의 근거 항목을 확인하지 못했습니다.',
          502,
        );
      const item = row as Record<string, unknown>;
      const first = Number(item.startLine),
        last = Number(item.endLine);
      if (
        typeof item.startLine !== 'number' ||
        typeof item.endLine !== 'number' ||
        !Number.isInteger(first) ||
        !Number.isInteger(last) ||
        first < 1 ||
        last < first ||
        last > lines.length ||
        lines[last - 1].end - lines[first - 1].start > 1200
      )
        throw new CareerError(
          '로컬 모델이 유효하지 않은 원문 범위를 선택했습니다. 다시 분석해주세요.',
          502,
        );
      return {
        skillId: item.skillId,
        ...(field === 'skills'
          ? { level: item.level }
          : { importance: item.importance }),
        quote: source.slice(lines[first - 1].start, lines[last - 1].end),
      };
    });
  }
  return result;
}
