const CODE_LINE = /^\s{2,}|[;{}]\s*$/;

/** Plain-text question: blank lines split paragraphs; code-like blocks render monospaced. */
export function Stem({ text }: { text: string }) {
  const blocks = text.split(/\n\s*\n/);
  return (
    <div className="flex min-w-0 flex-col gap-[8px]">
      {blocks.map((block, index) =>
        block.split('\n').some((line) => CODE_LINE.test(line)) ? (
          <pre
            key={index}
            className="overflow-x-auto rounded-[8px] bg-surface-sunken px-[12px] py-[9px] font-mono text-[12px] leading-[1.6] text-ink"
          >
            {block}
          </pre>
        ) : (
          <p key={index} className="whitespace-pre-wrap text-[13.5px] leading-[1.6] text-ink">
            {block}
          </p>
        ),
      )}
    </div>
  );
}
