import type { SVGProps } from 'react';

/**
 * The small set of icons the game layer uses, drawn inline so there is no icon font or
 * extra request. All inherit the text colour (`currentColor`) and size from their parent.
 */
type IconProps = SVGProps<SVGSVGElement>;

function Stroke({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

function Solid({ children, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      {children}
    </svg>
  );
}

export const FlameIcon = (p: IconProps) => (
  <Solid {...p}>
    <path d="M12.2 2c.9 3.4-1.2 5-2.7 7.1C8 11 7 12.6 7 15.2a5 5 0 0 0 10 0c0-2-.8-3.5-2-4.9.1 1.3-.4 2.3-1.4 2.9.9-3.6.7-8.1-1.4-11.2Z" />
  </Solid>
);

export const BoltIcon = (p: IconProps) => (
  <Solid {...p}>
    <path d="M13.2 2 4.5 13.6h5.8L9.4 22l9.1-12.1h-6L13.2 2Z" />
  </Solid>
);

export const StarIcon = (p: IconProps) => (
  <Solid {...p}>
    <path d="m12 2.6 2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.5l-5.9 3.1 1.2-6.5L2.5 9.5l6.6-.9L12 2.6Z" />
  </Solid>
);

export const SparkleIcon = (p: IconProps) => (
  <Solid {...p}>
    <path d="m12 2.5 1.9 5.6 5.6 1.9-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.9L12 2.5ZM19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15Z" />
  </Solid>
);

export const LockIcon = (p: IconProps) => (
  <Stroke {...p}>
    <rect x="5" y="11" width="14" height="9.5" rx="2.2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </Stroke>
);

export const CheckIcon = (p: IconProps) => (
  <Stroke strokeWidth="2.4" {...p}>
    <path d="m5 12.5 4.5 4.5L19 7" />
  </Stroke>
);

export const PlayIcon = (p: IconProps) => (
  <Solid {...p}>
    <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" />
  </Solid>
);

export const TrophyIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M8 4h8v5a4 4 0 0 1-8 0V4Z" />
    <path d="M8 6H5v1.5A2.5 2.5 0 0 0 7.5 10M16 6h3v1.5A2.5 2.5 0 0 1 16.5 10M12 13v3.5M10 16.5h4V20h-4zM8.5 20h7" />
  </Stroke>
);

export const TargetIcon = (p: IconProps) => (
  <Stroke {...p}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="5" />
    <circle cx="12" cy="12" r="1.4" fill="currentColor" />
  </Stroke>
);

export const CalendarIcon = (p: IconProps) => (
  <Stroke {...p}>
    <rect x="4" y="5" width="16" height="15" rx="2.2" />
    <path d="M4 10h16M8 3v4M16 3v4M9 14.5l2 2 4-4" />
  </Stroke>
);

export const BulbIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3ZM10 19h4M10.8 21.5h2.4" />
  </Stroke>
);

export const CrownIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="m3 8 4.5 4L12 5l4.5 7L21 8l-2 11H5L3 8Z" />
  </Stroke>
);

export const DiamondIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M6 3h12l4 6-10 12L2 9l4-6ZM2 9h20M9 3l3 6 3-6M12 9v12" />
  </Stroke>
);

export const ArrowUpIcon = (p: IconProps) => (
  <Stroke strokeWidth="2.2" {...p}>
    <path d="M12 19V5M6 11l6-6 6 6" />
  </Stroke>
);

export const FlagIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M5 21V4M5 4h12l-2 4 2 4H5" />
  </Stroke>
);

export const CoinsIcon = (p: IconProps) => (
  <Stroke {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5v9M9.2 10.3c0-1 1.2-1.8 2.8-1.8s2.8.8 2.8 1.8-1.2 1.6-2.8 1.9-2.8.8-2.8 1.8 1.2 1.8 2.8 1.8 2.8-.8 2.8-1.8" />
  </Stroke>
);

export const ShieldIcon = (p: IconProps) => (
  <Solid {...p}>
    <path d="M12 2 4 5v6c0 5 3.4 8.6 8 10 4.6-1.4 8-5 8-10V5l-8-3Zm-1.2 13.2-3-3 1.4-1.4 1.6 1.6 4-4 1.4 1.4-5.4 5.4Z" />
  </Solid>
);

/** The icon that stands for each badge, by badge id. */
export const BADGE_ICONS: Record<string, (p: IconProps) => React.JSX.Element> = {
  first_steps: FlagIcon,
  sharp_start: TargetIcon,
  flawless: DiamondIcon,
  comeback: ArrowUpIcon,
  concept_master: BulbIcon,
  topic_champion: CrownIcon,
  on_fire: FlameIcon,
  week_warrior: CalendarIcon,
  xp_500: CoinsIcon,
  xp_2000: BoltIcon,
};
