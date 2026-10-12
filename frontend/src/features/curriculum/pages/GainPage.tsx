import { useParams } from 'react-router-dom';

import { ApiError } from '@/shared/api/client';
import { Card } from '@/shared/components/ui';
import { useGain, useGraph, useTestStatus, type GainLine } from '../api/curriculumApi';
import { ErrorCard, ModuleHeader, PageSkeleton } from '../components/common';

/** Learning gain g = (post - pre) / (100 - pre), from the raw test scores. */
export function GainPage() {
  const { moduleId = '' } = useParams<{ moduleId: string }>();
  const status = useTestStatus(moduleId);
  const graph = useGraph(moduleId);
  const ready = Boolean(status.data?.posttest?.submitted_at);
  const gain = useGain(moduleId, ready);

  const header = <ModuleHeader moduleId={moduleId} phase={status.data?.phase} />;
  if (status.error) return <ErrorCard error={status.error} what="your results" />;
  if (!status.data || !graph.data) return <PageSkeleton />;

  if (!ready || (gain.error instanceof ApiError && gain.error.code === 'no_gain_yet')) {
    return (
      <div className="flex flex-col gap-[20px]">
        {header}
        <Card className="px-[20px] py-[18px]">
          <p className="text-[13px] text-ink-muted">
            Your learning gain appears here after you finish both the pre-test and the post-test.
          </p>
        </Card>
      </div>
    );
  }
  if (gain.error) return <ErrorCard error={gain.error} what="your gain" />;
  if (!gain.data) return <PageSkeleton />;

  const nodes = new Map(graph.data.nodes.map((n) => [n.concept_id, n]));
  const topicNames = new Map(graph.data.nodes.map((n) => [n.topic_id, n.topic_name]));
  const order = (id: string) => nodes.get(id)?.position ?? 0;
  const topicOrder = (topicId: string) =>
    Math.min(...graph.data.nodes.filter((n) => n.topic_id === topicId).map((n) => n.position));

  const { overall } = gain.data;

  return (
    <div className="flex flex-col gap-[20px]">
      {header}

      <div className="grid grid-cols-3 gap-[10px]">
        <Big label="Pre-test" value={`${Math.round(overall.pre_pct)}%`} />
        <Big label="Post-test" value={`${Math.round(overall.post_pct)}%`} />
        <Big label="Learning gain" value={gainText(overall.gain)} strong />
      </div>
      <p className="text-[12px] leading-[1.6] text-ink-muted">
        Learning gain is the share of what you did not know at the start that you learned:
        (post - pre) / (100 - pre). 0 means no change, 1 means you learned everything you missed.
      </p>

      <GainTable
        title="By topic"
        rows={Object.entries(gain.data.by_topic)
          .sort(([a], [b]) => topicOrder(a) - topicOrder(b))
          .map(([id, line]) => ({ id, name: topicNames.get(id) ?? id, line }))}
      />
      <GainTable
        title="By concept"
        rows={Object.entries(gain.data.by_concept)
          .sort(([a], [b]) => order(a) - order(b))
          .map(([id, line]) => ({ id, name: nodes.get(id)?.name ?? id, line }))}
      />
    </div>
  );
}

function gainText(gain: number | null): string {
  return gain === null ? '-' : gain.toFixed(2);
}

function Big({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <Card className="px-[14px] py-[12px]">
      <p className="text-[11.5px] text-ink-muted">{label}</p>
      <p
        className={`mt-[2px] text-[22px] font-semibold tracking-tight ${strong ? 'text-brand' : 'text-ink'}`}
      >
        {value}
      </p>
    </Card>
  );
}

function GainTable({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ id: string; name: string; line: GainLine }>;
}) {
  if (rows.length === 0) return null;
  return (
    <section>
      <h2 className="mb-[8px] text-[13.5px] font-semibold text-ink">{title}</h2>
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[420px] text-left text-[12.5px]">
          <thead>
            <tr className="border-b border-line text-[11px] text-ink-muted">
              <th className="px-[14px] py-[8px] font-medium">Name</th>
              <th className="px-[10px] py-[8px] text-right font-medium">Pre</th>
              <th className="px-[10px] py-[8px] text-right font-medium">Post</th>
              <th className="px-[14px] py-[8px] text-right font-medium">Gain</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-soft">
            {rows.map(({ id, name, line }) => (
              <tr key={id}>
                <td className="px-[14px] py-[8px] text-ink">{name}</td>
                <td className="px-[10px] py-[8px] text-right font-mono text-ink-soft">
                  {Math.round(line.pre_pct)}%
                </td>
                <td className="px-[10px] py-[8px] text-right font-mono text-ink-soft">
                  {Math.round(line.post_pct)}%
                </td>
                <td className="px-[14px] py-[8px] text-right font-mono text-ink">
                  {gainText(line.gain)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </section>
  );
}
