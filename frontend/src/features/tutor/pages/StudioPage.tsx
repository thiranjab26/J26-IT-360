import { useEffect, useMemo, useState } from "react";

import { ApiError } from "@/shared/api/client";
import { useAuth } from "@/shared/auth/AuthProvider";
import { Badge, Banner, Button, Card, cx } from "@/shared/components/ui";
import {
  useAuthorOverview,
  useGenerate,
  useJob,
  useReview,
  type AuthorItem,
  type BulkResult,
} from "../api/authorApi";
import { useModuleConcepts } from "../api/tutorApi";
import { Mascot } from "../components/Mascot";
import {
  CheckChips,
  Editor,
  OriginBadge,
  Preview,
} from "../components/StudioParts";

const MODULE = "prog";

type Tab = "drafts" | "live" | "history";

type EditorState =
  | { kind: "new"; replaces: string }
  | { kind: "edit"; item: AuthorItem }
  | { kind: "copy"; item: AuthorItem };

/**
 * Where a lecturer decides what students practise. Ask the model for drafts, or write one; each
 * draft arrives with its checks; approving one replaces the practical in that place for every
 * student, and the old one is kept in the history.
 */
export function StudioPage() {
  const { user } = useAuth();
  if (user?.role !== "lecturer") {
    return (
      <Card className="px-[20px] py-[18px]">
        <p className="text-[13px] text-ink">
          The practical studio is for lecturers.
        </p>
      </Card>
    );
  }
  return <Studio />;
}

