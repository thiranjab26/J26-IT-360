import {
  BLOCK_EXTRA_ITEMS,
  SUS_ITEMS,
  TLX_ITEMS,
  TLX_STEP,
  type BlockExtraAnswers,
  type ScaleItem,
  type TlxAnswers,
} from '../core/recorder/index.js';

/**
 * NASA-TLX + extra items, and SUS, as plain DOM forms (TODO B1, NFR3).
 * Every item must be answered: a slider counts as answered only once the
 * participant has moved or clicked it, so an untouched default is never stored.
 */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

interface ScaleControl {
  readonly element: HTMLElement;
  readonly value: () => number | null;
}

function scale(item: ScaleItem): ScaleControl {
  const wrap = el('fieldset', undefined, 'scale');
  const legend = el('legend');
  legend.append(el('strong', item.label), el('span', ` ${item.question}`));
  const input = el('input');
  input.type = 'range';
  input.min = '0';
  input.max = '100';
  input.step = String(TLX_STEP);
  input.value = '50';
  input.setAttribute('aria-label', item.label);
  input.dataset.untouched = 'true';
  const shown = el('output', '—');
  const mark = (): void => {
    delete input.dataset.untouched;
    shown.textContent = input.value;
  };
  input.addEventListener('input', mark);
  input.addEventListener('pointerdown', mark);
  input.addEventListener('keydown', mark);
  const ends = el('div', undefined, 'scale-ends');
  ends.append(el('span', item.low), shown, el('span', item.high));
  wrap.append(legend, input, ends);
  return {
    element: wrap,
    value: () => (input.dataset.untouched ? null : Number(input.value)),
  };
}

export function tlxForm(
  title: string,
  onSubmit: (tlx: TlxAnswers, extra: BlockExtraAnswers) => void,
): HTMLElement {
  const form = el('form', undefined, 'card');
  const tlx = TLX_ITEMS.map((item) => ({ id: item.id, control: scale(item) }));
  const extra = BLOCK_EXTRA_ITEMS.map((item) => ({ id: item.id, control: scale(item) }));
  const error = el('p', '', 'error');
  const submit = el('button', 'Continue', 'btn btn-primary');
  submit.type = 'submit';
  form.append(
    el('h2', `About ${title}`),
    el('p', 'Move each slider to your answer. There are no right or wrong answers.', 'hint'),
    ...tlx.map((t) => t.control.element),
    el('h3', 'Two more questions'),
    ...extra.map((t) => t.control.element),
    error,
    submit,
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const all = [...tlx, ...extra].map((t) => [t.id, t.control.value()] as const);
    if (all.some(([, v]) => v === null)) {
      error.textContent = 'Please answer every question (move each slider).';
      return;
    }
    const answers = Object.fromEntries(all) as Record<string, number>;
    onSubmit(answers as unknown as TlxAnswers, answers as unknown as BlockExtraAnswers);
  });
  return form;
}

export function susForm(onSubmit: (answers: number[]) => void): HTMLElement {
  const form = el('form', undefined, 'card');
  const labels = ['Strongly disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly agree'];
  const groups = SUS_ITEMS.map((text, i) => {
    const set = el('fieldset', undefined, 'sus-item');
    set.append(el('legend', `${String(i + 1)}. ${text}`));
    const row = el('div', undefined, 'sus-options');
    labels.forEach((label, k) => {
      const opt = el('label');
      const radio = el('input');
      radio.type = 'radio';
      radio.name = `sus-${String(i)}`;
      radio.value = String(k + 1);
      opt.append(radio, el('span', label));
      row.append(opt);
    });
    set.append(row);
    return set;
  });
  const error = el('p', '', 'error');
  const submit = el('button', 'Finish', 'btn btn-primary');
  submit.type = 'submit';
  form.append(
    el('h2', 'About the system you used today'),
    el('p', 'Pick one answer per statement.', 'hint'),
    ...groups,
    error,
    submit,
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const answers = SUS_ITEMS.map((_, i) => {
      const checked = form.querySelector<HTMLInputElement>(
        `input[name="sus-${String(i)}"]:checked`,
      );
      return checked ? Number(checked.value) : null;
    });
    if (answers.some((a) => a === null)) {
      error.textContent = 'Please answer every statement.';
      return;
    }
    onSubmit(answers as number[]);
  });
  return form;
}
