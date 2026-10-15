import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { ApiError } from '@/shared/api/client';
import { Badge, Banner, Button, Card, cx } from '@/shared/components/ui';
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
import { CheckIcon } from '../components/icons';
import { Markdown } from '../components/Markdown';
import { RewardCelebration } from '../components/RewardCelebration';
import { RewardStrip } from '../components/RewardStrip';

/**
 * Write a Java program, try it on input of your choice, then submit it against every test.
 * Visible tests show their input and expected output; hidden ones only say pass or fail.
 */
export function PracticalPage() {
  const { practicalId } = useParams<{ practicalId: string }>();
  const { data, isPending, error } = usePractical(practicalId);

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
    run.mutate({ source, stdin }, { onSuccess: setRan });
  }, [run, source, stdin]);

  const doSubmit = () => {
    setRan(null);
    submit.mutate(source, {
      onSuccess: (result) => {
        setSubmitted(result);
        if (result.passed) fireConfetti('small', { x: 0.5, y: 0.3 });
        const r = result.rewards;
        if (r && (r.level_up || r.badges.length > 0)) {
          window.setTimeout(() => setCelebrate(r), 800);
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
          ← Practicals
        </Link>
        <div className="mt-[8px] flex flex-wrap items-center gap-[10px]">
          <h1 className="text-[22px] font-semibold tracking-tight text-ink">{practical.title}</h1>
          <Badge tone={practical.level >= 5 ? 'caution' : 'brand'}>level {practical.level}</Badge>
          {practical.passed && (
            <Badge tone="verified">
              <CheckIcon className="size-[11px]" /> passed
            </Badge>
          )}
        </div>
      </header>

      {failure && (
        <Banner
          message={failure instanceof ApiError ? failure.message : 'Something went wrong.'}
          code={failure instanceof ApiError ? failure.code : undefined}
        />
      )}

      <div className="grid items-start gap-[18px] lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <Card className="px-[20px] py-[18px]">
          <p className="font-mono text-[10.5px] tracking-wide text-ink-faint uppercase">Task</p>
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
            className="rounded-[10px] border border-line bg-surface px-[12px] py-[9px] font-mono text-[12.5px] text-ink focus:outline-none"
          />

          <div className="flex flex-wrap items-center gap-[10px]">
            <Button variant="secondary" onClick={doRun} busy={run.isPending} disabled={busy}>
              Run
            </Button>
            <Button
              onClick={doSubmit}
              busy={submit.isPending}
              disabled={busy || practical.tests_total === 0}
            >
              Submit for marking
            </Button>
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

      {celebrate && (
        <RewardCelebration rewards={celebrate} onDone={() => setCelebrate(null)} />
      )}
    </div>
  );
}

function Pre({ children, tone }: { children: string; tone?: 'bad' }) {
  return (
    <pre
      className={cx(
        'max-h-[260px] overflow-auto rounded-[8px] border px-[12px] py-[9px] font-mono text-[12.5px] leading-[1.55] whitespace-pre-wrap',
        tone === 'bad'
          ? 'border-caution-line bg-caution-wash text-caution-ink'
          : 'border-line bg-surface-muted text-ink',
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
    <Card
      className={cx(
        'animate-slide-up px-[16px] py-[14px]',
        result.passed ? 'border-verified-line' : 'border-caution-line',
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-[10px]">
        <p
          className={cx(
            'text-[15px] font-semibold',
            result.passed ? 'text-verified-ink' : 'text-caution-ink',
          )}
        >
          {result.passed
            ? `All ${result.tests_total} tests passed`
            : `${result.tests_passed} of ${result.tests_total} tests passed`}
        </p>
        <div className="flex gap-[4px]" aria-hidden="true">
          {result.results.map((r) => (
            <span
              key={r.number}
              className={cx('size-[10px] rounded-[3px]', r.passed ? 'bg-verified' : 'bg-caution')}
            />
          ))}
        </div>
      </div>

      {result.rewards && (
        <RewardStrip
          points={0}
          bonuses={result.rewards.bonuses}
          className="mt-[10px]"
        />
      )}

      <ul className="mt-[10px] flex flex-col gap-[6px]">
        {result.results.map((r) => (
          <TestRow key={r.number} test={r} />
        ))}
      </ul>
    </Card>
  );
}

function TestRow({ test }: { test: TestResult }) {
  const why =
    test.status === 'timeout'
      ? 'took too long'
      : test.status === 'runtime_error'
        ? 'crashed'
        : test.status === 'output_limit'
          ? 'printed too much'
          : null;

  return (
    <li className="rounded-[8px] border border-line-soft bg-surface-muted px-[11px] py-[8px]">
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
          {test.visible ? `Sample test ${test.number}` : `Hidden test ${test.number}`}
        </span>
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
