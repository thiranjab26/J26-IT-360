import { Link, useNavigate, useParams } from 'react-router-dom';

import { ApiError } from '@/shared/api/client';
import { Badge, Banner, Button, Card } from '@/shared/components/ui';
import {
  useAnswerSession,
  useContinueSession,
  useEndSession,
  useResumeSession,
  useSession,
  useStartSession,
  type Session,
} from '../api/sessionApi';
import {
  FeedbackCard,
  HookCard,
  QuestionCard,
  ReteachCard,
  SummaryCard,
  TeachCard,
} from '../components/SessionCards';

/**
 * A guided session on one concept: the tutor leads, the student reads, answers and
 * moves on. The server owns every rule (what comes next, what a wrong answer costs,
 * when a session ends); this page only shows the state it is given and sends what the
 * student does.
 */
export function SessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();

  const { data: session, isPending, error } = useSession(sessionId);
  const next = useContinueSession();
  const answer = useAnswerSession();
  const end = useEndSession();
  const resume = useResumeSession();
  const restart = useStartSession();

  if (isPending) return <SessionSkeleton />;

  if (error || !session) {
    const missing = error instanceof ApiError && error.status === 404;
    return (
      <Card className="px-[20px] py-[18px]">
        <p className="text-[13px] text-ink">
          {missing ? 'That session does not exist.' : 'Could not load this session.'}
        </p>
        <Link
          to="/dashboard"
          className="mt-[10px] inline-block text-[12.5px] font-medium text-brand hover:text-brand-hover"
        >
          Back to modules
        </Link>
      </Card>
    );
  }

  const moduleId = session.concept_id.split('.')[0];
  const backToMap = () => navigate(`/modules/${moduleId}`);
  const busy =
    next.isPending || answer.isPending || end.isPending || resume.isPending || restart.isPending;
  const failure = [next, answer, end, resume, restart].find((action) => action.error)?.error;

  return (
    <div className="mx-auto flex max-w-[760px] flex-col gap-[16px]">
      <SessionHeader
        session={session}
        onEnd={() => end.mutate(session.session_id)}
        ending={end.isPending}
        onBack={backToMap}
      />

      {failure && (
        <Banner
          message={failure instanceof ApiError ? failure.message : 'Something went wrong.'}
          code={failure instanceof ApiError ? failure.code : undefined}
        />
      )}

      {session.phase === 'hook' && (
        <HookCard session={session} busy={busy} onNext={() => next.mutate(session.session_id)} />
      )}
      {session.phase === 'teach' && (
        <TeachCard session={session} busy={busy} onNext={() => next.mutate(session.session_id)} />
      )}
      {session.phase === 'checkpoint' && session.question && (
        <QuestionCard
          session={session}
          question={session.question}
          busy={busy}
          onAnswer={(text) => answer.mutate({ sessionId: session.session_id, answer: text })}
        />
      )}
      {session.phase === 'feedback' && (
        <FeedbackCard session={session} busy={busy} onNext={() => next.mutate(session.session_id)} />
      )}
      {session.phase === 'reteach' && (
        <ReteachCard session={session} busy={busy} onNext={() => next.mutate(session.session_id)} />
      )}
      {session.phase === 'ended' && session.summary && (
        <SummaryCard
          session={session}
          summary={session.summary}
          busy={busy}
          onResume={() => resume.mutate(session.session_id)}
          onRestart={() =>
            restart.mutate(session.concept_id, {
              onSuccess: (started) => navigate(`/sessions/${started.session_id}`),
            })
          }
          onBack={backToMap}
        />
      )}
    </div>
  );
}

function SessionHeader({
  session,
  onEnd,
  ending,
  onBack,
}: {
  session: Session;
  onEnd: () => void;
  ending: boolean;
  onBack: () => void;
}) {
  const { step_number, total_steps, gating_done, gating_total } = session.position;
  const ended = session.phase === 'ended';
  const percent = ended
    ? 100
    : Math.round(((step_number - 1) / Math.max(1, total_steps)) * 100);

  return (
    <header>
      <div className="flex flex-wrap items-center justify-between gap-[10px]">
        <button
          type="button"
          onClick={onBack}
          className="font-mono text-[11px] text-ink-faint hover:text-brand"
        >
          ← Quest map
        </button>
        <div className="flex items-center gap-[8px]">
          {/* Re-keyed on every change so the badge pops when XP is earned. */}
          <span
            key={session.xp_earned}
            className="animate-pop inline-flex items-center rounded-full border border-brand-soft bg-brand-wash px-[11px] py-[3px] font-mono text-[11.5px] font-semibold text-brand"
          >
            {session.xp_earned} XP
          </span>
          {!ended && (
            <Button variant="ghost" onClick={onEnd} busy={ending} className="px-[10px] py-[5px]">
              End session
            </Button>
          )}
        </div>
      </div>

      <h1 className="mt-[8px] text-[22px] font-semibold tracking-tight text-ink">
        {session.concept_title}
      </h1>

      <div className="mt-[12px] flex items-center gap-[12px]">
        <div
          className="h-[7px] flex-1 overflow-hidden rounded-full bg-surface-sunken"
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Session progress"
        >
          <div
            className="h-full rounded-full bg-brand transition-[width] duration-500"
            style={{ width: `${percent}%` }}
          />
        </div>
        <Badge>
          {gating_done} of {gating_total} checkpoints
        </Badge>
      </div>
    </header>
  );
}

function SessionSkeleton() {
  return (
    <div className="mx-auto max-w-[760px] animate-pulse">
      <div className="h-[9px] w-[70px] rounded-full bg-surface-sunken" />
      <div className="mt-[12px] h-[22px] w-1/2 rounded-full bg-surface-sunken" />
      <div className="mt-[28px] h-[260px] rounded-[14px] bg-surface-sunken" />
    </div>
  );
}
