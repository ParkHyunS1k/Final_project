// 공개 프로필. 본인이 켠 경우에만 열리고, 아니면 없는 페이지로 응답한다. 검색엔진에는 올리지 않는다.
import { cache } from 'react';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { readPublicProfile } from '@/lib/profile-store';
import { PublicProfileView } from '@/components/public-profile';
import '../u.css';
export const dynamic = 'force-dynamic';

// 메타데이터와 화면이 같은 요청에서 한 번만 읽는다.
const load = cache((handle: string) => readPublicProfile(handle));

type Props = { params: Promise<{ handle: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const profile = await load((await params).handle);
  if (!profile) return { title: 'ProjectMate', robots: { index: false, follow: false } };
  return {
    title: `${profile.displayName} · ProjectMate`,
    description: '7일 스프린트에서 완주한 프로젝트와 등급·뱃지',
    robots: { index: false, follow: false },
  };
}

export default async function PublicProfilePage({ params }: Props) {
  const profile = await load((await params).handle);
  if (!profile) notFound();
  return <PublicProfileView profile={profile} now={new Date()} />;
}
