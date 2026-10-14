import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';

import { useAuth } from '@/shared/auth/AuthProvider';
import { Badge, Banner, Button, Card, cx } from '@/shared/components/ui';
import {
  useGraph,
  useGraphAudit,
  useGraphEdit,
  useWindow,
  type Graph,
  type GraphAuditEntry,
  type GraphNode,
} from '../api/curriculumApi';
import { ErrorCard, ModuleHeader, PageSkeleton, isStaff } from '../components/common';
import { prerequisiteMap, redundantVia, wouldLoop } from '../lib/graphEdit';
import { moduleIds, moduleName } from '../lib/modules';
import { errorMessage } from './QuestionsPage';

const LABEL = 'text-[12px] font-medium text-ink-soft';
const INPUT =
  'rounded-[8px] border border-line bg-surface px-[10px] py-[8px] text-[13px] text-ink focus:border-brand focus:outline-none';

/**
 * Lecturer edits to the prerequisite links of this module. The full graph is loaded so a
 * concept can need one from another module. The server rejects loops and logs every edit.
 */
export function GraphEditPage() {
  const { moduleId = '' } = useParams<{ moduleId: string }>();
  const { user } = useAuth();
  const graph = useGraph();
  const win = useWindow(moduleId);

  if (!isStaff(user?.role)) {
    return (
      <div className="flex flex-col gap-[20px]">
        <ModuleHeader moduleId={moduleId} />
        <Card className="px-[20px] py-[18px]">
          <p className="text-[13px] text-ink-muted">This page is for lecturers.</p>
        </Card>
      </div>
    );
  }
  if (graph.error) return <ErrorCard error={graph.error} what="the prerequisite graph" />;
  if (!graph.data) return <PageSkeleton />;

  const phase = win.data?.phase;
  const studyRunning = phase === 'learning' || phase === 'posttest';

  return (
    <div className="flex flex-col gap-[24px]">
      <ModuleHeader moduleId={moduleId} phase={phase} />

      <Card className="px-[18px] py-[14px]">
        <p className="max-w-[640px] text-[12.5px] leading-[1.6] text-ink-muted">
          A link means a learner must master the prerequisite (70%) before the concept is
          recommended. Every change needs a reason, gets a new graph version and is kept in the
          history below. Concepts themselves come from the shared concept list and cannot be added
          here.
        </p>
        <p className="mt-[8px] font-mono text-[10.5px] text-ink-faint">
          graph {graph.data.graph_version} · {graph.data.stats.concepts} concepts ·{' '}
          {graph.data.stats.edges} links · from {graph.data.source}
        </p>
      </Card>

      {studyRunning && (
        <p
          role="note"
          className="rounded-[8px] border border-caution-line bg-caution-wash px-[12px] py-[9px] text-[12.5px] text-caution-ink"
        >
          The study is running in this module. A change applies to every learner's next
          recommendation straight away; note it in your study record.
        </p>
      )}

      <AddLink moduleId={moduleId} graph={graph.data} />
      <Links moduleId={moduleId} graph={graph.data} />
      <History graph={graph.data} />
    </div>
  );
}

/* ---------------------------------------------------------------- Add link */

