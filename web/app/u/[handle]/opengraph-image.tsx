// 링크 미리보기(1200×630). 공개 프로필 링크를 블로그·SNS에 붙이면 이 이미지가 뜬다.
import { ImageResponse } from 'next/og';
import { headers } from 'next/headers';
import { readPublicProfile } from '@/lib/profile-store';
import { ProfileCard } from '@/components/profile-card';
import { cardFonts } from '@/lib/card-font';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const alt = 'ProjectMate 프로필 카드';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image({ params }: { params: Promise<{ handle: string }> }) {
  const profile = await readPublicProfile((await params).handle);
  if (!profile) return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  const host = (await headers()).get('host') ?? '';
  return new ImageResponse(<ProfileCard profile={profile} size="og" host={host} />, {
    ...size,
    fonts: await cardFonts(),
    headers: { 'Cache-Control': 'no-store' },
  });
}
