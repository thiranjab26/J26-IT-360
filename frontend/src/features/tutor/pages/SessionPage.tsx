import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { ApiError } from '@/shared/api/client';
import { Badge, Banner, Card, cx } from '@/shared/components/ui';
import {
  useAnswerSession,
  useContinueSession,
  useEndSession,
  useResumeSession,
  useSession,
  useSessionHistory,
  useStartSession,
  type Rewards,
  type Session,
} from '../api/sessionApi';
import { companionSays } from '../components/companion';
import { fireConfetti, useCountUp, useElapsedSeconds } from '../components/fx';
import { GameButton } from '../components/GameButton';
import { GeneratingCard } from '../components/GeneratingCard';
import { PartNav, PartView } from '../components/ReviewPanel';
import { BoltIcon, FlameIcon } from '../components/icons';
import { Companion } from '../components/Mascot';
import { RewardCelebration } from '../components/RewardCelebration';
import { playCue } from '../components/sound';
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
 * student does, and celebrates what the server says was earned.
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

  // The full-screen moments (a level up, a badge). Everything else is shown inline.
  const [celebration, setCelebration] = useState<{ key: number; rewards: Rewards } | null>(null);
  // Which earlier part is on screen (an index into the parts already read), or null for the
  // part the student is actually on. Looking back never changes the session.
  const [viewing, setViewing] = useState<number | null>(null);
  // Right answers in a row on this screen. A miss resets it. It is flair, not a score.
  const [combo, setCombo] = useState(0);
  // Moving on can mean preparing the next part (retrieve, write, check), which takes a while.
  // Once it is clearly slow, a progress card replaces the page so it never looks frozen.
  // Ordinary steps return in a second or two, so the card waits until a request is clearly slow.
  const elapsed = useElapsedSeconds(next.isPending);
  const preparing = next.isPending && elapsed >= 3;
  const counter = useRef(0);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach(window.clearTimeout), []);

  const stepNumber = session?.position.step_number;
  const parts = useSessionHistory(sessionId, stepNumber).data?.parts ?? [];
  const goBack = useCallback(
    () => setViewing((now) => (now === null ? parts.length - 1 : Math.max(0, now - 1))),
    [parts.length],
  );
  const goForward = useCallback(
    () => setViewing((now) => (now === null || now >= parts.length - 1 ? null : now + 1)),
    [parts.length],
  );
  // Moving on, or a new answer, always brings the student back to the part they are on.
  useEffect(() => setViewing(null), [stepNumber, session?.phase]);

  const react = useCallback((response: Session) => {
    if (response.feedback?.outcome === 'correct') fireConfetti('small', { x: 0.5, y: 0.3 });
    const rewards = response.rewards;
    if (rewards && (rewards.level_up || rewards.badges.length > 0)) {
      // A beat after the answer, so the student sees what they got right first.
      const id = window.setTimeout(() => {
        counter.current += 1;
        playCue('levelup');
        setCelebration({ key: counter.current, rewards });
      }, 900);
      timers.current.push(id);
    } else if (
      response.summary &&
      ['completed', 'mastery_satisfied'].includes(response.summary.exit_reason)
    ) {
      fireConfetti('big', { x: 0.5, y: 0.25 });
      playCue('clear');
    }
  }, []);
  const closeCelebration = useCallback(() => setCelebration(null), []);

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
  const goNext = () => next.mutate(session.session_id, { onSuccess: react });

  return (
    <div className="mx-auto flex max-w-[760px] flex-col gap-[16px]">
      <SessionHeader
        session={session}
        combo={combo}
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

      <Companion
        {...(preparing
          ? {
              mood: 'think' as const,
              text: 'Hold on, I am checking every fact against the course.',
            }
          : companionSays(session, combo))}
        className="animate-slide-up"
      />

      {parts.length > 0 && !preparing && session.phase !== 'ended' && (
        <PartNav
          label={
            viewing === null
              ? `You are on part ${session.position.step_number} of ${session.position.total_steps}`
              : `Looking back: part ${viewing + 1} of ${parts.length}`
          }
          canBack={viewing === null || viewing > 0}
          canForward={viewing !== null}
          looking={viewing !== null}
          onBack={goBack}
          onForward={goForward}
        />
      )}

      {preparing && <GeneratingCard elapsed={elapsed} />}
      {viewing !== null && parts[viewing] && !preparing && (
        <PartView part={parts[viewing]} onClose={() => setViewing(null)} />
      )}

      {!preparing && viewing === null && (
        <>
          {session.phase === 'hook' && <HookCard session={session} busy={busy} onNext={goNext} />}
          {session.phase === 'teach' && <TeachCard session={session} busy={busy} onNext={goNext} />}
          {session.phase === 'checkpoint' && session.question && (
            <QuestionCard
              session={session}
              question={session.question}
              busy={busy}
              onAnswer={(text) =>
                answer.mutate(
                  { sessionId: session.session_id, answer: text },
                  {
                    onSuccess: (response) => {
                      const outcome = response.feedback?.outcome;
                      if (outcome === 'correct') setCombo((n) => n + 1);
                      else if (outcome === 'wrong') setCombo(0);
                      react(response);
                    },
                  },
                )
              }
            />
          )}
          {session.phase === 'feedback' && (
            <FeedbackCard session={session} busy={busy} onNext={goNext} />
          )}
          {session.phase === 'reteach' && (
            <ReteachCard session={session} busy={busy} onNext={goNext} />
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
        </>
      )}

      {celebration && (
        <RewardCelebration
          key={celebration.key}
          rewards={celebration.rewards}
          onDone={closeCelebration}
        />
      )}
    </div>
  );
}

function SessionHeader({
  session,
  combo,
  onEnd,
  ending,
  onBack,
}: {
  session: Session;
  combo: number;
  onEnd: () => void;
  ending: boolean;
  onBack: () => void;
}) {
  const { step_number, total_steps, gating_done, gating_total } = session.position;
  const ended = session.phase === 'ended';
  const xp = useCountUp(session.xp_earned);

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
            className="inline-flex animate-pop items-center gap-[5px] rounded-full border border-gold bg-gold-wash px-[11px] py-[3px] font-mono text-[11.5px] font-semibold text-gold-ink"
          >
            <BoltIcon className="size-[12px] text-gold-deep" />
            {xp} XP
          </span>
          {combo >= 2 && (
            <span
              key={combo}
              className="inline-flex animate-pop items-center gap-[4px] rounded-full bg-flame/15 px-[10px] py-[3px] font-mono text-[11.5px] font-bold text-flame"
            >
              <FlameIcon className="size-[13px] animate-flicker" />x{combo} combo
            </span>
          )}
          {!ended && (
            <GameButton
              variant="ghost"
              onClick={onEnd}
              busy={ending}
              className="px-[10px] py-[5px]"
            >
              End session
            </GameButton>
          )}
        </div>
      </div>

      <h1 className="mt-[8px] bg-gradient-to-r from-ink to-brand bg-clip-text text-[24px] font-extrabold tracking-tight text-transparent">
        {session.concept_title}
      </h1>

      <div className="mt-[12px] flex items-center gap-[12px]">
        <StepTrail current={ended ? total_steps : step_number} total={total_steps} />
        <Badge tone={gating_done >= gating_total && gating_total > 0 ? 'verified' : 'neutral'}>
          {gating_done} of {gating_total} checkpoints
        </Badge>
      </div>
    </header>
  );
}

/** One segment per step: done ones filled, the current one glowing, the rest empty. */
function StepTrail({ current, total }: { current: number; total: number }) {
  return (
    <ol
      className="flex flex-1 gap-[4px]"
      aria-label={`Step ${Math.min(current, total)} of ${total}`}
    >
      {Array.from({ length: total }, (_, i) => {
        const done = i + 1 < current || current > total;
        const here = i + 1 === current;
        return (
          <li
            key={i}
            className={cx(
              'h-[11px] flex-1 rounded-full transition-all duration-500',
              done &&
                'bg-gradient-to-r from-brand to-violet shadow-[0_0_10px_oklch(0.68_0.19_275/0.55)]',
              here && !done && 'animate-pulse-ring bg-brand',
              !done && !here && 'bg-surface-sunken',
            )}
          />
        );
      })}
    </ol>
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
