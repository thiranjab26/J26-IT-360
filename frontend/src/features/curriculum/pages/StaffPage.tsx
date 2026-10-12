import { useState } from 'react';
import { useParams } from 'react-router-dom';

import { useAuth } from '@/shared/auth/AuthProvider';
import { Banner, Button, Card, cx } from '@/shared/components/ui';
import {
  useCohortGain,
  useOverview,
  useSetWindow,
  useSnapshotValidation,
  useWindow,
  type CohortGain,
  type Overview,
  type Phase,
  type SnapshotValidation,
} from '../api/curriculumApi';
import { ErrorCard, ModuleHeader, PageSkeleton, isStaff } from '../components/common';
import { PHASE_LABELS, percent } from '../lib/modules';

const PHASES: Array<{ phase: Phase; note: string }> = [
  { phase: 'closed', note: 'Nothing is open. Learners can still see the roadmap.' },
  { phase: 'pretest', note: 'Learners can take the pre-test once.' },
  { phase: 'learning', note: 'Learners get recommendations and practise.' },
  { phase: 'posttest', note: 'Learners take the post-test (the other form).' },
  { phase: 'finished', note: 'The study is over for this module.' },
];

/** Lecturer view: study window, class progress, gain per group, BKT validity. Counts only. */
export function StaffPage() {
  const { moduleId = '' } = useParams<{ moduleId: string }>();
  const { user } = useAuth();
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
  if (win.error) return <ErrorCard error={win.error} what="the study window" />;
  if (!win.data) return <PageSkeleton />;

  return (
    <div className="flex flex-col gap-[24px]">
      <ModuleHeader moduleId={moduleId} phase={win.data.phase} />
      <WindowControl moduleId={moduleId} phase={win.data.phase} />
      <OverviewSection moduleId={moduleId} />
      <CohortSection moduleId={moduleId} />
      <SnapshotSection moduleId={moduleId} />
    </div>
  );
}

/* ---------------------------------------------------------- Window control */

function WindowControl({ moduleId, phase }: { moduleId: string; phase: Phase }) {
  const [pending, setPending] = useState<Phase | null>(null);
  const setWindow = useSetWindow(moduleId);

  function confirm() {
    if (!pending) return;
    setWindow.mutate(pending, { onSuccess: () => setPending(null) });
  }

  return (
    <section>
      <SectionTitle
        title="Study window"
        note="Opens and closes the tests for the whole class in this module."
      />
      <Card className="px-[18px] py-[16px]">
        <div className="grid gap-[8px] sm:grid-cols-5">
          {PHASES.map(({ phase: p, note }) => (
            <button
              key={p}
              type="button"
              onClick={() => setPending(p === phase ? null : p)}
              aria-pressed={p === phase}
              className={cx(
                'rounded-[8px] border px-[12px] py-[10px] text-left transition-colors',
                p === phase
                  ? 'border-brand bg-brand-wash'
                  : pending === p
                    ? 'border-caution-line bg-caution-wash'
                    : 'border-line hover:border-line-strong',
              )}
            >
              <span className="block text-[12.5px] font-medium text-ink">{PHASE_LABELS[p]}</span>
              <span className="mt-[2px] block text-[11px] leading-[1.45] text-ink-muted">
                {note}
              </span>
            </button>
          ))}
        </div>
        {pending && (
          <div className="mt-[14px] flex flex-wrap items-center justify-between gap-[10px] border-t border-line-soft pt-[12px]">
            <p className="text-[12.5px] text-caution-ink">
              Change from {PHASE_LABELS[phase]} to {PHASE_LABELS[pending]} for every learner?
            </p>
            <div className="flex gap-[8px]">
              <Button variant="secondary" onClick={() => setPending(null)}>
                Cancel
              </Button>
              <Button busy={setWindow.isPending} onClick={confirm}>
                Yes, change
              </Button>
            </div>
          </div>
        )}
        {setWindow.error && (
          <div className="mt-[10px]">
            <Banner message="Could not change the window." />
          </div>
        )}
      </Card>
    </section>
  );
}

/* ---------------------------------------------------------------- Overview */

function OverviewSection({ moduleId }: { moduleId: string }) {
  const overview = useOverview(moduleId);
  return (
    <section>
      <SectionTitle title="Class progress" note="Counts only; no learner is named." />
      {overview.error ? (
        <ErrorCard error={overview.error} what="the class overview" />
      ) : !overview.data ? (
        <Skeleton />
      ) : (
        <OverviewBody data={overview.data} />
      )}
    </section>
  );
}

