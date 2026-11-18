'use client';
import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { apiFetch } from '@/lib/supabase-browser';
import { buildKnowledgeGraph } from '@/lib/career/knowledge-graph';
import type { Profile } from '@/lib/career/profile';
import type { Experience } from '@/lib/career/store';
import type { readHub } from '@/lib/hub';
import type { Wire } from '@/lib/wire';
const Graph = dynamic(
  () => import('./career-knowledge-graph').then((m) => m.CareerKnowledgeGraph),
  { ssr: false, loading: () => <output>경험 지도를 그리는 중입니다…</output> },
);
type Hub = Wire<Awaited<ReturnType<typeof readHub>>>;
export function CareerMap() {
  const [data, setData] = useState<{
    profile: Profile | null;
    experiences: Wire<Experience>[];
    hub: Hub;
  } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    async function get(url: string) {
      const response = await apiFetch(url, {
        signal: controller.signal,
        cache: 'no-store',
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error || '불러오기에 실패했습니다.');
      return body;
    }
    Promise.all([get('/api/career'), get('/api/hub')])
      .then(([career, hub]) => setData({ ...career, hub }))
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, []);
  const graph = useMemo(
    () =>
      buildKnowledgeGraph(
        data?.profile ?? null,
        data?.experiences ?? [],
        data?.hub.records ?? [],
      ),
    [data],
  );
  if (error)
    return (
      <p role="alert" className="studio-error">
        {error}
      </p>
    );
  if (!data) return <output>나의 경험을 불러오는 중입니다…</output>;
  return (
    <div className="career-map-page">
      <Graph graph={graph} />
      <section className="studio-activity">
        <div>
          <small>내 활동 기록</small>
          <h3>레벨 {data.hub.stats.level}</h3>
          <p>{data.hub.stats.points}점</p>
        </div>
        <div>
          <strong>{data.hub.stats.days}일</strong>
          <span>학습 기록</span>
        </div>
        <div>
          <strong>{data.experiences.filter((e) => e.valid).length}개</strong>
          <span>유효한 경험 기록</span>
        </div>
        <p className="cf-help">
          현재 점수는 학습일당 10점, 유효한 경험 기록당 30점입니다. 채용
          경쟁력이나 전체 사용자 순위를 뜻하지 않습니다.
        </p>
      </section>
    </div>
  );
}
