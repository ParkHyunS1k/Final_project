// 스토리용 자랑 카드(1080×1920 PNG) 내려받기. 꺼졌거나 없는 프로필은 404, 캐시하지 않는다.
import { readPublicProfile } from '@/lib/profile-store';
import { ProfileCard } from '@/components/profile-card';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request, { params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const profile = await readPublicProfile(handle);
  if (!profile) return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  // 이미지 생성 모듈은 실제로 그릴 때만 불러온다.
  const [{ ImageResponse }, { cardFonts }] = await Promise.all([import('next/og'), import('@/lib/card-font')]);
  return new ImageResponse(<ProfileCard profile={profile} size="story" host={new URL(request.url).host} />, {
    width: 1080,
    height: 1920,
    fonts: await cardFonts(),
    headers: {
      'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename="projectmate-${profile.handle}.png"`,
    },
  });
}
