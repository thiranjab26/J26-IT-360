import { iconButton, setIconButton } from './icons.js';
import type { Sfx } from './sfx.js';

/** Small DOM helpers shared by the Break games. */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function setText(node: HTMLElement, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

/** m:ss */
export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60))}:${String(s % 60).padStart(2, '0')}`;
}

/** Icon-only mute switch, kept in sync with every other toggle on the page. */
export function soundToggle(sfx: Sfx): HTMLButtonElement {
  const b = iconButton(sfx.muted ? 'mute' : 'sound', '', 'gbtn', true);
  b.dataset.testid = 'sound-toggle';
  const render = (muted: boolean): void => {
    setIconButton(b, muted ? 'mute' : 'sound', muted ? 'Sound off' : 'Sound on');
    b.setAttribute('aria-pressed', String(!muted));
  };
  render(sfx.muted);
  b.addEventListener('click', () => {
    sfx.muted = !sfx.muted;
    sfx.unlock();
  });
  sfx.onChange(render);
  return b;
}

/**
 * Game toolbar: back to the picker, game title, then the given controls.
 * Lives above the play area, never on top of it.
 */
export function gameToolbar(
  title: string,
  onBack: () => void,
  ...controls: HTMLElement[]
): HTMLElement {
  const bar = el('div', 'gbar');
  const back = iconButton('back', 'Games', 'gbtn gbtn-ghost');
  back.dataset.testid = 'game-back';
  back.addEventListener('click', onBack);
  const name = el('h3', 'gbar-title', title);
  const right = el('div', 'gbar-controls');
  right.append(...controls);
  bar.append(back, name, right);
  return bar;
}