function Studio() {
  const concepts = useModuleConcepts(MODULE);
  const flat = useMemo(
    () =>
      concepts.data?.topics.flatMap((t) =>
        t.concepts.map((c) => ({ ...c, topic: t.name })),
      ) ?? [],
    [concepts.data],
  );
  const [picked, setPicked] = useState("");
  const conceptId = picked || flat[0]?.concept_id || "";
  const conceptTitle =
    flat.find((c) => c.concept_id === conceptId)?.name ?? conceptId;

  const overview = useAuthorOverview(conceptId);
  const generate = useGenerate();
  const review = useReview();

  const [count, setCount] = useState(3);
  const [hint, setHint] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const job = useJob(jobId);
  const [tab, setTab] = useState<Tab>("drafts");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [results, setResults] = useState<BulkResult[]>([]);

  const data = overview.data;
  const running =
    job.data?.status === "queued" || job.data?.status === "running";

  // Switching concept drops whatever was ticked, so a bulk action never reaches across concepts.
  useEffect(() => {
    setSelected(new Set());
    setResults([]);
    setEditor(null);
  }, [conceptId]);

  const startGenerate = (replaces?: string[]) => {
    generate.mutate(
      {
        concept_id: conceptId,
        count: replaces ? replaces.length : count,
        hint: hint.trim() || null,
        replaces,
      },
      {
        onSuccess: (started) => {
          setJobId(started.job_id);
          setTab("drafts");
        },
      },
    );
  };

  const bulk = (kind: "approve" | "reject") => {
    const input = { practical_ids: [...selected], note: note.trim() || null };
    const action = kind === "approve" ? review.approveMany : review.rejectMany;
    action.mutate(input, {
      onSuccess: (done) => {
        setResults(done.results.filter((r) => !r.ok));
        setSelected(new Set());
      },
    });
  };

  const failure =
    generate.error ??
    review.approve.error ??
    review.reject.error ??
    review.restore.error;
  const toggle = (id: string) =>
    setSelected((now) => {
      const next = new Set(now);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const placeOf = (slot: string) =>
    data?.current.find((c) => c.slot_id === slot)?.title ?? "a new place";
  const approvable = data?.drafts.filter((d) => d.can_approve) ?? [];

  return (
    <div className="flex flex-col gap-[18px]">
      <header className="flex items-center gap-[14px]">
        <Mascot mood={running ? "think" : "idle"} size={60} />
        <div>
          <p className="font-mono text-[11px] tracking-wide text-brand uppercase">
            Lecturer
          </p>
          <h1 className="text-[24px] font-semibold tracking-tight text-ink">
            Practical studio
          </h1>
          <p className="mt-[3px] max-w-[640px] text-[12.5px] text-ink-muted">
            Ask for drafts or write your own. Each one is run and checked before
            you see it. Approving a draft replaces the practical in that place
            for every student. The old one is kept in the history and can be
            restored.
          </p>
        </div>
      </header>

      <Card className="px-[18px] py-[16px]">
        <div className="flex flex-wrap items-end gap-[12px]">
          <label className="text-[12px] font-medium text-ink-soft">
            Concept
            <select
              value={conceptId}
              onChange={(e) => setPicked(e.target.value)}
              className="mt-[4px] block min-w-[220px] rounded-[8px] border border-line bg-surface px-[10px] py-[7px] text-[13px] text-ink"
            >
              {concepts.data?.topics.map((topic) => (
                <optgroup key={topic.topic_id} label={topic.name}>
                  {topic.concepts.map((c) => (
                    <option key={c.concept_id} value={c.concept_id}>
                      {c.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label className="text-[12px] font-medium text-ink-soft">
            How many drafts
            <select
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
              className="mt-[4px] block rounded-[8px] border border-line bg-surface px-[10px] py-[7px] text-[13px] text-ink"
            >
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label className="min-w-[240px] flex-1 text-[12px] font-medium text-ink-soft">
            What do you want? (optional)
            <input
              value={hint}
              onChange={(e) => setHint(e.target.value)}
              maxLength={500}
              placeholder="for example: tracing loop variables, a counting problem"
              className="mt-[4px] block w-full rounded-[8px] border border-line bg-surface px-[10px] py-[7px] text-[13px] text-ink focus:outline-none"
            />
          </label>
          <Button
            onClick={() => startGenerate()}
            busy={generate.isPending}
            disabled={!conceptId || running}
          >
            Generate drafts
          </Button>
          <Button
            variant="secondary"
            disabled={!conceptId}
            onClick={() =>
              setEditor({
                kind: "new",
                replaces: data?.current[0]?.practical_id ?? "",
              })
            }
          >
            Write one myself
          </Button>
        </div>
        <p className="mt-[8px] text-[11.5px] text-ink-faint">
          Each draft takes about half a minute and uses a few model requests.
          They are made one at a time and appear below as they are ready.
        </p>
      </Card>

      {failure && (
        <Banner
          message={
            failure instanceof ApiError
              ? failure.message
              : "Something went wrong."
          }
          code={failure instanceof ApiError ? failure.code : undefined}
        />
      )}

      {job.data && <JobBar job={job.data} />}

      {editor && data && (
        <>
          {editor.kind === "new" && (
            <label className="text-[12px] font-medium text-ink-soft">
              This takes the place of
              <select
                value={editor.replaces}
                onChange={(e) =>
                  setEditor({ kind: "new", replaces: e.target.value })
                }
                className="ml-[8px] rounded-[8px] border border-line bg-surface px-[10px] py-[5px] text-[12.5px] text-ink"
              >
                {data.current.map((c) => (
                  <option key={c.practical_id} value={c.practical_id}>
                    {c.title}
                  </option>
                ))}
                <option value="">Nothing: add it as an extra practical</option>
              </select>
            </label>
          )}
          <Editor
            key={
              editor.kind === "new"
                ? "new"
                : editor.item.practical_id + editor.kind
            }
            conceptId={conceptId}
            conceptTitle={conceptTitle}
            replaces={
              editor.kind === "new"
                ? editor.replaces || null
                : editor.kind === "copy"
                  ? editor.item.practical_id
                  : null
            }
            draftId={
              editor.kind === "edit" ? editor.item.practical_id : undefined
            }
            initial={
              editor.kind === "new"
                ? undefined
                : {
                    statement: editor.item.statement,
                    solution: editor.item.reference_solution,
                    level: editor.item.level,
                  }
            }
            onDone={() => {
              setEditor(null);
              setTab("drafts");
            }}
          />
        </>
      )}

      <nav className="flex gap-[6px]" aria-label="Practicals">
        <TabButton active={tab === "drafts"} onClick={() => setTab("drafts")}>
          Drafts to review{data ? ` (${data.drafts.length})` : ""}
        </TabButton>
        <TabButton active={tab === "live"} onClick={() => setTab("live")}>
          Live now{data ? ` (${data.current.length})` : ""}
        </TabButton>
        <TabButton active={tab === "history"} onClick={() => setTab("history")}>
          History{data ? ` (${data.history.length})` : ""}
        </TabButton>
      </nav>

      {overview.isPending && (
        <p className="text-[13px] text-ink-muted">Loading...</p>
      )}

      {data && tab === "drafts" && (
        <section className="flex flex-col gap-[12px]">
          {data.drafts.length === 0 ? (
            <Card className="px-[18px] py-[16px]">
              <p className="text-[13px] text-ink-muted">
                No drafts waiting for this concept. Generate some above.
              </p>
            </Card>
          ) : (
            <>
              <Card className="flex flex-wrap items-center gap-[10px] px-[14px] py-[10px]">
                <Button
                  variant="secondary"
                  onClick={() =>
                    setSelected(new Set(approvable.map((d) => d.practical_id)))
                  }
                  disabled={approvable.length === 0}
                >
                  Select every draft that can be approved ({approvable.length})
                </Button>
                <Button
                  onClick={() => bulk("approve")}
                  disabled={selected.size === 0}
                  busy={review.approveMany.isPending}
                >
                  Approve selected ({selected.size})
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => bulk("reject")}
                  disabled={selected.size === 0}
                  busy={review.rejectMany.isPending}
                >
                  Reject selected
                </Button>
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={1000}
                  placeholder="Note for the record (optional)"
                  className="min-w-[200px] flex-1 rounded-[8px] border border-line bg-surface px-[10px] py-[6px] text-[12.5px] text-ink focus:outline-none"
                />
              </Card>
              {results.length > 0 && (
                <Banner
                  message={`Not done: ${results.map((r) => `${r.practical_id} (${r.message ?? r.code})`).join("; ")}`}
                />
              )}
              {data.drafts.map((draft) => (
                <DraftRow
                  key={draft.practical_id}
                  item={draft}
                  place={placeOf(draft.slot_id)}
                  checked={selected.has(draft.practical_id)}
                  onCheck={() => toggle(draft.practical_id)}
                  onApprove={() =>
                    review.approve.mutate({
                      practical_id: draft.practical_id,
                      note: note.trim() || null,
                    })
                  }
                  onReject={() =>
                    review.reject.mutate({
                      practical_id: draft.practical_id,
                      note: note.trim() || null,
                    })
                  }
                  onEdit={() => setEditor({ kind: "edit", item: draft })}
                  busy={review.approve.isPending || review.reject.isPending}
                />
              ))}
            </>
          )}
        </section>
      )}

      {data && tab === "live" && (
        <section className="flex flex-col gap-[10px]">
          {data.current.map((item) => (
            <LiveRow
              key={item.practical_id}
              item={item}
              disabled={running || generate.isPending}
              onReplace={() => startGenerate([item.practical_id])}
              onCopy={() => setEditor({ kind: "copy", item })}
            />
          ))}
        </section>
      )}

      {data && tab === "history" && (
        <section className="flex flex-col gap-[10px]">
          {data.history.length === 0 ? (
            <Card className="px-[18px] py-[16px]">
              <p className="text-[13px] text-ink-muted">
                Nothing has been replaced or rejected yet.
              </p>
            </Card>
          ) : (
            data.history.map((item) => (
              <HistoryRow
                key={item.practical_id}
                item={item}
                onRestore={() => review.restore.mutate(item.practical_id)}
                busy={review.restore.isPending}
              />
            ))
          )}
        </section>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "rounded-full border px-[13px] py-[5px] text-[12.5px] font-medium transition-colors",
        active
          ? "border-brand bg-brand-wash text-brand"
          : "border-line bg-surface text-ink-soft hover:border-brand-soft",
      )}
    >
      {children}
    </button>
  );
}

function JobBar({
  job,
}: {
  job: NonNullable<ReturnType<typeof useJob>["data"]>;
}) {
  const finished = job.status === "finished" || job.status === "failed";
  const percent = Math.round(
    ((job.done + job.failed) / Math.max(1, job.requested)) * 100,
  );
  return (
    <Card className="px-[16px] py-[12px]">
      <div className="flex items-center justify-between gap-[10px]">
        <p className="text-[13px] font-medium text-ink">
          {finished
            ? job.status === "failed"
              ? "Generation did not produce any drafts"
              : "Generation finished"
            : "Writing and checking drafts..."}
        </p>
        <span className="font-mono text-[11.5px] text-ink-muted">
          {job.done} of {job.requested} ready
          {job.failed > 0 ? `, ${job.failed} failed` : ""}
        </span>
      </div>
      <div className="mt-[8px] h-[7px] overflow-hidden rounded-full bg-surface-sunken">
        <div
          className={cx(
            "h-full rounded-full transition-[width] duration-700",
            job.status === "failed"
              ? "bg-caution"
              : "bg-gradient-to-r from-brand to-violet",
          )}
          style={{ width: `${finished ? 100 : Math.max(6, percent)}%` }}
        />
      </div>
      {job.message && (
        <p className="mt-[8px] text-[12px] text-caution-ink">{job.message}</p>
      )}
    </Card>
  );
}

function DraftRow({
  item,
  place,
  checked,
  onCheck,
  onApprove,
  onReject,
  onEdit,
  busy,
}: {
  item: AuthorItem;
  place: string;
  checked: boolean;
  onCheck: () => void;
  onApprove: () => void;
  onReject: () => void;
  onEdit: () => void;
  busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Card className={cx("px-[16px] py-[13px]", checked && "border-brand")}>
      <div className="flex flex-wrap items-start gap-[10px]">
        <input
          type="checkbox"
          checked={checked}
          onChange={onCheck}
          disabled={!item.can_approve}
          aria-label={`Select ${item.title}`}
          title={
            item.can_approve
              ? "Select for a bulk action"
              : "A failed check blocks this one"
          }
          className="mt-[4px] size-[15px]"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-[8px]">
            <p className="text-[14px] font-semibold text-ink">{item.title}</p>
            <OriginBadge origin={item.origin} />
            <Badge>level {item.level}</Badge>
            <span className="text-[11.5px] text-ink-faint">
              would replace <span className="text-ink-soft">{place}</span> ·{" "}
              {item.tests_total} tests
            </span>
          </div>
          <p className="mt-[5px] line-clamp-2 text-[12.5px] text-ink-soft">
            {item.statement.split("Sample input")[0]?.trim()}
          </p>
          <div className="mt-[8px]">
            <CheckChips checks={item.checks} />
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-[6px]">
          <Button onClick={onApprove} disabled={!item.can_approve || busy}>
            Approve
          </Button>
          <Button variant="secondary" onClick={onEdit} disabled={busy}>
            Edit
          </Button>
          <Button variant="ghost" onClick={onReject} disabled={busy}>
            Reject
          </Button>
        </div>
      </div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mt-[8px] text-[12px] font-medium text-brand hover:text-brand-hover"
      >
        {open ? "Hide the details" : "Show the task, solution and tests"}
      </button>
      {open && <Preview id={item.practical_id} />}
    </Card>
  );
}

function LiveRow({
  item,
  disabled,
  onReplace,
  onCopy,
}: {
  item: AuthorItem;
  disabled: boolean;
  onReplace: () => void;
  onCopy: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Card className="px-[16px] py-[12px]">
      <div className="flex flex-wrap items-center gap-[8px]">
        <p className="text-[13.5px] font-semibold text-ink">{item.title}</p>
        <OriginBadge origin={item.origin} />
        <Badge>level {item.level}</Badge>
        <span className="text-[11.5px] text-ink-faint">
          {item.tests_total} tests
        </span>
        <div className="ml-auto flex flex-wrap gap-[6px]">
          <Button variant="secondary" onClick={onReplace} disabled={disabled}>
            Draft a replacement
          </Button>
          <Button variant="ghost" onClick={onCopy}>
            Edit a copy
          </Button>
        </div>
      </div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mt-[6px] text-[12px] font-medium text-brand hover:text-brand-hover"
      >
        {open ? "Hide the details" : "Show the task, solution and tests"}
      </button>
      {open && <Preview id={item.practical_id} />}
    </Card>
  );
}

function HistoryRow({
  item,
  onRestore,
  busy,
}: {
  item: AuthorItem;
  onRestore: () => void;
  busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Card className="px-[16px] py-[12px]">
      <div className="flex flex-wrap items-center gap-[8px]">
        <p className="text-[13.5px] font-semibold text-ink">{item.title}</p>
        <OriginBadge origin={item.origin} />
        <Badge tone={item.status === "retired" ? "caution" : "neutral"}>
          {item.status === "retired" ? "replaced" : item.status}
        </Badge>
        <span className="text-[11.5px] text-ink-faint">
          {item.replaced_by ? `replaced by ${item.replaced_by}` : ""}
          {item.review_note ? ` · "${item.review_note}"` : ""}
        </span>
        {item.status === "retired" && (
          <Button
            variant="secondary"
            onClick={onRestore}
            disabled={busy}
            className="ml-auto"
          >
            Restore this one
          </Button>
        )}
      </div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mt-[6px] text-[12px] font-medium text-brand hover:text-brand-hover"
      >
        {open ? "Hide the details" : "Show the task, solution and tests"}
      </button>
      {open && <Preview id={item.practical_id} />}
    </Card>
  );
}
