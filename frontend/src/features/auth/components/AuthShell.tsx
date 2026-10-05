/** The split layout both auth screens share: product story left, form right. */
import type { ReactNode } from 'react';

import { Badge } from '@/shared/components/ui';

const POINTS = [
  'Every explanation is checked claim by claim against your course material before you see it.',
  'Topics unlock on demonstrated mastery, not on points collected.',
  'Sessions adapt to your cognitive load, from a categorical signal only.',
];

export function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[1.05fr_1fr]">
      {/* Story panel. Hidden on small screens, where the form is the whole job. */}
      <aside className="hidden flex-col justify-between border-r border-line bg-surface px-[56px] py-[48px] lg:flex">
        <div className="flex items-center gap-[10px]">
          <Mark />
          <span className="text-[15px] font-semibold tracking-tight">AdaptLearn</span>
        </div>

        <div className="max-w-[420px]">
          <Badge tone="verified">
            <Check /> Faithfulness verified
          </Badge>
          <h1 className="mt-[18px] text-[28px] leading-[1.2] font-semibold tracking-tight text-ink">
            Tutoring you can check.
          </h1>
          <p className="mt-[12px] text-[13.5px] text-ink-muted">
            A personalized learning platform that starts with Programming Fundamentals in Java,
            built around verified explanations and mastery-gated progress.
          </p>

          <ul className="mt-[26px] flex flex-col gap-[14px]">
            {POINTS.map((point) => (
              <li key={point} className="flex gap-[10px]">
                <span className="mt-[6px] size-[5px] shrink-0 rounded-full bg-brand" />
                <span className="text-[12.5px] leading-[1.6] text-ink-muted">{point}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="font-mono text-[10.5px] text-ink-faint">
          J26-IT-360 · SLIIT final-year research project
        </p>
      </aside>

      {/* Form panel */}
      <main className="flex min-h-screen items-center justify-center px-[20px] py-[40px]">
        <div className="w-full max-w-[400px]">
          <div className="mb-[26px] flex items-center gap-[10px] lg:hidden">
            <Mark />
            <span className="text-[15px] font-semibold tracking-tight">AdaptLearn</span>
          </div>

          <h2 className="text-[22px] font-semibold tracking-tight text-ink">{title}</h2>
          <p className="mt-[5px] text-[12.5px] text-ink-muted">{subtitle}</p>

          <div className="mt-[26px]">{children}</div>
        </div>
      </main>
    </div>
  );
}

function Mark() {
  return (
    <span
      aria-hidden="true"
      className="flex size-[26px] items-center justify-center rounded-[7px] bg-brand font-mono text-[12px] font-semibold text-white"
    >
      A
    </span>
  );
}

function Check() {
  return (
    <svg viewBox="0 0 12 12" className="size-[9px]" fill="none" aria-hidden="true">
      <path
        d="M2 6.4 4.6 9 10 3"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
