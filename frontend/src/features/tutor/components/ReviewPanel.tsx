import { useEffect } from 'react';

import { Badge, Card, cx } from '@/shared/components/ui';
import type { HistoryPart } from '../api/sessionApi';
import { GameButton } from './GameButton';
import { Markdown } from './Markdown';
import { Sources } from './SessionCards';

/**
 * Back and forward through the parts already read in this session. Looking back changes
 * nothing: the session stays exactly where it was, and "forward" past the last part returns to
 * where the student was. The left and right arrow keys do the same.
 */
export function PartNav({
  label,
  canBack,
  canForward,
  looking,
  onBack,
  onForward,
}: {
  label: string;
  canBack: boolean;
  canForward: boolean;
  /** True while an earlier part is on screen, so the right button says where it leads. */
  looking: boolean;
  onBack: () => void;
  onForward: () => void;
}) {
  // Arrow keys, unless the student is typing somewhere.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
      ) {
        return;
      }
      if (event.key === 'ArrowLeft' && canBack) onBack();
      if (event.key === 'ArrowRight' && canForward) onForward();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canBack, canForward, onBack, onForward]);

  return (
    <nav
      aria-label="Move between the parts you have read"
      className="flex items-center justify-between gap-[10px]"
    >
      <GameButton
        variant="secondary"
        className="px-[14px] py-[7px] text-[12px]"
        onClick={onBack}
        disabled={!canBack}
        title="Earlier part (left arrow key)"
      >
        <span aria-hidden="true">←</span> Back
      </GameButton>
      <span
        className={cx(
          'font-mono text-[11px]',
          looking ? 'font-semibold text-brand' : 'text-ink-faint',
        )}
      >
        {label}
      </span>
      <GameButton
        variant="secondary"
        className="px-[14px] py-[7px] text-[12px]"
        onClick={onForward}
        disabled={!canForward}
        title={
          canForward ? 'Later part (right arrow key)' : 'You are on the current part. Use Continue.'
        }
      >
        Next <span aria-hidden="true">→</span>
      </GameButton>
    </nav>
  );
}

/** One earlier part, as the student first saw it. Read-only. */
export function PartView({ part, onClose }: { part: HistoryPart; onClose: () => void }) {
  return (
    <Card className="animate-fade-in px-[26px] py-[24px]">
      <div className="flex flex-wrap items-center justify-between gap-[10px]">
        <p className="font-mono text-[10.5px] tracking-wide text-ink-faint uppercase">
          Looking back. Nothing here changes your place.
        </p>
        <GameButton variant="ghost" onClick={onClose} className="px-[12px] py-[5px] text-[12px]">
          Return to where I was
        </GameButton>
      </div>

      <div className="mt-[10px] flex items-start justify-between gap-[12px]">
        <h2 className="text-[19px] font-semibold tracking-tight text-ink">{part.heading}</h2>
        {part.text_source === 'generated' && part.text_check === 'verified' ? (
          <Badge tone="verified" className="shrink-0">
            AI explanation, checked against the course
          </Badge>
        ) : (
          <Badge tone="verified" className="shrink-0">
            Course material
          </Badge>
        )}
      </div>
      <Markdown className="mt-[14px]">{part.text}</Markdown>
      {part.sources && <Sources sources={part.sources} />}
    </Card>
  );
}
