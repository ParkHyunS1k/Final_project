// 학습한 날 칸(최근 weeks주). 마이페이지와 공개 프로필이 같이 쓴다. 공부한 날만 on.
const DAY_MS = 86_400_000;
const seoulDate = (d: Date) => new Date(d.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);

/** 오늘(서울)로 끝나는 weeks주 칸. */
export function studyCalendar(dates: string[], now: Date, weeks = 12) {
  const studied = new Set(dates);
  const today = Date.parse(seoulDate(now) + 'T00:00:00Z');
  return Array.from({ length: weeks * 7 }, (_, i) => {
    const date = new Date(today - (weeks * 7 - 1 - i) * DAY_MS).toISOString().slice(0, 10);
    return { date, on: studied.has(date) };
  });
}
