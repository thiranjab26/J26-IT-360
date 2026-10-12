import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { useAuth } from '@/shared/auth/AuthProvider';
import { Badge, Banner, Button, Card, cx } from '@/shared/components/ui';
import {
  useGraph,
  usePaper,
  useRemoveItem,
  useSaveItem,
  type GraphNode,
  type ItemInput,
  type Paper,
  type StaffItem,
} from '../api/curriculumApi';
import { ErrorCard, PageSkeleton, isStaff } from '../components/common';
import { Stem } from '../components/Stem';
import { moduleIds, moduleName } from '../lib/modules';
import { STATUS_TONE, errorMessage } from './QuestionsPage';

const EMPTY: ItemInput = {
  concept_id: '',
  section: 'main',
  stem: '',
  options: ['', '', '', ''],
  answer_index: 0,
  twin_item_id: null,
};

/** One paper with its answers. Only drafts can change; removing from a draft retires the item. */
export function PaperEditorPage() {
  const { moduleId = '', paperId = '' } = useParams<{ moduleId: string; paperId: string }>();
  const { user } = useAuth();
  const paper = usePaper(paperId);
  const graph = useGraph();

  if (!isStaff(user?.role)) {
    return (
      <Card className="px-[20px] py-[18px]">
        <p className="text-[13px] text-ink-muted">This page is for lecturers.</p>
      </Card>
    );
  }
  if (paper.error) return <ErrorCard error={paper.error} what="this paper" />;
  if (!paper.data || !graph.data) return <PageSkeleton />;

  return <Editor moduleId={moduleId} paper={paper.data} nodes={graph.data.nodes} />;
}

function Editor({ moduleId, paper, nodes }: { moduleId: string; paper: Paper; nodes: GraphNode[] }) {
  const [adding, setAdding] = useState(false);
  const draft = paper.status === 'draft';
  const items = [...paper.items].sort((a, b) => a.position - b.position);
  const names = new Map(nodes.map((n) => [n.concept_id, n.name]));

  return (
    <div className="mx-auto flex max-w-[860px] flex-col gap-[18px]">
      <header>
        <Link
          to={`/curriculum/${moduleId}/questions`}
          className="font-mono text-[11px] text-ink-faint hover:text-brand"
        >
          ← All papers
        </Link>
        <div className="mt-[10px] flex flex-wrap items-center gap-[8px]">
          <h1 className="text-[21px] font-semibold tracking-tight text-ink">{paper.title}</h1>
          <Badge tone={STATUS_TONE[paper.status]}>{paper.status}</Badge>
          <Badge>v{paper.version}</Badge>
        </div>
        <p className="mt-[4px] font-mono text-[11px] text-ink-faint">
          {paper.paper_id} · {paper.main_items} main
          {paper.prereq_items ? ` + ${paper.prereq_items} background` : ''}
        </p>
      </header>

      {!draft && (
        <Banner
          message={
            paper.status === 'locked'
              ? 'Locked: learners have taken this paper, so it can never change. Use "New version" on the papers page.'
              : 'Published: read only. Use "New version" on the papers page to make changes.'
          }
        />
      )}

      {items.map((item) => (
        <ItemCard
          key={item.item_id}
          moduleId={moduleId}
          paperId={paper.paper_id}
          item={item}
          editable={draft}
          nodes={nodes}
          conceptName={names.get(item.concept_id) ?? item.concept_id}
        />
      ))}

      {draft &&
        (adding ? (
          <ItemForm
            moduleId={moduleId}
            paperId={paper.paper_id}
            itemId={null}
            initial={EMPTY}
            nodes={nodes}
            onDone={() => setAdding(false)}
          />
        ) : (
          <div>
            <Button variant="secondary" onClick={() => setAdding(true)}>
              Add question
            </Button>
          </div>
        ))}
    </div>
  );
}

function ItemCard({
  moduleId,
  paperId,
  item,
  editable,
  nodes,
  conceptName,
}: {
  moduleId: string;
  paperId: string;
  item: StaffItem;
  editable: boolean;
  nodes: GraphNode[];
  conceptName: string;
}) {
  const [editing, setEditing] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const remove = useRemoveItem(moduleId, paperId);

  if (editing) {
    return (
      <ItemForm
        moduleId={moduleId}
        paperId={paperId}
        itemId={item.item_id}
        initial={item}
        nodes={nodes}
        onDone={() => setEditing(false)}
      />
    );
  }

  return (
    <Card className="px-[18px] py-[14px]">
      <div className="mb-[8px] flex flex-wrap items-center justify-between gap-[8px]">
        <div className="flex flex-wrap items-center gap-[6px]">
          <span className="font-mono text-[11.5px] text-ink-faint">{item.position}.</span>
          <Badge tone={item.section === 'prereq' ? 'caution' : 'neutral'}>
            {item.section === 'prereq' ? 'background' : 'main'}
          </Badge>
          <Badge>{conceptName}</Badge>
          {item.twin_item_id && (
            <span className="font-mono text-[10.5px] text-ink-faint">twin {item.twin_item_id}</span>
          )}
        </div>
        {editable && (
          <div className="flex items-center gap-[6px]">
            {confirmRemove ? (
              <>
                <span className="text-[12px] text-caution-ink">Remove this question?</span>
                <Button variant="ghost" onClick={() => setConfirmRemove(false)}>
                  No
                </Button>
                <Button busy={remove.isPending} onClick={() => remove.mutate(item.item_id)}>
                  Remove
                </Button>
              </>
            ) : (
              <>
                <Button variant="ghost" onClick={() => setEditing(true)}>
                  Edit
                </Button>
                <Button variant="ghost" onClick={() => setConfirmRemove(true)}>
                  Remove
                </Button>
              </>
            )}
          </div>
        )}
      </div>
      <Stem text={item.stem} />
      <ol className="mt-[10px] flex flex-col gap-[4px]">
        {item.options.map((option, index) => (
          <li
            key={index}
            className={cx(
              'rounded-[6px] px-[10px] py-[6px] text-[12.5px]',
              index === item.answer_index
                ? 'border border-verified-line bg-verified-wash text-verified-ink'
                : 'text-ink-soft',
            )}
          >
            {String.fromCharCode(65 + index)}. {option}
          </li>
        ))}
      </ol>
      {remove.error && (
        <div className="mt-[8px]">
          <Banner message={errorMessage(remove.error)} />
        </div>
      )}
    </Card>
  );
}

