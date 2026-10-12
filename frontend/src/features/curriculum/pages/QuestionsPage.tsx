import { Link, useNavigate, useParams } from 'react-router-dom';

import { ApiError } from '@/shared/api/client';
import { useAuth } from '@/shared/auth/AuthProvider';
import { Badge, Banner, Button, Card } from '@/shared/components/ui';
import {
  useCreatePaper,
  useDiscardPaper,
  usePapers,
  usePublishPapers,
  useRevisePaper,
  type PaperStatus,
  type PaperSummary,
} from '../api/curriculumApi';
import { ErrorCard, ModuleHeader, PageSkeleton, isStaff } from '../components/common';
import { moduleName } from '../lib/modules';

export const STATUS_TONE: Record<PaperStatus, 'brand' | 'verified' | 'neutral'> = {
  draft: 'brand',
  published: 'verified',
  locked: 'neutral',
};

const FORMS = ['A', 'B'] as const;

/**
 * Paper versions per form. Drafts are editable; published papers lock once anyone
 * takes them; a change to a published or locked paper is made in a new version.
 */
export function QuestionsPage() {
  const { moduleId = '' } = useParams<{ moduleId: string }>();
  const { user } = useAuth();
  const papers = usePapers(moduleId);
  const publish = usePublishPapers(moduleId);
  const create = useCreatePaper(moduleId);
  const navigate = useNavigate();

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
  if (papers.error) return <ErrorCard error={papers.error} what="the papers" />;
  if (!papers.data) return <PageSkeleton />;

  const hasDraft = papers.data.some((p) => p.status === 'draft');
  const problems = publishProblems(publish.error);

  return (
    <div className="flex flex-col gap-[22px]">
      <ModuleHeader moduleId={moduleId} />

      <Card className="flex flex-wrap items-center justify-between gap-[12px] px-[18px] py-[14px]">
        <p className="max-w-[560px] text-[12.5px] leading-[1.6] text-ink-muted">
          Publishing checks both forms together: 24 main questions each, twins that match, concepts
          that exist in the graph and valid answers. A paper locks as soon as a learner starts it;
          to change it, create a new version.
        </p>
        <Button disabled={!hasDraft} busy={publish.isPending} onClick={() => publish.mutate()}>
          Publish drafts
        </Button>
      </Card>

      {publish.data && (
        <p className="rounded-[8px] border border-verified-line bg-verified-wash px-[12px] py-[9px] text-[12.5px] text-verified-ink">
          Published: {publish.data.published.join(', ') || 'nothing'}.
        </p>
      )}
      {problems && (
        <div role="alert" className="rounded-[8px] border border-caution-line bg-caution-wash px-[14px] py-[10px]">
          <p className="text-[12.5px] font-medium text-caution-ink">Not published. Fix these first:</p>
          <ul className="mt-[6px] list-disc pl-[18px] text-[12px] text-caution-ink">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}
      {publish.error && !problems && <Banner message={errorMessage(publish.error)} />}

      {FORMS.map((form) => {
        const versions = papers.data
          .filter((p) => p.form === form)
          .sort((a, b) => b.version - a.version);
        return (
          <section key={form}>
            <h2 className="mb-[8px] text-[13.5px] font-semibold text-ink">Form {form}</h2>
            {versions.length === 0 ? (
              <Card className="flex flex-wrap items-center justify-between gap-[10px] px-[18px] py-[14px]">
                <p className="text-[12.5px] text-ink-muted">No paper for this form yet.</p>
                <Button
                  variant="secondary"
                  busy={create.isPending}
                  onClick={() =>
                    create.mutate(
                      { form, title: `${moduleName(moduleId)} test, form ${form}` },
                      {
                        onSuccess: (paper) =>
                          navigate(`/curriculum/${moduleId}/questions/${paper.paper_id}`),
                      },
                    )
                  }
                >
                  Create form {form}
                </Button>
              </Card>
            ) : (
              <Card className="divide-y divide-line-soft overflow-hidden">
                {versions.map((paper) => (
                  <PaperRow
                    key={paper.paper_id}
                    moduleId={moduleId}
                    paper={paper}
                    canRevise={!versions.some((v) => v.status === 'draft')}
                  />
                ))}
              </Card>
            )}
          </section>
        );
      })}
    </div>
  );
}

function PaperRow({
  moduleId,
  paper,
  canRevise,
}: {
  moduleId: string;
  paper: PaperSummary;
  canRevise: boolean;
}) {
  const revise = useRevisePaper(moduleId);
  const discard = useDiscardPaper(moduleId);
  const navigate = useNavigate();
  const error = revise.error ?? discard.error;

  return (
    <div className="px-[16px] py-[12px]">
      <div className="flex flex-wrap items-center justify-between gap-[10px]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-[6px]">
            <Link
              to={`/curriculum/${moduleId}/questions/${encodeURIComponent(paper.paper_id)}`}
              className="text-[13px] font-medium text-ink hover:text-brand"
            >
              {paper.title}
            </Link>
            <Badge tone={STATUS_TONE[paper.status]}>{paper.status}</Badge>
            <Badge>v{paper.version}</Badge>
            {paper.current && <Badge tone="brand">given to new learners</Badge>}
          </div>
          <p className="mt-[3px] font-mono text-[10.5px] text-ink-faint">
            {paper.paper_id} · {paper.main_items} main
            {paper.prereq_items ? ` + ${paper.prereq_items} background` : ''}
          </p>
        </div>
        <div className="flex gap-[8px]">
          {paper.status === 'draft' ? (
            <Button
              variant="ghost"
              busy={discard.isPending}
              onClick={() => discard.mutate(paper.paper_id)}
            >
              Discard draft
            </Button>
          ) : (
            canRevise && (
              <Button
                variant="secondary"
                busy={revise.isPending}
                onClick={() =>
                  revise.mutate(paper.paper_id, {
                    onSuccess: (draft) =>
                      navigate(
                        `/curriculum/${moduleId}/questions/${encodeURIComponent(draft.paper_id)}`,
                      ),
                  })
                }
              >
                New version
              </Button>
            )
          )}
        </div>
      </div>
      {error && (
        <div className="mt-[8px]">
          <Banner message={errorMessage(error)} />
        </div>
      )}
    </div>
  );
}

export function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Something went wrong. Try again.';
}

function publishProblems(error: unknown): string[] | null {
  if (!(error instanceof ApiError) || error.code !== 'publish_failed') return null;
  const problems = error.details.problems;
  return Array.isArray(problems) ? problems.map(String) : null;
}
