'use client';
import { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { Maximize2, Minus, Plus, Network } from 'lucide-react';
import type {
  KnowledgeGraph,
  KnowledgeNode,
} from '@/lib/career/knowledge-graph';

type Node = KnowledgeNode & d3.SimulationNodeDatum;
type Edge = d3.SimulationLinkDatum<Node> & { label: string };
const KINDS = {
  person: '나',
  project: '프로젝트와 경험',
  technology: '기술',
  competency: '역량',
};
const COLORS = {
  person: '#167563',
  project: '#4b71d5',
  technology: '#c27628',
  competency: '#9064bd',
};
const radius = (n: Node) => Math.min(35, 12 + Math.sqrt(n.degree) * 4.5);

export function CareerKnowledgeGraph({ graph }: { graph: KnowledgeGraph }) {
  const container = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const controls = useRef<(action: 'in' | 'out' | 'reset') => void>(() => {});
  const [width, setWidth] = useState(700);
  const [selectedId, setSelectedId] = useState('me');
  const selected =
    graph.nodes.find((n) => n.id === selectedId) ?? graph.nodes[0];
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.max(280, entry.contentRect.width)),
    );
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!svg.current || !graph.nodes.length) return;
    const root = d3.select(svg.current);
    root.selectAll('*').remove();
    const height = 500;
    const nodes: Node[] = graph.nodes.map((n) => ({ ...n }));
    const edges: Edge[] = graph.links.map((l) => ({ ...l }));
    const layer = root.append('g');
    const lines = layer
      .append('g')
      .selectAll('line')
      .data(edges)
      .join('line')
      .attr('stroke', 'var(--kg-edge)')
      .attr('stroke-width', 1.4);
    const groups = layer
      .append('g')
      .selectAll<SVGGElement, Node>('g')
      .data(nodes)
      .join('g')
      .attr('class', 'kg-node')
      .attr('role', 'button')
      .attr('tabindex', 0)
      .attr(
        'aria-label',
        (n) =>
          `${n.label}, ${KINDS[n.kind]}, 연결 ${n.degree}개. Enter로 상세 보기, 방향키로 이동`,
      );
    groups
      .append('circle')
      .attr('r', radius)
      .attr('fill', (n) => COLORS[n.kind])
      .attr('stroke', 'var(--kg-surface)')
      .attr('stroke-width', 3);
    groups
      .append('text')
      .text((n) => (n.label.length > 23 ? n.label.slice(0, 22) + '…' : n.label))
      .attr('text-anchor', 'middle')
      .attr('y', (n) => radius(n) + 17)
      .attr('fill', 'var(--kg-text)')
      .attr('font-size', (n) => (n.kind === 'person' ? 14 : 11))
      .attr('font-weight', 600)
      .attr('paint-order', 'stroke')
      .attr('stroke', 'var(--kg-surface)')
      .attr('stroke-width', 4);
    groups.append('title').text((n) => `${n.label}\n${n.description}`);
    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 3])
      .on('zoom', (event) =>
        layer.attr('transform', event.transform.toString()),
      );
    root.call(zoom).on('dblclick.zoom', null);
    const simulation = d3
      .forceSimulation(nodes)
      .force(
        'link',
        d3
          .forceLink<Node, Edge>(edges)
          .id((n) => n.id)
          .distance(112)
          .strength(0.28),
      )
      .force('charge', d3.forceManyBody<Node>().strength(-320))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('x', d3.forceX<Node>(width / 2).strength(0.05))
      .force('y', d3.forceY<Node>(height / 2).strength(0.09))
      .force(
        'collision',
        d3.forceCollide<Node>((n) => radius(n) + 25),
      );
    const id = (v: Edge['source']) =>
      typeof v === 'object' ? v.id : String(v);
    function highlight(node: Node | null) {
      const neighbors = new Set(node ? [node.id] : []);
      if (node)
        for (const e of edges) {
          if (id(e.source) === node.id) neighbors.add(id(e.target));
          if (id(e.target) === node.id) neighbors.add(id(e.source));
        }
      groups.attr('opacity', (n) => (!node || neighbors.has(n.id) ? 1 : 0.13));
      lines.attr('opacity', (e) =>
        !node || id(e.source) === node.id || id(e.target) === node.id
          ? 0.8
          : 0.06,
      );
    }
    function tick() {
      lines
        .attr('x1', (e) => (e.source as Node).x!)
        .attr('y1', (e) => (e.source as Node).y!)
        .attr('x2', (e) => (e.target as Node).x!)
        .attr('y2', (e) => (e.target as Node).y!);
      groups.attr('transform', (n) => `translate(${n.x},${n.y})`);
    }
    simulation.on('tick', tick);
    groups
      .on('mouseenter', (_, n) => highlight(n))
      .on('mouseleave', () => highlight(null))
      .on('focus', (_, n) => highlight(n))
      .on('blur', () => highlight(null))
      .on('click', (_, n) => setSelectedId(n.id))
      .on('keydown', (event: KeyboardEvent, n) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          setSelectedId(n.id);
        }
        const delta: Record<string, [number, number]> = {
          ArrowLeft: [-15, 0],
          ArrowRight: [15, 0],
          ArrowUp: [0, -15],
          ArrowDown: [0, 15],
        };
        if (delta[event.key]) {
          event.preventDefault();
          n.fx = n.x = (n.x ?? 0) + delta[event.key][0];
          n.fy = n.y = (n.y ?? 0) + delta[event.key][1];
          tick();
        }
      })
      .call(
        d3
          .drag<SVGGElement, Node>()
          .on('start', (event, n) => {
            if (!event.active) simulation.alphaTarget(0.12).restart();
            n.fx = n.x;
            n.fy = n.y;
          })
          .on('drag', (event, n) => {
            n.fx = event.x;
            n.fy = event.y;
          })
          .on('end', (event) => {
            if (!event.active) simulation.alphaTarget(0);
          }),
      );
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      simulation.stop();
      simulation.tick(180);
      tick();
    }
    controls.current = (action) => {
      if (action === 'reset') {
        nodes.forEach((n) => {
          n.fx = null;
          n.fy = null;
        });
        root.call((selection) => zoom.transform(selection, d3.zoomIdentity));
        simulation.alpha(0.5).restart();
      } else
        root.call((selection) =>
          zoom.scaleBy(selection, action === 'in' ? 1.3 : 1 / 1.3),
        );
    };
    return () => {
      simulation.stop();
      root.on('.zoom', null);
      root.selectAll('*').remove();
      controls.current = () => {};
    };
  }, [graph, width]);
  return (
    <section className="kg-card">
      <div className="studio-heading">
        <div>
          <p className="studio-kicker">MY KNOWLEDGE MAP</p>
          <h2>경험이 연결되는 지도</h2>
          <p>노드를 끌어 배치하고, 눌러서 연결된 경험을 읽어보세요.</p>
        </div>
        <Network size={28} />
      </div>
      <div className="kg-legend">
        {Object.entries(KINDS).map(([id, name]) => (
          <span key={id}>
            <i style={{ background: COLORS[id as keyof typeof COLORS] }} />
            {name}
          </span>
        ))}
      </div>
      {!graph.nodes.length ? (
        <p className="studio-empty">
          이력서 또는 포트폴리오를 저장하면 나의 경험 지도가 생깁니다.
        </p>
      ) : (
        <div className="kg-layout">
          <div className="kg-canvas" ref={container}>
            <div className="kg-controls">
              <button
                aria-label="그래프 확대"
                onClick={() => controls.current('in')}
              >
                <Plus size={17} />
              </button>
              <button
                aria-label="그래프 축소"
                onClick={() => controls.current('out')}
              >
                <Minus size={17} />
              </button>
              <button
                aria-label="그래프 배치 초기화"
                onClick={() => controls.current('reset')}
              >
                <Maximize2 size={17} />
              </button>
            </div>
            <svg
              ref={svg}
              viewBox={`0 0 ${width} 500`}
              aria-label="프로젝트, 기술, 역량 네트워크"
            />
            <span className="kg-caption">
              연결이 많을수록 큰 노드, 숙련도 점수가 아닙니다.
            </span>
          </div>
          {selected && (
            <aside className="kg-detail" aria-live="polite">
              <p className="studio-kicker">{KINDS[selected.kind]}</p>
              <h3>{selected.label}</h3>
              <p>{selected.description}</p>
              <small>연결 {selected.degree}개</small>
              {selected.evidence.map((q, i) => (
                <blockquote key={i}>{q}</blockquote>
              ))}
              <h4>연결된 항목</h4>
              <div className="studio-chips">
                {graph.links
                  .filter(
                    (l) => l.source === selected.id || l.target === selected.id,
                  )
                  .map((l) => {
                    const node = graph.nodes.find(
                      (n) =>
                        n.id ===
                        (l.source === selected.id ? l.target : l.source),
                    )!;
                    return (
                      <button
                        key={node.id}
                        title={l.label}
                        onClick={() => setSelectedId(node.id)}
                      >
                        {node.label}
                      </button>
                    );
                  })}
              </div>
            </aside>
          )}
        </div>
      )}
      {!!graph.nodes.length && (
        <details className="kg-list">
          <summary>지도를 목록으로 보기</summary>
          <div className="studio-chips">
            {graph.nodes.map((n) => (
              <button key={n.id} onClick={() => setSelectedId(n.id)}>
                {n.label}
              </button>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