function ItemForm({
  moduleId,
  paperId,
  itemId,
  initial,
  nodes,
  onDone,
}: {
  moduleId: string;
  paperId: string;
  itemId: string | null;
  initial: ItemInput;
  nodes: GraphNode[];
  onDone: () => void;
}) {
  const [form, setForm] = useState<ItemInput>({
    concept_id: initial.concept_id,
    section: initial.section,
    stem: initial.stem,
    options: [...initial.options],
    answer_index: initial.answer_index,
    twin_item_id: initial.twin_item_id,
  });
  const save = useSaveItem(moduleId, paperId);
  const set = (patch: Partial<ItemInput>) => setForm((f) => ({ ...f, ...patch }));

  function setOption(index: number, value: string) {
    set({ options: form.options.map((o, i) => (i === index ? value : o)) });
  }
  function removeOption(index: number) {
    const options = form.options.filter((_, i) => i !== index);
    const answer =
      form.answer_index === index ? 0 : form.answer_index > index ? form.answer_index - 1 : form.answer_index;
    set({ options, answer_index: answer });
  }

  const valid =
    form.concept_id !== '' &&
    form.stem.trim() !== '' &&
    form.options.length >= 2 &&
    form.options.every((o) => o.trim() !== '');

  function submit() {
    save.mutate(
      {
        itemId,
        item: {
          ...form,
          stem: form.stem.trim(),
          options: form.options.map((o) => o.trim()),
          twin_item_id: form.twin_item_id?.trim() || null,
        },
      },
      { onSuccess: onDone },
    );
  }

  const label = 'text-[12px] font-medium text-ink-soft';
  const input =
    'rounded-[8px] border border-line bg-surface px-[10px] py-[8px] text-[13px] text-ink focus:border-brand focus:outline-none';

  return (
    <Card className="flex flex-col gap-[12px] border-brand-soft px-[18px] py-[16px]">
      <div className="grid gap-[10px] sm:grid-cols-[1fr_160px]">
        <label className="flex flex-col gap-[5px]">
          <span className={label}>Concept</span>
          <select
            className={input}
            value={form.concept_id}
            onChange={(e) => set({ concept_id: e.target.value })}
          >
            <option value="">Choose a concept</option>
            {moduleIds(nodes).map((m) => (
              <optgroup key={m} label={moduleName(m)}>
                {nodes
                  .filter((n) => n.module_id === m)
                  .sort((a, b) => a.position - b.position)
                  .map((n) => (
                    <option key={n.concept_id} value={n.concept_id}>
                      {n.name}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-[5px]">
          <span className={label}>Section</span>
          <select
            className={input}
            value={form.section}
            onChange={(e) => set({ section: e.target.value as ItemInput['section'] })}
          >
            <option value="main">Main (counts for gain)</option>
            <option value="prereq">Background (start only)</option>
          </select>
        </label>
      </div>

      <label className="flex flex-col gap-[5px]">
        <span className={label}>Question</span>
        <textarea
          className={cx(input, 'min-h-[110px] font-mono text-[12.5px]')}
          value={form.stem}
          onChange={(e) => set({ stem: e.target.value })}
          placeholder="Leave a blank line before a code block; indent code lines."
        />
      </label>

      <fieldset className="flex flex-col gap-[6px]">
        <legend className={cx(label, 'mb-[5px]')}>Options (select the right one)</legend>
        {form.options.map((option, index) => (
          <div key={index} className="flex items-center gap-[8px]">
            <input
              type="radio"
              name="answer"
              aria-label={`Option ${String.fromCharCode(65 + index)} is right`}
              checked={form.answer_index === index}
              onChange={() => set({ answer_index: index })}
              className="accent-brand"
            />
            <input
              className={cx(input, 'flex-1')}
              value={option}
              onChange={(e) => setOption(index, e.target.value)}
              placeholder={`Option ${String.fromCharCode(65 + index)}`}
            />
            {form.options.length > 2 && (
              <Button variant="ghost" onClick={() => removeOption(index)} aria-label="Remove option">
                ×
              </Button>
            )}
          </div>
        ))}
        {form.options.length < 6 && (
          <div>
            <Button variant="ghost" onClick={() => set({ options: [...form.options, ''] })}>
              Add option
            </Button>
          </div>
        )}
      </fieldset>

      <label className="flex flex-col gap-[5px] sm:max-w-[280px]">
        <span className={label}>Twin question id (other form)</span>
        <input
          className={cx(input, 'font-mono')}
          value={form.twin_item_id ?? ''}
          onChange={(e) => set({ twin_item_id: e.target.value })}
          placeholder="e.g. dsa-B-01"
        />
      </label>

      {save.error && <Banner message={errorMessage(save.error)} />}

      <div className="flex gap-[8px]">
        <Button busy={save.isPending} disabled={!valid} onClick={submit}>
          {itemId ? 'Save question' : 'Add question'}
        </Button>
        <Button variant="secondary" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}