function AddLink({ moduleId, graph }: { moduleId: string; graph: Graph }) {
  const [conceptId, setConceptId] = useState('');
  const [prerequisiteId, setPrerequisiteId] = useState('');
  const [reason, setReason] = useState('');
  const edit = useGraphEdit();

  const prereqs = useMemo(() => prerequisiteMap(graph.edges), [graph.edges]);
  const own = moduleNodes(graph, moduleId);
  const existing = new Set(prereqs.get(conceptId) ?? []);

  // A choice is disabled when the server would refuse it anyway.
  const blocked = (id: string): string | null => {
    if (!conceptId) return null;
    if (id === conceptId) return 'same concept';
    if (existing.has(id)) return 'already linked';
    if (wouldLoop(prereqs, conceptId, id)) return 'would make a loop';
    return null;
  };

  const ready = conceptId && prerequisiteId && reason.trim().length >= 3;

  function submit() {
    edit.mutate(
      {
        action: 'add_edge',
        concept_id: conceptId,
        prerequisite_id: prerequisiteId,
        reason: reason.trim(),
      },
      {
        onSuccess: () => {
          setPrerequisiteId('');
          setReason('');
        },
      },
    );
  }

  return (
    <section>
      <SectionTitle title="Add a link" note="The prerequisite can be from any module." />
      <Card className="flex flex-col gap-[12px] px-[18px] py-[16px]">
        <div className="grid gap-[10px] sm:grid-cols-2">
          <label className="flex flex-col gap-[5px]">
            <span className={LABEL}>Concept</span>
            <select
              className={INPUT}
              value={conceptId}
              onChange={(e) => {
                setConceptId(e.target.value);
                setPrerequisiteId('');
                edit.reset();
              }}
            >
              <option value="">Choose a concept</option>
              {own.map((n) => (
                <option key={n.concept_id} value={n.concept_id}>
                  {n.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-[5px]">
            <span className={LABEL}>Needs first (prerequisite)</span>
            <select
              className={INPUT}
              value={prerequisiteId}
              disabled={!conceptId}
              onChange={(e) => {
                setPrerequisiteId(e.target.value);
                edit.reset();
              }}
            >
              <option value="">Choose a prerequisite</option>
              {moduleIds(graph.nodes).map((m) => (
                <optgroup key={m} label={moduleName(m)}>
                  {moduleNodes(graph, m).map((n) => {
                    const why = blocked(n.concept_id);
                    return (
                      <option key={n.concept_id} value={n.concept_id} disabled={why !== null}>
                        {why ? `${n.name} (${why})` : n.name}
                      </option>
                    );
                  })}
                </optgroup>
              ))}
            </select>
          </label>
        </div>
        <label className="flex flex-col gap-[5px]">
          <span className={LABEL}>Reason (kept in the history)</span>
          <input
            className={INPUT}
            value={reason}
            maxLength={500}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Lecturer review: recursion is taught before linked lists"
          />
        </label>
        <div className="flex flex-wrap items-center justify-between gap-[10px]">
          <EditOutcome edit={edit} />
          <Button disabled={!ready} busy={edit.isPending} onClick={submit}>
            Add link
          </Button>
        </div>
      </Card>
    </section>
  );
}

/* ------------------------------------------------------------ Current links */

interface Pending {
  conceptId: string;
  prerequisiteId: string;
}

function Links({ moduleId, graph }: { moduleId: string; graph: Graph }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [reason, setReason] = useState('');
  const edit = useGraphEdit();

  const prereqs = useMemo(() => prerequisiteMap(graph.edges), [graph.edges]);
  const byId = useMemo(() => new Map(graph.nodes.map((n) => [n.concept_id, n])), [graph.nodes]);
  const name = (id: string) => byId.get(id)?.name ?? id;

  function choose(next: Pending) {
    const same =
      pending?.conceptId === next.conceptId && pending.prerequisiteId === next.prerequisiteId;
    setPending(same ? null : next);
    setReason('');
    edit.reset();
  }

  function remove() {
    if (!pending) return;
    edit.mutate(
      {
        action: 'remove_edge',
        concept_id: pending.conceptId,
        prerequisite_id: pending.prerequisiteId,
        reason: reason.trim(),
      },
      { onSuccess: () => setPending(null) },
    );
  }

  return (
    <section>
      <SectionTitle
        title="Current links"
        note="Select a prerequisite to remove that link. Redundant links are already implied by another path."
      />
      <Card className="divide-y divide-line-soft overflow-hidden">
        {moduleNodes(graph, moduleId).map((node) => {
          const needs = prereqs.get(node.concept_id) ?? [];
          return (
            <div key={node.concept_id} className="px-[16px] py-[12px]">
              <div className="flex flex-wrap items-baseline justify-between gap-[8px]">
                <p className="text-[13px] font-medium text-ink">{node.name}</p>
                <p className="font-mono text-[10.5px] text-ink-faint">{node.topic_name}</p>
              </div>
              {needs.length === 0 ? (
                <p className="mt-[4px] text-[12px] text-ink-faint">No prerequisites.</p>
              ) : (
                <ul className="mt-[8px] flex flex-wrap gap-[6px]">
                  {needs.map((p) => {
                    const via = redundantVia(prereqs, node.concept_id, p);
                    const outside = byId.get(p)?.module_id !== moduleId;
                    const selected =
                      pending?.conceptId === node.concept_id && pending.prerequisiteId === p;
                    return (
                      <li key={p}>
                        <button
                          type="button"
                          onClick={() => choose({ conceptId: node.concept_id, prerequisiteId: p })}
                          aria-pressed={selected}
                          title={via ? `Also needed through ${name(via)}` : undefined}
                          className={cx(
                            'flex items-center gap-[6px] rounded-[8px] border px-[10px] py-[5px] text-[12px] transition-colors',
                            outside && 'border-dashed',
                            selected
                              ? 'border-caution-line bg-caution-wash text-caution-ink'
                              : 'border-line text-ink-soft hover:border-line-strong hover:text-ink',
                          )}
                        >
                          {name(p)}
                          {outside && (
                            <span className="font-mono text-[9.5px] text-ink-faint">
                              {byId.get(p)?.module_id}
                            </span>
                          )}
                          {via && <Badge tone="caution">redundant</Badge>}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              {pending?.conceptId === node.concept_id && (
                <div className="mt-[12px] flex flex-col gap-[10px] border-t border-line-soft pt-[12px]">
                  <p className="text-[12.5px] text-caution-ink">
                    Remove the link: {node.name} needs {name(pending.prerequisiteId)} first?
                  </p>
                  <input
                    className={INPUT}
                    value={reason}
                    maxLength={500}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Reason (kept in the history)"
                    aria-label="Reason for removing the link"
                  />
                  <div className="flex flex-wrap items-center justify-between gap-[10px]">
                    <EditOutcome edit={edit} />
                    <div className="flex gap-[8px]">
                      <Button variant="secondary" onClick={() => setPending(null)}>
                        Cancel
                      </Button>
                      <Button
                        disabled={reason.trim().length < 3}
                        busy={edit.isPending}
                        onClick={remove}
                      >
                        Remove link
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </Card>
      {edit.isSuccess && !pending && (
        <p className="mt-[8px] text-[12px] text-verified-ink">
          Link removed. Graph is now {edit.data.graph_version}.
        </p>
      )}
    </section>
  );
}

/* ----------------------------------------------------------------- History */

function History({ graph }: { graph: Graph }) {
  const audit = useGraphAudit();
  const { user } = useAuth();
  const byId = useMemo(() => new Map(graph.nodes.map((n) => [n.concept_id, n])), [graph.nodes]);
  const name = (id: string | null) => (id ? (byId.get(id)?.name ?? id) : '-');

  return (
    <section>
      <SectionTitle title="History" note="Every graph change, newest first." />
      {audit.error ? (
        <ErrorCard error={audit.error} what="the graph history" />
      ) : !audit.data ? (
        <div className="h-[110px] animate-pulse rounded-[14px] bg-surface-sunken" />
      ) : audit.data.length === 0 ? (
        <Card className="px-[18px] py-[14px]">
          <p className="text-[12.5px] text-ink-muted">No changes yet. The graph is the original.</p>
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-[12.5px]">
            <thead>
              <tr className="border-b border-line text-[11px] text-ink-muted">
                <th className="px-[14px] py-[8px] font-medium">When</th>
                <th className="px-[10px] py-[8px] font-medium">Change</th>
                <th className="px-[10px] py-[8px] font-medium">Reason</th>
                <th className="px-[10px] py-[8px] font-medium">By</th>
                <th className="px-[14px] py-[8px] font-medium">Version</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {audit.data.map((entry, index) => (
                <tr key={`${entry.graph_version}-${index}`}>
                  <td className="whitespace-nowrap px-[14px] py-[8px] font-mono text-[11px] text-ink-faint">
                    {entry.changed_at ? new Date(entry.changed_at).toLocaleString() : '-'}
                  </td>
                  <td className="px-[10px] py-[8px] text-ink">
                    <ChangeLabel entry={entry} name={name} />
                  </td>
                  <td className="px-[10px] py-[8px] text-ink-soft">
                    {entry.details.reason ?? '-'}
                  </td>
                  <td className="px-[10px] py-[8px] font-mono text-[11px] text-ink-faint">
                    {entry.actor === user?.user_id ? 'you' : entry.actor.slice(0, 8)}
                  </td>
                  <td className="whitespace-nowrap px-[14px] py-[8px] font-mono text-[11px] text-ink-soft">
                    {entry.graph_version}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </section>
  );
}

function ChangeLabel({
  entry,
  name,
}: {
  entry: GraphAuditEntry;
  name: (id: string | null) => string;
}) {
  if (entry.action === 'add_edge' || entry.action === 'remove_edge') {
    const added = entry.action === 'add_edge';
    return (
      <span>
        <Badge tone={added ? 'verified' : 'caution'}>{added ? 'added' : 'removed'}</Badge>{' '}
        {name(entry.concept_id)} needs {name(entry.prerequisite_id)}
      </span>
    );
  }
  return <span>{entry.action}</span>;
}

/* ------------------------------------------------------------------ Bits */

function moduleNodes(graph: Graph, moduleId: string): GraphNode[] {
  return graph.nodes
    .filter((n) => n.module_id === moduleId)
    .sort((a, b) => a.position - b.position);
}

function EditOutcome({ edit }: { edit: ReturnType<typeof useGraphEdit> }) {
  if (edit.error) return <Banner message={errorMessage(edit.error)} />;
  if (edit.isSuccess && edit.data.action === 'add_edge') {
    return (
      <p className="text-[12px] text-verified-ink">
        Link added. Graph is now {edit.data.graph_version}.
      </p>
    );
  }
  return <span />;
}

function SectionTitle({ title, note }: { title: string; note: string }) {
  return (
    <div className="mb-[10px]">
      <h2 className="text-[14px] font-semibold text-ink">{title}</h2>
      <p className="mt-[2px] text-[12px] text-ink-muted">{note}</p>
    </div>
  );
}
