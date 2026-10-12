import { NavLink, Outlet } from 'react-router-dom';

import { cx } from '@/shared/components/ui';

/**
 * Section tabs above every signed-in page, so each feature is one click away.
 * Kept out of StudentLayout so features can add a tab without touching the shell.
 */
const SECTIONS = [
  { to: '/dashboard', label: 'Modules' },
  { to: '/curriculum', label: 'Learning path' },
];

export function SectionNav() {
  return (
    <>
      <nav aria-label="Sections" className="-mt-[12px] mb-[24px] flex gap-[4px] border-b border-line">
        {SECTIONS.map((section) => (
          <NavLink
            key={section.to}
            to={section.to}
            className={({ isActive }) =>
              cx(
                '-mb-px border-b-2 px-[12px] py-[8px] text-[13px] transition-colors',
                isActive
                  ? 'border-brand font-medium text-ink'
                  : 'border-transparent text-ink-muted hover:text-ink',
              )
            }
          >
            {section.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </>
  );
}
