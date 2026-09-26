/**
 * Shared UI primitives, styled to the VeriTutor mockups.
 *
 * Kept in one file while the set is small: five primitives in one place is
 * easier to keep visually consistent than five files. Split them out when the
 * file stops fitting on a screen.
 */
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import { forwardRef, useId } from 'react';

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/* ------------------------------------------------------------------ Button */

type ButtonVariant = 'primary' | 'secondary' | 'ghost';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** Renders a spinner and blocks input, for in-flight form submissions. */
  busy?: boolean;
}

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-2 rounded-[8px] px-[18px] py-[10px] ' +
  'text-[13.5px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-55';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-brand text-white hover:bg-brand-hover',
  secondary:
    'border border-line bg-surface text-ink-soft hover:border-line-strong hover:text-ink',
  ghost: 'text-ink-muted hover:bg-surface-muted hover:text-ink',
};

export function Button({
  variant = 'primary',
  busy = false,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={cx(BUTTON_BASE, BUTTON_VARIANTS[variant], className)}
      disabled={disabled || busy}
      {...rest}
    >
      {busy && <Spinner />}
      {children}
    </button>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="size-[13px] animate-spin rounded-full border-[1.5px] border-current border-t-transparent"
    />
  );
}

/* ------------------------------------------------------------------- Field */

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  /** Field-level message from the API, shown under the input. */
  error?: string | null;
  hint?: string;
}

export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  { label, error, hint, className, id, ...rest },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;

  return (
    <div className="flex flex-col gap-[6px]">
      <label htmlFor={inputId} className="text-[12px] font-medium text-ink-soft">
        {label}
      </label>
      <input
        ref={ref}
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cx(
          'rounded-[8px] border bg-surface px-[12px] py-[9px] text-[13.5px] text-ink',
          'placeholder:text-ink-faint focus:outline-none',
          error ? 'border-caution-ink' : 'border-line',
          className,
        )}
        {...rest}
      />
      {error ? (
        <p id={`${inputId}-error`} className="text-[11.5px] text-caution-ink">
          {error}
        </p>
      ) : hint ? (
        <p id={`${inputId}-hint`} className="text-[11.5px] text-ink-faint">
          {hint}
        </p>
      ) : null}
    </div>
  );
});

/* -------------------------------------------------------------------- Card */

export function Card({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cx(
        'rounded-[14px] border border-line bg-surface shadow-[var(--shadow-card)]',
        className,
      )}
    >
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------- Badge */

type BadgeTone = 'neutral' | 'brand' | 'verified' | 'caution';

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: 'border-line bg-surface-muted text-ink-muted',
  brand: 'border-brand-soft bg-brand-wash text-brand',
  verified: 'border-verified-line bg-verified-wash text-verified-ink',
  caution: 'border-caution-line bg-caution-wash text-caution-ink',
};

export function Badge({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-[5px] rounded-full border px-[9px] py-[3px]',
        'font-mono text-[10.5px] tracking-tight',
        BADGE_TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ Banner */

export function Banner({ code, message }: { code?: string; message: string }) {
  return (
    <div
      role="alert"
      className="rounded-[8px] border border-caution-line bg-caution-wash px-[12px] py-[9px]"
    >
      <p className="text-[12.5px] text-caution-ink">{message}</p>
      {code && <p className="mt-[2px] font-mono text-[10.5px] text-ink-faint">{code}</p>}
    </div>
  );
}
