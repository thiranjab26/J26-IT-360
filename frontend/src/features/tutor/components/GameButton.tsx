import type { ButtonHTMLAttributes } from 'react';

import { cx } from '@/shared/components/ui';
import { HeartIcon } from './icons';
import { playCue } from './sound';

type Variant = 'primary' | 'go' | 'secondary' | 'ghost';

interface GameButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  busy?: boolean;
}

/*
 * A chunky button with a solid edge underneath that squashes when pressed. `primary` moves
 * the story on, `go` is for the action that checks or submits your work.
 */
const BASE =
  'inline-flex select-none items-center justify-center gap-[8px] rounded-[12px] px-[22px] py-[11px] ' +
  'text-[13.5px] font-bold tracking-wide uppercase transition-[transform,box-shadow,filter] duration-100 ' +
  'enabled:hover:brightness-110 enabled:active:translate-y-[3px] ' +
  'disabled:cursor-not-allowed disabled:opacity-50';

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-[oklch(0.7_0.19_275)] text-[oklch(0.15_0.05_275)] shadow-[0_4px_0_0_oklch(0.46_0.18_275)] enabled:active:shadow-[0_1px_0_0_oklch(0.46_0.18_275)]',
  go: 'bg-[oklch(0.8_0.2_150)] text-[oklch(0.17_0.06_150)] shadow-[0_4px_0_0_oklch(0.55_0.16_150)] enabled:active:shadow-[0_1px_0_0_oklch(0.55_0.16_150)]',
  secondary:
    'border border-line-strong bg-surface-muted text-ink shadow-[0_4px_0_0_oklch(0.4_0.07_285)] enabled:active:shadow-[0_1px_0_0_oklch(0.4_0.07_285)]',
  ghost: 'text-ink-muted normal-case tracking-normal hover:bg-surface-muted hover:text-ink',
};

export function GameButton({
  variant = 'primary',
  busy = false,
  className,
  children,
  disabled,
  onClick,
  ...rest
}: GameButtonProps) {
  return (
    <button
      className={cx(BASE, VARIANTS[variant], className)}
      disabled={disabled || busy}
      onClick={(event) => {
        playCue('tap');
        onClick?.(event);
      }}
      {...rest}
    >
      {busy && (
        <span
          aria-hidden="true"
          className="size-[13px] animate-spin rounded-full border-[2px] border-current border-t-transparent"
        />
      )}
      {children}
    </button>
  );
}

/** Tries left on a checkpoint, as hearts. A lost heart greys out and shakes once. */
export function Hearts({ total, left }: { total: number; left: number }) {
  return (
    <span
      role="img"
      aria-label={`${left} of ${total} tries left`}
      className="inline-flex items-center gap-[3px]"
    >
      {Array.from({ length: total }, (_, i) => {
        const alive = i < left;
        return (
          <HeartIcon
            key={`${i}-${alive}`}
            className={cx(
              'size-[18px] transition-colors',
              alive ? 'text-[oklch(0.7_0.22_20)] drop-shadow-[0_0_6px_oklch(0.7_0.22_20/0.6)]' : 'animate-shake text-line-strong',
            )}
          />
        );
      })}
    </span>
  );
}
