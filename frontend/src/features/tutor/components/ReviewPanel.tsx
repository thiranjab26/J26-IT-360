import { useEffect, useState } from 'react';

import { Badge, Button, Card, cx } from '@/shared/components/ui';
import { useSessionHistory, type HistoryPart } from '../api/sessionApi';
import { Markdown } from './Markdown';
import { Sources } from './SessionCards';

/**
 * Look back at the parts already read in this session, without changing anything: the
 * session stays exactly where it was. Parts are shown as the student first saw them.
 */
export function ReviewPanel({
  sessionId,
  onClose,
}: {
  sessionId: string;
  onClose: () => void;
}) {
  const { data, isPending, error } = useSessionHistory(sessionId);
  const [index, setIndex] = useState<number | null>(null);

  // Open on the most recent part, since that is the one people want to look at again.
  useEffect(() => {
    if (data && index === null && data.parts.length > 0) setIndex(data.parts.length - 1);
  }, [data, index]);

  const parts = data?.parts ?? [];
  const part: HistoryPart | undefined = index === null ? undefined : parts[index];

  return (
    <Card className="animate-slide-up px-[26px] py-[24px]">
      <div className="flex flex-wrap items-center justify-between gap-[10px]">
        <p className="font-mono text-[10.5px] tracking-wide text-ink-faint uppercase">
          Looking back{parts.length > 0 && index !== null ? `: part ${index + 1} of ${parts.length}` : ''}
        </p>
        <Button variant="secondary" onClick={onClose} className="px-[13px] py-[6px] text-[12.5px]">
          Back to where I was
        </Button>
      </div>

      {isPending && <p className="mt-[16px] text-[13px] text-ink-muted">Loading earlier parts...</p>}
      {error && (
        <p className="mt-[16px] text-[13px] text-caution-ink">Could not load the earlier parts.</p>
      )}
      {data && parts.length === 0 && (
        <p className="mt-[16px] text-[13px] text-ink-muted">
          Nothing to look back at yet. Earlier parts appear here as you read them.
        </p>
      )}

      {part && (
        <>
          <div className="mt-[14px] flex items-start justify-between gap-[12px]">
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

          <div className="mt-[22px] flex items-center justify-between gap-[10px]">
            <Button
              variant="secondary"
              disabled={index === 0}
              onClick={() => setIndex((i) => Math.max(0, (i ?? 0) - 1))}
            >
              Earlier part
            </Button>
            <div className="flex gap-[5px]" aria-hidden="true">
              {parts.map((_, i) => (
                <span
                  key={i}
                  className={cx(
                    'size-[7px] rounded-full transition-colors',
                    i === index ? 'bg-brand' : 'bg-line-strong',
                  )}
                />
              ))}
            </div>
            <Button
              variant="secondary"
              disabled={index === parts.length - 1}
              onClick={() => setIndex((i) => Math.min(parts.length - 1, (i ?? 0) + 1))}
            >
              Later part
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}
