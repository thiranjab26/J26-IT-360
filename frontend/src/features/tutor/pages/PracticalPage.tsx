import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, useParams } from 'react-router-dom';

import { ApiError } from '@/shared/api/client';
import { Banner, Card, cx } from '@/shared/components/ui';
import {
  usePractical,
  useRunPractical,
  useSubmitPractical,
  type Practical,
  type RunResult,
  type SubmitResult,
  type TestResult,
} from '../api/practicalApi';
import type { Rewards } from '../api/sessionApi';
import { CodeEditor } from '../components/CodeEditor';
import { fireConfetti } from '../components/fx';
import { GameButton } from '../components/GameButton';
import { BoltIcon, CheckIcon, LockIcon, PlayIcon, StarIcon } from '../components/icons';
import { Markdown } from '../components/Markdown';
import { Companion, Mascot } from '../components/Mascot';
import { RewardCelebration } from '../components/RewardCelebration';
import { RewardStrip } from '../components/RewardStrip';
import { playCue } from '../components/sound';

/**
 * Write a Java program, try it on input of your choice, then submit it against every test.
 * Visible tests show their input and expected output; hidden ones only say pass or fail.
 */
export function PracticalPage() {
  const { practicalId } = useParams<{ practicalId: string }>();
  const { data, isPending, error } = usePractical(practicalId);
  const client = useQueryClient();

  // A lecturer may have replaced this practical since the list was loaded. The service says what
  // took its place, so the student is moved there instead of meeting a dead end.
  const replacedBy =
    error instanceof ApiError && error.code === 'practical_replaced'
      ? String(error.details.replaced_by ?? '')
      : '';
  useEffect(() => {
    if (error) void client.invalidateQueries({ queryKey: ['tutor', 'practicals'] });
  }, [error, client]);
  if (replacedBy) return <Navigate to={`/practicals/${replacedBy}`} replace />;

  if (isPending) return <p className="text-[13px] text-ink-muted">Loading the practical...</p>;

  if (error || !data) {
    const locked = error instanceof ApiError && error.code === 'concept_locked';
    return (
      <Card className="px-[20px] py-[18px]">
        <p className="text-[13px] text-ink">
          {error instanceof ApiError ? error.message : 'Could not load this practical.'}
        </p>
        {locked && (
          <p className="mt-[4px] text-[12.5px] text-ink-muted">
            Finish the guided session on its concept first.
          </p>
        )}
        <Link to="/practicals" className="mt-[10px] inline-block text-[12.5px] text-brand">
          Back to practicals
        </Link>
      </Card>
    );
  }
  // Keyed, so opening another practical starts from that practical's own code.
  return <Workspace key={data.practical_id} practical={data} />;
}

function draftKey(id: string) {
  return `practical-draft:${id}`;
}

