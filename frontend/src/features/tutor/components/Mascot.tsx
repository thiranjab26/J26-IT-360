import { useEffect, useId, useState } from 'react';

import { cx } from '@/shared/components/ui';
import { prefersReducedMotion } from './fx';

export type Mood = 'idle' | 'cheer' | 'oops' | 'think';

const MOTION: Record<Mood, string> = {
  idle: 'animate-bob',
  cheer: 'animate-hop',
  oops: 'animate-shake',
  think: 'animate-bob',
};

const EYE = 'oklch(0.86 0.15 200)';

/**
 * Byte, the study buddy: a small robot drawn inline so it needs no image file. Its face and
 * movement follow the mood, which the session sets from what just happened (a right answer,
 * a miss, a part being prepared).
 */
export function Mascot({ mood = 'idle', size = 72 }: { mood?: Mood; size?: number }) {
  const id = useId().replace(/:/g, '');

  return (
    // Keyed on the mood so a change replays the movement.
    <div key={mood} className={cx('shrink-0', MOTION[mood])} style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden="true" role="img">
        <defs>
          <linearGradient id={`${id}-head`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="oklch(0.78 0.14 275)" />
            <stop offset="100%" stopColor="oklch(0.55 0.21 300)" />
          </linearGradient>
        </defs>

        <ellipse cx="50" cy="94" rx="24" ry="3.5" fill="oklch(0 0 0 / 0.35)" />

        {/* antenna */}
        <line x1="50" y1="12" x2="50" y2="25" stroke="oklch(0.7 0.05 285)" strokeWidth="3" strokeLinecap="round" />
        <circle
          cx="50"
          cy="10"
          r="5"
          fill={mood === 'oops' ? 'oklch(0.72 0.2 30)' : 'oklch(0.85 0.16 85)'}
          className="animate-glow"
        />

        {/* ears */}
        <rect x="8" y="46" width="9" height="18" rx="4" fill="oklch(0.6 0.12 285)" />
        <rect x="83" y="46" width="9" height="18" rx="4" fill="oklch(0.6 0.12 285)" />

        {/* head and face plate */}
        <rect x="15" y="24" width="70" height="62" rx="24" fill={`url(#${id}-head)`} />
        <rect x="15" y="24" width="70" height="62" rx="24" fill="none" stroke="oklch(1 0 0 / 0.25)" strokeWidth="1.5" />
        <rect x="24" y="36" width="52" height="38" rx="15" fill="oklch(0.17 0.04 285)" />

        <Face mood={mood} />

        {mood === 'think' && (
          <g fill="oklch(0.9 0.1 85)" className="animate-twinkle">
            <circle cx="80" cy="18" r="2.4" />
            <circle cx="88" cy="12" r="3" />
            <circle cx="96" cy="5" r="3.6" />
          </g>
        )}
      </svg>
    </div>
  );
}

function Face({ mood }: { mood: Mood }) {
  if (mood === 'cheer') {
    return (
      <g stroke={EYE} strokeWidth="4" strokeLinecap="round" fill="none">
        <path d="M33 55 Q39 45 45 55" />
        <path d="M55 55 Q61 45 67 55" />
        <path d="M41 63 Q50 74 59 63" fill="oklch(0.86 0.15 200 / 0.35)" />
      </g>
    );
  }
  if (mood === 'oops') {
    return (
      <g stroke={EYE} strokeWidth="3.5" strokeLinecap="round" fill="none">
        <path d="M33 45 L46 49" />
        <path d="M67 45 L54 49" />
        <circle cx="40" cy="56" r="3.6" fill={EYE} stroke="none" />
        <circle cx="60" cy="56" r="3.6" fill={EYE} stroke="none" />
        <path d="M42 67 Q46 63 50 67 Q54 71 58 67" />
      </g>
    );
  }
  if (mood === 'think') {
    return (
      <g fill={EYE}>
        <circle cx="42" cy="51" r="5" />
        <circle cx="62" cy="51" r="5" />
        <rect x="44" y="64" width="12" height="3.4" rx="1.7" />
      </g>
    );
  }
  return (
    <g>
      <g fill={EYE} className="animate-blink" style={{ transformBox: 'fill-box', transformOrigin: 'center' }}>
        <circle cx="40" cy="53" r="5" />
        <circle cx="60" cy="53" r="5" />
      </g>
      <path d="M43 64 Q50 69 57 64" stroke={EYE} strokeWidth="3.4" strokeLinecap="round" fill="none" />
    </g>
  );
}

/** Reveals text one letter at a time, so a line from Byte feels spoken. */
export function useTypewriter(text: string, speed = 16): string {
  const [shown, setShown] = useState(() => (prefersReducedMotion() ? text : ''));

  useEffect(() => {
    if (prefersReducedMotion()) {
      setShown(text);
      return;
    }
    setShown('');
    let count = 0;
    const timer = window.setInterval(() => {
      count += 1;
      setShown(text.slice(0, count));
      if (count >= text.length) window.clearInterval(timer);
    }, speed);
    return () => window.clearInterval(timer);
  }, [text, speed]);

  return shown;
}

/** Byte beside a speech bubble. */
export function Companion({
  mood,
  text,
  size = 64,
  className,
}: {
  mood: Mood;
  text: string;
  size?: number;
  className?: string;
}) {
  const spoken = useTypewriter(text);

  return (
    <div className={cx('flex items-center gap-[12px]', className)}>
      <Mascot mood={mood} size={size} />
      <div
        role="status"
        aria-label={text}
        className="relative min-h-[44px] flex-1 rounded-[16px] border border-line bg-surface px-[15px] py-[10px] shadow-[var(--shadow-card)]"
      >
        <span
          aria-hidden="true"
          className="absolute top-1/2 -left-[6px] size-[11px] -translate-y-1/2 rotate-45 border-b border-l border-line bg-surface"
        />
        <p aria-hidden="true" className="relative text-[13.5px] font-medium text-ink">
          {spoken}
          <span className="invisible">{text.slice(spoken.length)}</span>
        </p>
      </div>
    </div>
  );
}
