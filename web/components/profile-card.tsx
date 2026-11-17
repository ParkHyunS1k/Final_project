// 자랑 카드(시안 A: 큰 등급 글자 + 결승선 체크무늬 + 완주 수). next/og(satori)로 PNG를 만든다.
// satori 제약: flex 배치만, 자식이 여럿인 div는 display:flex, 스타일은 인라인.
import type { PublicProfile } from '@/lib/profile-store';

const C = { bg: '#0b0b0c', ink: '#f4f2ee', muted: '#b0ada5', heat: '#ff5a1f', heatText: '#ff8a5c', soft: '#2b1a12', line: '#34343a' };

function Checker({ width, cell }: { width: number; cell: number }) {
  const n = Math.ceil(width / cell);
  const row = (offset: number) => (
    <div style={{ display: 'flex' }}>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} style={{ width: cell, height: cell, background: (i + offset) % 2 ? C.bg : C.ink }} />
      ))}
    </div>
  );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', width, overflow: 'hidden' }}>
      {row(0)}
      {row(1)}
    </div>
  );
}

export function ProfileCard({ profile, size, host = '' }: { profile: PublicProfile; size: 'og' | 'story'; host?: string }) {
  const s = profile.standing;
  const grade = s?.grade ?? 'E';
  const scoreLine =
    s?.score != null && s.percentile != null ? `${s.score} / 5 · 상위 ${s.percentile}%` : '평가를 받으면 상위 %가 나와요';
  const stats = `완주 ${profile.finished} · 연속 학습 ${profile.streak}일`;
  const url = `${host}/u/${profile.handle}`;
  const badges = profile.badges.slice(0, 4);
  const story = size === 'story';
  const k = story ? 1 : 0.62; // 글자 크기 비율
  const badgeRow = (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 * k }}>
      {badges.map((b) => (
        <div
          key={b.id}
          style={{ display: 'flex', fontSize: 30 * k, color: C.ink, border: `2px solid ${C.heat}`, borderRadius: 99, padding: `${8 * k}px ${20 * k}px` }}
        >
          {b.count > 1 ? `${b.label} ×${b.count}` : b.label}
        </div>
      ))}
    </div>
  );
  const brand = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 * k, fontSize: 34 * k, fontWeight: 900, color: C.ink }}>
      <div style={{ display: 'flex', background: C.heat, color: C.bg, borderRadius: 10 * k, padding: `0 ${12 * k}px` }}>p.</div>
      projectmate
    </div>
  );
  const info = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 * k }}>
      <div style={{ display: 'flex', fontSize: 76 * k, fontWeight: 900, color: C.ink }}>{profile.displayName}</div>
      <div
        style={{ display: 'flex', alignSelf: 'flex-start', fontSize: 38 * k, fontWeight: 900, color: C.heatText, background: C.soft, border: `2px solid #5a3420`, borderRadius: 99, padding: `${10 * k}px ${26 * k}px` }}
      >
        {scoreLine}
      </div>
      <div style={{ display: 'flex', fontSize: 34 * k, color: C.muted }}>{stats}</div>
    </div>
  );
  if (story)
    return (
      <div style={{ display: 'flex', flexDirection: 'column', width: 1080, height: 1920, padding: 80, background: `radial-gradient(circle at 50% 0%, #3a1608 0%, ${C.bg} 60%)`, fontFamily: 'Pretendard' }}>
        {brand}
        <div style={{ display: 'flex', marginTop: 120, fontSize: 34, letterSpacing: 8, color: C.heatText, fontWeight: 900 }}>PROFILE GRADE</div>
        <div style={{ display: 'flex', fontSize: 560, lineHeight: 1, fontWeight: 900, color: C.heat, marginLeft: -20 }}>{grade}</div>
        {info}
        <div style={{ display: 'flex', flexGrow: 1 }} />
        {badgeRow}
        <div style={{ display: 'flex', margin: '48px -80px 36px' }}>
          <Checker width={1080} cell={30} />
        </div>
        <div style={{ display: 'flex', fontSize: 30, color: C.muted }}>{url}</div>
      </div>
    );
  return (
    <div style={{ display: 'flex', width: 1200, height: 630, background: C.bg, fontFamily: 'Pretendard' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: 420, background: `radial-gradient(circle at 50% 20%, #3a1608 0%, ${C.bg} 70%)`, borderRight: `2px solid ${C.line}` }}>
        <div style={{ display: 'flex', fontSize: 300, lineHeight: 1, fontWeight: 900, color: C.heat }}>{grade}</div>
        <div style={{ display: 'flex', fontSize: 22, letterSpacing: 6, color: C.muted, marginTop: 12 }}>PROFILE GRADE</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, padding: '48px 52px 0' }}>
        {brand}
        <div style={{ display: 'flex', marginTop: 34 }}>{info}</div>
        <div style={{ display: 'flex', marginTop: 26 }}>{badgeRow}</div>
        <div style={{ display: 'flex', flexGrow: 1 }} />
        <div style={{ display: 'flex', fontSize: 22, color: C.muted, marginBottom: 18 }}>{url}</div>
        <div style={{ display: 'flex', margin: '0 -52px' }}>
          <Checker width={780} cell={18} />
        </div>
      </div>
    </div>
  );
}
