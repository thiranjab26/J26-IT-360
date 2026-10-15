import { useRef } from 'react';

import { cx } from '@/shared/components/ui';

const LINE = 21; // px. The gutter and the text share it, which is what keeps the numbers aligned.

/**
 * A small code editor: monospace, line numbers, Tab inserts four spaces, Ctrl or Cmd plus Enter
 * runs. It is a text box, not a full editor, which is all a first-year practical needs and keeps
 * the page light.
 */
export function CodeEditor({
  value,
  onChange,
  onRun,
  disabled = false,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  onRun?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  const gutter = useRef<HTMLDivElement>(null);
  const count = Math.max(value.split('\n').length, 16);

  return (
    <div
      className={cx(
        'overflow-hidden rounded-[14px] border-2 border-line bg-[oklch(0.14_0.03_285)] font-mono text-[13px]',
        'shadow-[var(--shadow-card)] focus-within:border-brand focus-within:shadow-[var(--shadow-focus)]',
        className,
      )}
    >
      <div className="flex items-center gap-[7px] border-b border-line bg-surface px-[12px] py-[7px]">
        <span className="size-[10px] rounded-full bg-[oklch(0.7_0.2_25)]" />
        <span className="size-[10px] rounded-full bg-[oklch(0.82_0.16_85)]" />
        <span className="size-[10px] rounded-full bg-[oklch(0.75_0.18_150)]" />
        <span className="ml-[8px] text-[11.5px] text-ink-muted">Main.java</span>
        <span className="ml-auto text-[10.5px] text-ink-faint">Ctrl+Enter to run</span>
      </div>
      <div className="flex">
      <div
        ref={gutter}
        aria-hidden="true"
        className="w-[46px] shrink-0 overflow-hidden border-r border-line-soft bg-[oklch(0.17_0.035_285)] py-[12px] pr-[10px] text-right text-ink-faint select-none"
        style={{ lineHeight: `${LINE}px` }}
      >
        {Array.from({ length: count }, (_, i) => (
          <div key={i}>{i + 1}</div>
        ))}
      </div>
      <textarea
        value={value}
        disabled={disabled}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        wrap="off"
        aria-label="Your Java program"
        onChange={(event) => onChange(event.target.value)}
        onScroll={(event) => {
          if (gutter.current) gutter.current.scrollTop = event.currentTarget.scrollTop;
        }}
        onKeyDown={(event) => {
          if (event.key === 'Tab') {
            event.preventDefault();
            const box = event.currentTarget;
            const { selectionStart: start, selectionEnd: end } = box;
            onChange(value.slice(0, start) + '    ' + value.slice(end));
            requestAnimationFrame(() => {
              box.selectionStart = box.selectionEnd = start + 4;
            });
          } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            onRun?.();
          }
        }}
        className="min-h-[340px] flex-1 resize-y overflow-auto bg-transparent px-[12px] py-[12px] whitespace-pre text-[oklch(0.92_0.04_150)] caret-[oklch(0.85_0.17_150)] focus:outline-none"
        style={{ lineHeight: `${LINE}px`, tabSize: 4, height: Math.max(340, count * LINE + 24) }}
      />
      </div>
    </div>
  );
}
