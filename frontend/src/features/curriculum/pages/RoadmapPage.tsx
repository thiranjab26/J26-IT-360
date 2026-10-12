import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { Badge, Card, cx } from '@/shared/components/ui';
import {
  useGraph,
  useMastery,
  useTestStatus,
  type ConceptMastery,
  type Graph,
  type GraphNode,
} from '../api/curriculumApi';
import {
  ErrorCard,
  LEVEL_LABEL,
  LEVEL_TONE,
  MasteryBar,
  ModuleHeader,
  PageSkeleton,
} from '../components/common';
import { masteryLevel, moduleName, percent, type MasteryLevel } from '../lib/modules';

const NODE_W = 168;
const NODE_H = 50;
const GAP_X = 20;
const ROW_H = 92;
const PAD = 12;

/** Prerequisite graph drawn top to bottom by depth, coloured by mastery. */
export function RoadmapPage() {
  const { moduleId = '' } = useParams<{ moduleId: string }>();
  const status = useTestStatus(moduleId);
  const graph = useGraph(moduleId);
  const mastery = useMastery(moduleId);

  const error = graph.error ?? mastery.error;
  if (error) return <ErrorCard error={error} what="the roadmap" />;
  if (!graph.data || !mastery.data) return <PageSkeleton />;

  return (
    <div className="flex flex-col gap-[20px]">
      <ModuleHeader moduleId={moduleId} phase={status.data?.phase} />
      <Roadmap
        moduleId={moduleId}
        graph={graph.data}
        concepts={mastery.data.concepts}
        threshold={mastery.data.threshold}
        practise={status.data?.phase === 'learning'}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ Layout */

interface Placed {
  node: GraphNode;
  x: number;
  y: number;
}

/** Rows by depth; within a row, order by the mean x of each node's prerequisites. */
function layout(graph: Graph) {
  const prereqs = new Map<string, string[]>();
  for (const e of graph.edges) {
    prereqs.set(e.concept_id, [...(prereqs.get(e.concept_id) ?? []), e.prerequisite_id]);
  }

  const rows: GraphNode[][] = [];
  for (const node of graph.nodes) (rows[node.depth] ??= []).push(node);
  const widest = Math.max(1, ...rows.map((r) => r?.length ?? 0));
  const width = widest * (NODE_W + GAP_X) - GAP_X + PAD * 2;

  const placed = new Map<string, Placed>();
  rows.forEach((row = [], depth) => {
    const centre = (n: GraphNode) => {
      const xs = (prereqs.get(n.concept_id) ?? [])
        .map((id) => placed.get(id)?.x)
        .filter((x): x is number => x !== undefined);
      return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : Number.POSITIVE_INFINITY;
    };
    const ordered = [...row].sort((a, b) => {
      const diff = centre(a) - centre(b);
      return Number.isFinite(diff) && diff !== 0 ? diff : a.position - b.position;
    });
    const rowWidth = ordered.length * (NODE_W + GAP_X) - GAP_X;
    const left = (width - rowWidth) / 2;
    ordered.forEach((node, index) => {
      placed.set(node.concept_id, {
        node,
        x: left + index * (NODE_W + GAP_X),
        y: PAD + depth * ROW_H,
      });
    });
  });

  return { placed, prereqs, width, height: PAD * 2 + (rows.length - 1) * ROW_H + NODE_H };
}

/* ----------------------------------------------------------------- Roadmap */

const NODE_STYLE: Record<MasteryLevel, string> = {
  mastered: 'border-verified-line bg-verified-wash',
  learning: 'border-caution-line bg-caution-wash',
  none: 'border-line bg-surface',
};

function Roadmap({
  moduleId,
  graph,
  concepts,
  threshold,
  practise,
}: {
  moduleId: string;
  graph: Graph;
  concepts: ConceptMastery[];
  threshold: number;
  practise: boolean;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const { placed, prereqs, width, height } = useMemo(() => layout(graph), [graph]);
  const byId = useMemo(() => new Map(concepts.map((c) => [c.concept_id, c])), [concepts]);

  const mastered = (id: string) => byId.get(id)?.is_mastered ?? false;
  // Ready: not yet mastered and every prerequisite is mastered (the rules-v1 constraint).
  const ready = (id: string) =>
    !mastered(id) && (prereqs.get(id) ?? []).every((p) => mastered(p));

  const related = useMemo(() => {
    if (!selected) return null;
    const ids = new Set([selected]);
    for (const e of graph.edges) {
      if (e.concept_id === selected) ids.add(e.prerequisite_id);
      if (e.prerequisite_id === selected) ids.add(e.concept_id);
    }
    return ids;
  }, [graph.edges, selected]);

  return (
    <div className="flex flex-col gap-[14px]">
      <Legend />

      <Card className="overflow-x-auto p-[8px]">
        <div className="relative mx-auto" style={{ width, height }}>
          <svg
            width={width}
            height={height}
            className="absolute inset-0"
            aria-hidden="true"
            fill="none"
          >
            {graph.edges.map((e) => {
              const from = placed.get(e.prerequisite_id);
              const to = placed.get(e.concept_id);
              if (!from || !to) return null;
              const x1 = from.x + NODE_W / 2;
              const y1 = from.y + NODE_H;
              const x2 = to.x + NODE_W / 2;
              const y2 = to.y;
              const bend = Math.max(30, (y2 - y1) / 2);
              const lit = selected !== null && (e.concept_id === selected || e.prerequisite_id === selected);
              return (
                <path
                  key={`${e.prerequisite_id}->${e.concept_id}`}
                  d={`M${x1},${y1} C${x1},${y1 + bend} ${x2},${y2 - bend} ${x2},${y2}`}
                  strokeWidth={lit ? 1.8 : 1.1}
                  strokeDasharray={e.cross_module ? '4 3' : undefined}
                  className={cx(
                    lit ? 'stroke-brand' : 'stroke-line-strong',
                    related && !lit && 'opacity-30',
                  )}
                />
              );
            })}
          </svg>

          {[...placed.values()].map(({ node, x, y }) => {
            const level = masteryLevel(byId.get(node.concept_id));
            const outside = node.module_id !== moduleId;
            const isReady = ready(node.concept_id);
            return (
              <button
                key={node.concept_id}
                type="button"
                onClick={() => setSelected(selected === node.concept_id ? null : node.concept_id)}
                aria-pressed={selected === node.concept_id}
                title={node.name}
                className={cx(
                  'absolute flex flex-col justify-center rounded-[8px] border px-[10px] text-left transition-opacity',
                  NODE_STYLE[level],
                  outside && 'border-dashed',
                  isReady && level !== 'mastered' && 'ring-2 ring-brand-soft',
                  selected === node.concept_id && 'ring-2 ring-brand',
                  related && !related.has(node.concept_id) && 'opacity-35',
                )}
                style={{ left: x, top: y, width: NODE_W, height: NODE_H }}
              >
                <span className="line-clamp-2 text-[11.5px] leading-[1.3] text-ink">
                  {node.name}
                </span>
                <span className="font-mono text-[9.5px] text-ink-faint">
                  {outside ? moduleName(node.module_id).split(' ')[0] : node.topic_name}
                </span>
              </button>
            );
          })}
        </div>
      </Card>

      {selected && placed.get(selected) ? (
        <Detail
          node={placed.get(selected)!.node}
          prerequisites={(prereqs.get(selected) ?? []).flatMap((id) => {
            const p = placed.get(id);
            return p ? [p.node] : [];
          })}
          byId={byId}
          threshold={threshold}
          ready={ready(selected)}
          practiseHref={
            practise && ready(selected) ? `/curriculum/${moduleId}/practice/${selected}` : null
          }
        />
      ) : (
        <p className="text-[12px] text-ink-faint">
          Select a concept to see what it needs. {graph.stats.concepts} concepts,{' '}
          {graph.stats.edges} links, graph {graph.graph_version}.
        </p>
      )}
    </div>
  );
}

function Legend() {
  const items: Array<[string, string]> = [
    ['border-verified-line bg-verified-wash', 'Mastered'],
    ['border-caution-line bg-caution-wash', 'In progress'],
    ['border-line bg-surface', 'Not started'],
    ['border-line bg-surface ring-2 ring-brand-soft', 'Ready to learn'],
    ['border-dashed border-line-strong bg-surface', 'From another module'],
  ];
  return (
    <div className="flex flex-wrap gap-x-[16px] gap-y-[6px]">
      {items.map(([style, label]) => (
        <span key={label} className="flex items-center gap-[6px] text-[11.5px] text-ink-muted">
          <span aria-hidden="true" className={cx('size-[12px] rounded-[3px] border', style)} />
          {label}
        </span>
      ))}
    </div>
  );
}

function Detail({
  node,
  prerequisites,
  byId,
  threshold,
  ready,
  practiseHref,
}: {
  node: GraphNode;
  prerequisites: GraphNode[];
  byId: Map<string, ConceptMastery>;
  threshold: number;
  ready: boolean;
  practiseHref: string | null;
}) {
  const own = byId.get(node.concept_id);
  const level = masteryLevel(own);

  return (
    <Card className="px-[18px] py-[16px]">
      <div className="flex flex-wrap items-start justify-between gap-[10px]">
        <div>
          <p className="font-mono text-[10.5px] text-ink-faint">{node.topic_name}</p>
          <h2 className="mt-[2px] text-[15px] font-semibold text-ink">{node.name}</h2>
        </div>
        <div className="flex flex-wrap items-center gap-[6px]">
          {ready && level !== 'mastered' && <Badge tone="brand">Ready to learn</Badge>}
          <Badge tone={LEVEL_TONE[level]}>{LEVEL_LABEL[level]}</Badge>
          {practiseHref && (
            <Link
              to={practiseHref}
              className="rounded-[8px] bg-brand px-[12px] py-[6px] text-[12.5px] font-medium text-white hover:bg-brand-hover"
            >
              Practise
            </Link>
          )}
        </div>
      </div>

      <div className="mt-[12px] max-w-[360px]">
        <MasteryBar score={own?.mastery_score ?? null} level={level} threshold={threshold} />
        <p className="mt-[5px] font-mono text-[10.5px] text-ink-faint">
          {own?.mastery_score == null ? 'No answers yet' : `Mastery ${percent(own.mastery_score)}`}
        </p>
      </div>

      <div className="mt-[14px] border-t border-line-soft pt-[12px]">
        <p className="text-[12px] font-medium text-ink-soft">
          {prerequisites.length ? 'Learn these first' : 'No prerequisites. A starting point.'}
        </p>
        <ul className="mt-[8px] flex flex-col gap-[6px]">
          {prerequisites.map((p) => {
            const m = byId.get(p.concept_id);
            const pl = masteryLevel(m);
            return (
              <li key={p.concept_id} className="flex items-center justify-between gap-[10px]">
                <span className="text-[12.5px] text-ink">{p.name}</span>
                <Badge tone={LEVEL_TONE[pl]}>
                  {m?.mastery_score == null ? LEVEL_LABEL[pl] : percent(m.mastery_score)}
                </Badge>
              </li>
            );
          })}
        </ul>
      </div>
    </Card>
  );
}