function OverviewBody({ data }: { data: Overview }) {
  return (
    <div className="flex flex-col gap-[10px]">
      <div className="grid grid-cols-2 gap-[10px] sm:grid-cols-4">
        <Stat label="Learners" value={data.learners} />
        <Stat label="Pre-test done" value={data.pretest_done} />
        <Stat label="Post-test done" value={data.posttest_done} />
        <Stat
          label="Groups"
          value={Object.entries(data.groups)
            .map(([g, n]) => `${g} ${n}`)
            .join(' / ') || '-'}
        />
      </div>
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[480px] text-left text-[12.5px]">
          <thead>
            <tr className="border-b border-line text-[11px] text-ink-muted">
              <th className="px-[14px] py-[8px] font-medium">Concept</th>
              <th className="px-[10px] py-[8px] text-right font-medium">Learners</th>
              <th className="px-[10px] py-[8px] text-right font-medium">Mastered</th>
              <th className="px-[14px] py-[8px] text-right font-medium">Mean mastery</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-soft">
            {data.concepts.map((c) => (
              <tr key={c.concept_id}>
                <td className="px-[14px] py-[8px] text-ink">{c.name}</td>
                <td className="px-[10px] py-[8px] text-right font-mono text-ink-soft">
                  {c.learners}
                </td>
                <td className="px-[10px] py-[8px] text-right font-mono text-ink-soft">
                  {c.mastered}
                  {c.mastered_pct !== null && (
                    <span className="text-ink-faint"> ({Math.round(c.mastered_pct)}%)</span>
                  )}
                </td>
                <td className="px-[14px] py-[8px] text-right font-mono text-ink">
                  {c.mean_mastery === null ? '-' : percent(c.mean_mastery)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------- Cohort gain */

function CohortSection({ moduleId }: { moduleId: string }) {
  const gain = useCohortGain(moduleId);
  return (
    <section>
      <SectionTitle
        title="Learning gain by group"
        note="Adaptive order vs fixed syllabus order. g = (post - pre) / (100 - pre)."
      />
      {gain.error ? (
        <ErrorCard error={gain.error} what="cohort gain" />
      ) : !gain.data ? (
        <Skeleton />
      ) : (
        <CohortBody data={gain.data} />
      )}
    </section>
  );
}

function fixed(value: number | null, digits = 2): string {
  return value === null ? '-' : value.toFixed(digits);
}

function CohortBody({ data }: { data: CohortGain }) {
  const groups = Object.entries(data.groups);
  return (
    <div className="flex flex-col gap-[10px]">
      <p className="font-mono text-[11px] text-ink-faint">
        {data.enrolled} enrolled, {data.pretest_done} pre-tests, {data.posttest_done} post-tests
      </p>
      {groups.length === 0 ? (
        <Card className="px-[18px] py-[14px]">
          <p className="text-[12.5px] text-ink-muted">No learner has finished both tests yet.</p>
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-[12.5px]">
            <thead>
              <tr className="border-b border-line text-[11px] text-ink-muted">
                <th className="px-[14px] py-[8px] font-medium">Group</th>
                <th className="px-[10px] py-[8px] text-right font-medium">Learners</th>
                <th className="px-[10px] py-[8px] text-right font-medium">Mean pre</th>
                <th className="px-[10px] py-[8px] text-right font-medium">Mean post</th>
                <th className="px-[10px] py-[8px] text-right font-medium">Mean g</th>
                <th className="px-[14px] py-[8px] text-right font-medium">Class g</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {groups.map(([group, s]) => (
                <tr key={group}>
                  <td className="px-[14px] py-[8px] capitalize text-ink">{group}</td>
                  <td className="px-[10px] py-[8px] text-right font-mono">{s.learners}</td>
                  <td className="px-[10px] py-[8px] text-right font-mono">{fixed(s.mean_pre, 1)}</td>
                  <td className="px-[10px] py-[8px] text-right font-mono">{fixed(s.mean_post, 1)}</td>
                  <td className="px-[10px] py-[8px] text-right font-mono">{fixed(s.mean_gain)}</td>
                  <td className="px-[14px] py-[8px] text-right font-mono text-ink">
                    {fixed(s.class_gain)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

/* --------------------------------------------------------- BKT validity */

function SnapshotSection({ moduleId }: { moduleId: string }) {
  const snap = useSnapshotValidation(moduleId);
  return (
    <section>
      <SectionTitle
        title="Mastery check"
        note="Does mastery at the start of the post-test predict the post-test answers?"
      />
      {snap.error ? (
        <ErrorCard error={snap.error} what="the mastery check" />
      ) : !snap.data ? (
        <Skeleton />
      ) : (
        <SnapshotBody data={snap.data} />
      )}
    </section>
  );
}

function SnapshotBody({ data }: { data: SnapshotValidation }) {
  if (data.answers === 0) {
    return (
      <Card className="px-[18px] py-[14px]">
        <p className="text-[12.5px] text-ink-muted">No post-test answers yet.</p>
      </Card>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-[10px] sm:grid-cols-4">
      <Stat label="Answers" value={`${data.answers} (${data.learners} learners)`} />
      <Stat label="AUC" value={fixed(data.auc, 3)} />
      <Stat label="Brier score" value={fixed(data.brier, 3)} />
      <Stat
        label="Mastered = correct"
        value={data.threshold_accuracy === null ? '-' : percent(data.threshold_accuracy)}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ Bits */

function SectionTitle({ title, note }: { title: string; note: string }) {
  return (
    <div className="mb-[10px]">
      <h2 className="text-[14px] font-semibold text-ink">{title}</h2>
      <p className="mt-[2px] text-[12px] text-ink-muted">{note}</p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <Card className="px-[14px] py-[12px]">
      <p className="text-[11.5px] text-ink-muted">{label}</p>
      <p className="mt-[2px] text-[16px] font-semibold tracking-tight text-ink">{value}</p>
    </Card>
  );
}

function Skeleton() {
  return <div className="h-[110px] animate-pulse rounded-[14px] bg-surface-sunken" />;
}
