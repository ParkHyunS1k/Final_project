// 카드 이미지용 한글 글꼴(Pretendard, OFL-1.1, KS X 1001 부분 글꼴). 요청과 상관없어 모듈에서 한 번 읽는다.
// KS X 1001 밖의 드문 음절은 기본 글꼴로 보일 수 있다.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const bold = readFile(join(process.cwd(), 'assets/fonts/Pretendard-Bold.subset.woff'));
const black = readFile(join(process.cwd(), 'assets/fonts/Pretendard-Black.subset.woff'));

export async function cardFonts() {
  const [b, k] = await Promise.all([bold, black]);
  return [
    { name: 'Pretendard', data: b, weight: 700 as const, style: 'normal' as const },
    { name: 'Pretendard', data: k, weight: 900 as const, style: 'normal' as const },
  ];
}
