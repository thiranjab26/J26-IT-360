import { useId } from 'react';

import { cx } from '@/shared/components/ui';

interface LevelRingProps {
  level: number;
  /** 0 to 100 through the current level. */
  percent: number;
  size?: number;
  className?: string;
  /** Pulse softly, to draw the eye (used when the student is close to levelling up). */
  glow?: boolean;
}

/** The level number inside a ring that fills as XP builds towards the next level. */
export function LevelRing({ level, percent, size = 40, className, glow = false }: LevelRingProps) {
  const gradient = useId();
  const stroke = Math.max(3, Math.round(size / 11));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.min(100, Math.max(0, percent));

  return (
    <span
      className={cx(
        'relative inline-flex shrink-0 items-center justify-center rounded-full',
        glow && 'animate-pulse-ring',
        className,
      )}
      style={{ width: size, height: size }}
      role="img"
      aria-label={`Level ${level}, ${Math.round(clamped)} percent to the next level`}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <defs>
          <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="oklch(0.62 0.18 265)" />
            <stop offset="100%" stopColor="oklch(0.62 0.2 295)" />
          </linearGradient>
        </defs>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          className="stroke-surface-sunken"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          stroke={`url(#${gradient})`}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped / 100)}
          style={{ transition: 'stroke-dashoffset 0.9s cubic-bezier(0.22, 1, 0.36, 1)' }}
        />
      </svg>
      <span
        className="absolute font-mono font-semibold text-ink"
        style={{ fontSize: Math.round(size * 0.36) }}
      >
        {level}
      </span>
    </span>
  );
}
