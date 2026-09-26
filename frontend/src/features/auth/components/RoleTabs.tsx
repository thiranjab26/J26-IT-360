/** Student / lecturer switch. Which tab is active decides which endpoint runs. */
import { cx } from '@/shared/components/ui';

export type AccountRole = 'student' | 'lecturer';

const ROLES: Array<{ value: AccountRole; label: string; caption: string }> = [
  { value: 'student', label: 'Student', caption: 'Learn and take sessions' },
  { value: 'lecturer', label: 'Lecturer', caption: 'Author and review' },
];

export function RoleTabs({
  value,
  onChange,
  disabled = false,
}: {
  value: AccountRole;
  onChange: (role: AccountRole) => void;
  disabled?: boolean;
}) {
  return (
    <div role="tablist" aria-label="Account type" className="grid grid-cols-2 gap-[8px]">
      {ROLES.map((role) => {
        const active = role.value === value;
        return (
          <button
            key={role.value}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={disabled}
            onClick={() => onChange(role.value)}
            className={cx(
              'rounded-[10px] border px-[13px] py-[10px] text-left transition-colors',
              'disabled:cursor-not-allowed disabled:opacity-60',
              active
                ? 'border-brand bg-brand-wash'
                : 'border-line bg-surface hover:border-line-strong',
            )}
          >
            <span
              className={cx(
                'block text-[13px] font-medium',
                active ? 'text-brand' : 'text-ink',
              )}
            >
              {role.label}
            </span>
            <span className="mt-[1px] block text-[11px] text-ink-faint">{role.caption}</span>
          </button>
        );
      })}
    </div>
  );
}
