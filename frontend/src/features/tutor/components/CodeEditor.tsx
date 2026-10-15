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
        'flex overflow-hidden rounded-[10px] border border-line bg-surface font-mono text-[13px]',
        'focus-within:border-brand focus-within:shadow-[var(--shadow-focus)]',
        className,
      )}
    >
      <div
        ref={gutter}
        aria-hidden="true"
        className="w-[46px] shrink-0 overflow-hidden border-r border-line-soft bg-surface-muted py-[12px] pr-[10px] text-right text-ink-faint select-none"
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
        className="min-h-[340px] flex-1 resize-y overflow-auto bg-transparent px-[12px] py-[12px] whitespace-pre text-ink focus:outline-none"
        style={{ lineHeight: `${LINE}px`, tabSize: 4, height: Math.max(340, count * LINE + 24) }}
      />
    </div>
  );
}
