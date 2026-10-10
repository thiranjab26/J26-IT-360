import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { cx } from '@/shared/components/ui';

/**
 * Course text is authored in Markdown: prose, lists, tables and Java in code fences.
 * Rendered with the app's own type scale. react-markdown does not render raw HTML in
 * the source, so text written by a model cannot inject markup.
 */
const components: Components = {
  p: ({ children }) => <p className="leading-[1.7]">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-ink">{children}</strong>,
  ul: ({ children }) => <ul className="list-disc space-y-[4px] pl-[20px]">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal space-y-[4px] pl-[20px]">{children}</ol>,
  h1: ({ children }) => <h3 className="text-[15px] font-semibold text-ink">{children}</h3>,
  h2: ({ children }) => <h3 className="text-[15px] font-semibold text-ink">{children}</h3>,
  h3: ({ children }) => <h4 className="text-[14px] font-semibold text-ink">{children}</h4>,
  h4: ({ children }) => <h4 className="text-[13.5px] font-semibold text-ink">{children}</h4>,
  table: ({ children }) => (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[12.5px]">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-line bg-surface-muted px-[10px] py-[6px] text-left font-medium">
      {children}
    </th>
  ),
  td: ({ children }) => <td className="border border-line px-[10px] py-[6px]">{children}</td>,
  pre: ({ children }) => (
    <pre className="overflow-x-auto rounded-[10px] border border-line bg-surface-muted px-[14px] py-[12px] font-mono text-[12.5px] leading-[1.6] text-ink">
      {children}
    </pre>
  ),
  code: ({ className, children }) => {
    // Block code arrives with a language class (or newlines); inline code has neither.
    const block = Boolean(className) || String(children).includes('\n');
    return block ? (
      <code className={className}>{children}</code>
    ) : (
      <code className="rounded-[5px] bg-surface-sunken px-[5px] py-[1px] font-mono text-[12px] text-ink">
        {children}
      </code>
    );
  },
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noreferrer" className="text-brand underline">
      {children}
    </a>
  ),
};

export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cx('flex flex-col gap-[12px] text-[13.5px] text-ink-soft', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