function Workspace({ practical }: { practical: Practical }) {
  const id = practical.practical_id;
  const sample = practical.visible_tests[0];

  const [source, setSource] = useState(() => {
    try {
      return localStorage.getItem(draftKey(id)) ?? practical.last_source ?? practical.starter_code;
    } catch {
      return practical.last_source ?? practical.starter_code;
    }
  });
  const [stdin, setStdin] = useState(sample?.stdin ?? '');
  const [ran, setRan] = useState<RunResult | null>(null);
  const [submitted, setSubmitted] = useState<SubmitResult | null>(null);
  const [celebrate, setCelebrate] = useState<Rewards | null>(null);

  const run = useRunPractical(id);
  const submit = useSubmitPractical(id);

  useEffect(() => {
    try {
      localStorage.setItem(draftKey(id), source);
    } catch {
      /* a full or blocked store only costs the draft */
    }
  }, [id, source]);

  const doRun = useCallback(() => {
    setSubmitted(null);
    run.mutate(
      { source, stdin },
      {
        onSuccess: (result) => {
          setRan(result);
          playCue(result.compiled && result.status === 'ok' ? 'run' : 'wrong');
        },
      },
    );
  }, [run, source, stdin]);

  const doSubmit = () => {
    setRan(null);
    submit.mutate(source, {
      onSuccess: (result) => {
        setSubmitted(result);
        if (result.passed) {
          fireConfetti('big', { x: 0.5, y: 0.3 });
          playCue('clear');
        } else {
          playCue('wrong');
        }
        const r = result.rewards;
        if (r && (r.level_up || r.badges.length > 0)) {
          window.setTimeout(() => {
            playCue('levelup');
            setCelebrate(r);
          }, 1200);
        }
      },
    });
  };

  const failure = run.error ?? submit.error;
  const busy = run.isPending || submit.isPending;

  return (
    <div className="flex flex-col gap-[16px]">
      <header>
        <Link to="/practicals" className="font-mono text-[11px] text-ink-faint hover:text-brand">
          ← All missions
        </Link>
        <div className="mt-[8px] flex flex-wrap items-center gap-[12px]">
          <h1 className="bg-gradient-to-r from-ink to-brand bg-clip-text text-[24px] font-extrabold tracking-tight text-transparent">
            {practical.title}
          </h1>
          <Difficulty level={practical.level} />
          {practical.passed && (
            <span className="inline-flex items-center gap-[5px] rounded-full bg-verified-wash px-[10px] py-[3px] font-mono text-[11px] font-bold text-verified-ink">
              <CheckIcon className="size-[11px]" /> CLEARED
            </span>
          )}
        </div>
      </header>

      <Companion
        mood={
          submitted ? (submitted.passed ? 'cheer' : 'oops') : ran && !ran.compiled ? 'oops' : 'idle'
        }
        text={
          submitted
            ? submitted.passed
              ? 'Mission clear! That is how you write it.'
              : submitted.compiled
                ? 'Some tests failed. Compare the expected output with yours.'
                : 'The compiler is unhappy. Read its message, line by line.'
            : ran && !ran.compiled
              ? 'It did not compile. The message below points at the line.'
              : 'Write your program, run it on the sample, then submit when it looks right.'
        }
        size={56}
      />

      {failure && (
        <Banner
          message={failure instanceof ApiError ? failure.message : 'Something went wrong.'}
          code={failure instanceof ApiError ? failure.code : undefined}
        />
      )}
      {failure instanceof ApiError && failure.code === 'practical_replaced' && (
        <Link
          to={`/practicals/${String(failure.details.replaced_by ?? '')}`}
          replace
          className="self-start rounded-full border border-brand bg-brand-wash px-[14px] py-[6px] text-[12.5px] font-semibold text-brand"
        >
          Open the updated practical
        </Link>
      )}

      <div className="grid items-start gap-[18px] lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <Card className="neon-edge px-[20px] py-[18px]">
          <p className="font-mono text-[10.5px] tracking-wide text-brand uppercase">
            Mission briefing
          </p>
          <Markdown className="mt-[10px]">{practical.statement}</Markdown>
          <p className="mt-[14px] text-[12px] text-ink-muted">
            {practical.tests_total > 0
              ? `Marked on ${practical.tests_total} tests: the sample above and ${practical.tests_total - practical.visible_tests.length} hidden ones.`
              : 'This practical has no tests yet, so it cannot be marked.'}
          </p>
        </Card>

        <div className="flex flex-col gap-[12px]">
          <CodeEditor value={source} onChange={setSource} onRun={doRun} disabled={busy} />

          <label className="text-[12px] font-medium text-ink-soft" htmlFor="stdin">
            Input for Run (what the program reads)
          </label>
          <textarea
            id="stdin"
            value={stdin}
            onChange={(event) => setStdin(event.target.value)}
            rows={3}
            spellCheck={false}
            className="rounded-[12px] border-2 border-line bg-[oklch(0.14_0.03_285)] px-[12px] py-[9px] font-mono text-[12.5px] text-[oklch(0.92_0.04_150)] focus:outline-none"
          />

          <div className="flex flex-wrap items-center gap-[10px]">
            <GameButton variant="secondary" onClick={doRun} busy={run.isPending} disabled={busy}>
              <PlayIcon className="size-[13px]" />
              Run
            </GameButton>
            <GameButton
              variant="go"
              onClick={doSubmit}
              busy={submit.isPending}
              disabled={busy || practical.tests_total === 0}
            >
              <BoltIcon className="size-[13px]" />
              Submit mission
            </GameButton>
            <button
              type="button"
              className="ml-auto text-[12px] text-ink-muted hover:text-brand"
              onClick={() => setSource(practical.starter_code)}
            >
              Reset to the starter code
            </button>
          </div>
          <p className="text-[11.5px] text-ink-faint">
            Run tries your program and scores nothing. Ctrl+Enter also runs it. Programs have 5
            seconds per test.
          </p>

          {ran && <RunPanel result={ran} sample={sample} stdin={stdin} />}
          {submitted && <SubmitPanel result={submitted} />}
        </div>
      </div>

      {celebrate && <RewardCelebration rewards={celebrate} onDone={() => setCelebrate(null)} />}
    </div>
  );
}

function Pre({ children, tone }: { children: string; tone?: 'bad' }) {
  return (
    <pre
      className={cx(
        'max-h-[260px] overflow-auto rounded-[10px] border px-[12px] py-[9px] font-mono text-[12.5px] leading-[1.55] whitespace-pre-wrap',
        tone === 'bad'
          ? 'border-caution-line bg-caution-wash text-caution-ink'
          : 'border-line bg-[oklch(0.14_0.03_285)] text-[oklch(0.88_0.14_150)]',
      )}
    >
      {children}
    </pre>
  );
}

function RunPanel({
  result,
  sample,
  stdin,
}: {
  result: RunResult;
  sample: { stdin: string; expected: string } | undefined;
  stdin: string;
}) {
  if (!result.compiled) {
    return (
      <Card className="animate-slide-up px-[16px] py-[14px]">
        <p className="text-[13px] font-semibold text-caution-ink">It did not compile</p>
        <Pre tone="bad">{result.compile_output}</Pre>
      </Card>
    );
  }
  const onSample = sample && stdin.trim() === sample.stdin.trim();
  const matches =
    onSample && result.status === 'ok' && result.stdout.trim() === sample.expected.trim();

  return (
    <Card className="animate-slide-up px-[16px] py-[14px]">
      <div className="flex items-center justify-between gap-[8px]">
        <p className="text-[13px] font-semibold text-ink">
          {result.status === 'ok'
            ? 'Output'
            : result.status === 'timeout'
              ? 'It took too long'
              : result.status === 'output_limit'
                ? 'It printed too much'
                : 'It crashed'}
        </p>
        <span className="font-mono text-[11px] text-ink-faint">{result.ms} ms</span>
      </div>
      <div className="mt-[8px] flex flex-col gap-[8px]">
        <Pre>{result.stdout || '(nothing printed)'}</Pre>
        {result.stderr && <Pre tone="bad">{result.stderr}</Pre>}
      </div>
      {onSample && (
        <p
          className={cx(
            'mt-[8px] text-[12.5px] font-medium',
            matches ? 'text-verified-ink' : 'text-caution-ink',
          )}
        >
          {matches ? 'This matches the sample output.' : 'This does not match the sample output.'}
        </p>
      )}
    </Card>
  );
}

function SubmitPanel({ result }: { result: SubmitResult }) {
  if (!result.compiled) {
    return (
      <Card className="animate-slide-up px-[16px] py-[14px]">
        <p className="text-[13px] font-semibold text-caution-ink">
          It did not compile, so no test ran.
        </p>
        <Pre tone="bad">{result.compile_output}</Pre>
      </Card>
    );
  }
  return (
    <Card className={cx('animate-rise px-[18px] py-[16px]', result.passed && 'neon-edge')}>
      <div className="flex items-center gap-[14px]">
        <Mascot mood={result.passed ? 'cheer' : 'oops'} size={58} />
        <div className="min-w-0 flex-1">
          <p
            className={cx(
              'text-[21px] font-extrabold tracking-tight',
              result.passed
                ? 'animate-glow bg-gradient-to-r from-gold to-flame bg-clip-text text-transparent'
                : 'text-caution-ink',
            )}
          >
            {result.passed ? 'MISSION CLEAR!' : 'Not yet. Keep debugging!'}
          </p>
          <p className="text-[12.5px] text-ink-muted">
            {result.passed
              ? `All ${result.tests_total} systems online.`
              : `${result.tests_passed} of ${result.tests_total} systems online.`}
          </p>
        </div>
      </div>

      <div className="mt-[14px] flex gap-[4px]" aria-hidden="true">
        {result.results.map((r, i) => (
          <span
            key={r.number}
            style={{ animationDelay: `${i * 90}ms` }}
            className={cx(
              'h-[12px] flex-1 animate-rise rounded-full',
              r.passed ? 'bg-verified shadow-[0_0_10px_oklch(0.68_0.17_155/0.7)]' : 'bg-caution/35',
            )}
          />
        ))}
      </div>

      {result.rewards && result.rewards.bonuses.length > 0 && (
        <RewardStrip points={0} bonuses={result.rewards.bonuses} className="mt-[12px]" />
      )}

      <ul className="mt-[12px] flex flex-col gap-[6px]">
        {result.results.map((r, i) => (
          <TestRow key={r.number} test={r} delay={i * 90} />
        ))}
      </ul>
    </Card>
  );
}

/** Difficulty as filled stars, out of five. */
function Difficulty({ level }: { level: number }) {
  const filled = Math.min(5, Math.max(1, level));
  return (
    <span role="img" aria-label={`Difficulty ${filled} of 5`} className="inline-flex gap-[2px]">
      {Array.from({ length: 5 }, (_, i) => (
        <StarIcon
          key={i}
          className={cx(
            'size-[16px]',
            i < filled
              ? 'text-gold drop-shadow-[0_0_5px_oklch(0.8_0.15_85/0.8)]'
              : 'text-line-strong',
          )}
        />
      ))}
    </span>
  );
}

function TestRow({ test, delay = 0 }: { test: TestResult; delay?: number }) {
  const why =
    test.status === 'timeout'
      ? 'took too long'
      : test.status === 'runtime_error'
        ? 'crashed'
        : test.status === 'output_limit'
          ? 'printed too much'
          : null;

  return (
    <li
      style={{ animationDelay: `${delay}ms` }}
      className="animate-slide-up rounded-[10px] border border-line-soft bg-surface-muted px-[11px] py-[8px]"
    >
      <div className="flex items-center gap-[8px] text-[12.5px]">
        <span
          className={cx(
            'flex size-[16px] items-center justify-center rounded-full text-white',
            test.passed ? 'bg-verified' : 'bg-caution',
          )}
        >
          {test.passed ? <CheckIcon className="size-[10px]" /> : <span>!</span>}
        </span>
        <span className="font-medium text-ink">
          {test.visible ? `Sample test ${test.number}` : `Hidden vault ${test.number}`}
        </span>
        {!test.visible && !test.passed && <LockIcon className="size-[12px] text-ink-faint" />}
        <span className="text-ink-muted">
          {test.passed ? 'passed' : why ? `failed (${why})` : 'failed'}
        </span>
      </div>
      {test.visible && !test.passed && (
        <div className="mt-[8px] grid gap-[8px] sm:grid-cols-2">
          <div>
            <p className="mb-[3px] font-mono text-[10px] tracking-wide text-ink-faint uppercase">
              Expected
            </p>
            <Pre>{test.expected ?? ''}</Pre>
          </div>
          <div>
            <p className="mb-[3px] font-mono text-[10px] tracking-wide text-ink-faint uppercase">
              Your output
            </p>
            <Pre>{test.actual || '(nothing printed)'}</Pre>
          </div>
        </div>
      )}
    </li>
  );
}
