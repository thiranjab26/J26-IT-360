import { MemoryGame } from './memory-game.js';
import { Particles } from './particles.js';
import { icon, iconButton, type IconName } from './icons.js';
import type { Sfx } from './sfx.js';
import { clock, el, gameToolbar, setText, soundToggle } from './ui.js';

/**
 * Memory match: calm card-pairs game. No countdown and no camera.
 *
 * Performance: cards are DOM buttons flipped with CSS 3D transforms (compositor
 * only: no layout or paint per frame); match / deal effects use the Web
 * Animations API; the confetti canvas only animates while particles are alive.
 * Fully keyboard playable (arrow keys + Enter/Space) with screen-reader labels.
 */

/** Card faces: name, colour, 24×24 stroke icon (static constants). */
const FACES: readonly { name: string; colour: string; path: string }[] = [
  {
    name: 'Leaf',
    colour: '#b5e61d',
    path: '<path d="M5 19c0-8 5-14 14-14 0 9-6 14-14 14z"/><path d="M5 19 13 11"/>',
  },
  {
    name: 'Drop',
    colour: '#7cb2ff',
    path: '<path d="M12 3.5c-3 4-5.5 7-5.5 10a5.5 5.5 0 0 0 11 0c0-3-2.5-6-5.5-10z"/>',
  },
  {
    name: 'Sun',
    colour: '#ffbe3d',
    path: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  },
  {
    name: 'Moon',
    colour: '#c9b6ff',
    path: '<path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z"/>',
  },
  {
    name: 'Wave',
    colour: '#4fd1c5',
    path: '<path d="M3 9c3-3 6 3 9 0s6 3 9 0"/><path d="M3 15c3-3 6 3 9 0s6 3 9 0"/>',
  },
  {
    name: 'Star',
    colour: '#ff7a59',
    path: '<path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.8z"/>',
  },
  { name: 'Mountain', colour: '#e8d5a8', path: '<path d="M2.5 19.5 9 8l4 6.5 2.5-3.5 6 8.5z"/>' },
  {
    name: 'Flower',
    colour: '#ff8fb8',
    path: '<circle cx="12" cy="12" r="2.2"/><path d="M12 9.8C10 6 14 6 12 9.8zM14.2 12c3.8-2 3.8 2 0 0zM12 14.2c2 3.8-2 3.8 0 0zM9.8 12c-3.8 2-3.8-2 0 0z"/><path d="M12 5.2a2.6 2.6 0 0 1 0 4.6 2.6 2.6 0 0 1 0-4.6zM18.8 12a2.6 2.6 0 0 1-4.6 0 2.6 2.6 0 0 1 4.6 0zM12 18.8a2.6 2.6 0 0 1 0-4.6 2.6 2.6 0 0 1 0 4.6zM5.2 12a2.6 2.6 0 0 1 4.6 0 2.6 2.6 0 0 1-4.6 0z"/>',
  },
];

export type BoardSize = 'calm' | 'classic';

const SIZES: Record<BoardSize, { pairs: number; cols: number; label: string; icon: IconName }> = {
  calm: { pairs: 6, cols: 4, label: 'Calm · 12', icon: 'grid12' },
  classic: { pairs: 8, cols: 4, label: 'Classic · 16', icon: 'grid' },
};

/** How long a non-pair stays visible before turning back. */
const MISMATCH_MS = 850;
const BEST_KEY = 'adaptlearn.c2.memory.best.';

export interface MemoryMatchOptions {
  readonly sfx: Sfx;
  readonly onFinish: () => void;
  readonly onExit: () => void;
}

interface CardView {
  readonly button: HTMLButtonElement;
  readonly inner: HTMLElement;
}

export class MemoryMatchGame {
  readonly element: HTMLElement;
  readonly #opts: MemoryMatchOptions;
  readonly #grid: HTMLElement;
  readonly #fxCanvas: HTMLCanvasElement;
  readonly #fxCtx: CanvasRenderingContext2D | null;
  readonly #fx = new Particles(['#d4ff3a', '#ff7a59', '#ffbe3d', '#7cb2ff', '#ff8fb8']);
  readonly #live: HTMLElement;
  readonly #ui: {
    moves: HTMLElement;
    pairs: HTMLElement;
    time: HTMLElement;
    best: HTMLElement;
    sizeButtons: Record<BoardSize, HTMLButtonElement>;
    summary: HTMLElement;
    summaryStats: HTMLElement;
    summaryBest: HTMLElement;
  };

  #game = new MemoryGame(SIZES.calm.pairs);
  #size: BoardSize = 'calm';
  #cards: CardView[] = [];
  #mismatchTimer = 0;
  #clock = 0;
  #startedAt: number | null = null;
  #endedAt: number | null = null;
  #visible = false;
  #fxRaf = 0;
  #fxLast = 0;
  #dpr = 1;

  constructor(options: MemoryMatchOptions) {
    this.#opts = options;
    this.element = el('div', 'game mm');

    const seg = el('div', 'segmented gseg');
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-label', 'Board size');
    const sizeButtons = {} as Record<BoardSize, HTMLButtonElement>;
    for (const size of ['calm', 'classic'] as const) {
      const b = iconButton(SIZES[size].icon, SIZES[size].label, 'seg');
      b.addEventListener('click', () => {
        this.#opts.sfx.unlock();
        this.start(size);
      });
      seg.append(b);
      sizeButtons[size] = b;
    }
    const restart = iconButton('shuffle', 'Shuffle', 'gbtn');
    restart.dataset.testid = 'mm-shuffle';
    restart.addEventListener('click', () => {
      this.start(this.#size);
    });
    const bar = gameToolbar(
      'Memory match',
      () => {
        this.#opts.onExit();
      },
      seg,
      restart,
      soundToggle(this.#opts.sfx),
    );

    // Scoreboard strip: separate from the board so nothing ever covers a card.
    const stats = el('div', 'mm-stats');
    const moves = stat(stats, 'moves', 'Moves');
    const pairs = stat(stats, 'pairs', 'Pairs');
    const time = stat(stats, 'timer', 'Time');
    const best = stat(stats, 'trophy', 'Best');
    moves.dataset.testid = 'mm-moves';
    pairs.dataset.testid = 'mm-pairs';

    const stage = el('div', 'game-stage mm-stage');
    this.#grid = el('div', 'mm-grid');
    this.#grid.setAttribute('role', 'group');
    this.#grid.setAttribute('aria-label', 'Cards');
    this.#grid.addEventListener('keydown', (e) => {
      this.#onKey(e);
    });
    this.#fxCanvas = el('canvas', 'mm-fx');
    this.#fxCanvas.setAttribute('aria-hidden', 'true');
    this.#fxCtx = this.#fxCanvas.getContext('2d');

    const summary = el('div', 'game-summary');
    summary.dataset.testid = 'mm-summary';
    const badge = el('div', 'game-summary-badge');
    badge.append(icon('trophy'));
    const summaryStats = el('div', 'game-summary-stats');
    const summaryBest = el('p', 'game-summary-text', '');
    const again = iconButton('shuffle', 'Play again', 'btn btn-primary');
    again.addEventListener('click', () => {
      this.start(this.#size);
    });
    const back = iconButton('back', 'Back to games', 'btn');
    back.addEventListener('click', () => {
      this.#opts.onExit();
    });
    const summaryActions = el('div', 'game-summary-actions');
    summaryActions.append(again, back);
    summary.append(
      badge,
      el('p', 'game-summary-title', 'All pairs found'),
      summaryStats,
      summaryBest,
      summaryActions,
    );

    stage.append(this.#grid, this.#fxCanvas, summary);
    this.#live = el('p', 'visually-hidden');
    this.#live.setAttribute('aria-live', 'polite');

    this.element.append(bar, stats, stage, this.#live);
    this.#ui = { moves, pairs, time, best, sizeButtons, summary, summaryStats, summaryBest };

    new ResizeObserver(() => {
      this.#resizeFx();
    }).observe(stage);
  }

  start(size: BoardSize = this.#size): void {
    this.#size = size;
    window.clearTimeout(this.#mismatchTimer);
    window.clearInterval(this.#clock);
    this.#clock = 0;
    this.#startedAt = null;
    this.#endedAt = null;
    this.#fx.clear();
    this.#game = new MemoryGame(SIZES[size].pairs);
    for (const [s, b] of Object.entries(this.#ui.sizeButtons)) {
      b.setAttribute('aria-pressed', String(s === size));
    }
    this.#ui.summary.hidden = true;
    this.#build();
    this.#renderStats();
  }

  setVisible(visible: boolean): void {
    this.#visible = visible;
    if (!visible) {
      window.clearInterval(this.#clock);
      this.#clock = 0;
    } else if (this.#startedAt !== null && this.#endedAt === null) {
      this.#startClock();
    }
  }

  #build(): void {
    const { cols } = SIZES[this.#size];
    this.#grid.style.setProperty('--cols', String(cols));
    this.#grid.replaceChildren();
    this.#cards = this.#game.cards.map((card, i) => {
      const face = FACES[card.face] ?? FACES[0];
      const button = el('button', 'mm-card');
      button.type = 'button';
      button.dataset.testid = 'mm-card';
      button.dataset.state = 'down';
      button.tabIndex = i === 0 ? 0 : -1;
      button.style.setProperty('--hue', face?.colour ?? '#d4ff3a');
      const inner = el('span', 'mm-inner');
      const back = el('span', 'mm-face mm-back');
      back.append(el('span', 'mm-back-mark'));
      const front = el('span', 'mm-face mm-front');
      front.append(faceIcon(face?.path ?? ''));
      inner.append(back, front);
      button.append(inner);
      button.addEventListener('click', () => {
        this.#flip(i);
      });
      button.addEventListener('focus', () => {
        for (const c of this.#cards) c.button.tabIndex = -1;
        button.tabIndex = 0;
      });
      this.#grid.append(button);
      return { button, inner };
    });
    this.#labelAll();

    // Deal in: staggered rise, compositor-only (transform + opacity).
    if (!reducedMotion()) {
      this.#cards.forEach((c, i) => {
        c.button.animate(
          [
            { transform: 'translateY(18px) scale(0.92)', opacity: 0 },
            { transform: 'none', opacity: 1 },
          ],
          {
            duration: 380,
            delay: i * 26,
            easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
            fill: 'backwards',
          },
        );
      });
    }
  }

  #flip(index: number): void {
    this.#opts.sfx.unlock();
    window.clearTimeout(this.#mismatchTimer);
    const result = this.#game.flip(index);
    if (result.kind === 'ignored') return;
    if (this.#startedAt === null) {
      this.#startedAt = performance.now();
      this.#startClock();
    }

    if (result.kind === 'first') {
      for (const i of result.hidden) this.#setState(i);
      this.#setState(result.index);
      this.#opts.sfx.play('tap');
    } else if (result.kind === 'match') {
      for (const i of result.pair) {
        this.#setState(i);
        this.#pop(i);
      }
      this.#opts.sfx.play('match');
      this.#announce(`${this.#faceName(result.pair[0])}: pair found.`);
      if (result.won) this.#win();
    } else {
      for (const i of result.pair) this.#setState(i);
      this.#opts.sfx.play('tap');
      this.#mismatchTimer = window.setTimeout(() => {
        for (const i of result.pair) this.#shake(i);
        this.#opts.sfx.play('miss');
        const turned = this.#game.hideMismatch();
        for (const i of turned) this.#setState(i);
      }, MISMATCH_MS);
      this.#announce(
        `${this.#faceName(result.pair[0])} and ${this.#faceName(result.pair[1])}: no match.`,
      );
    }
    this.#renderStats();
  }

  #setState(i: number): void {
    const card = this.#game.cards[i];
    const view = this.#cards[i];
    if (!card || !view) return;
    view.button.dataset.state = card.state;
    view.button.setAttribute('aria-label', this.#label(i));
    view.button.setAttribute('aria-disabled', String(card.state === 'matched'));
  }

  #labelAll(): void {
    this.#cards.forEach((_, i) => {
      this.#setState(i);
    });
  }

  #label(i: number): string {
    const card = this.#game.cards[i];
    const n = `Card ${String(i + 1)}`;
    if (!card || card.state === 'down') return `${n}, face down`;
    return `${n}, ${this.#faceName(i)}${card.state === 'matched' ? ', matched' : ''}`;
  }

  #faceName(i: number): string {
    const card = this.#game.cards[i];
    return card ? (FACES[card.face]?.name ?? '') : '';
  }

  #pop(i: number): void {
    const view = this.#cards[i];
    if (!view) return;
    if (!reducedMotion()) {
      view.button.animate(
        [{ transform: 'scale(1)' }, { transform: 'scale(1.07)' }, { transform: 'scale(1)' }],
        { duration: 420, delay: 180, easing: 'cubic-bezier(0.3, 0.7, 0.2, 1.3)' },
      );
    }
    const c = this.#centre(view.button);
    this.#fx.gravity = 0;
    this.#fx.burst(c.x, c.y, 18, 260 * this.#dpr, 6 * this.#dpr, 0.7);
    this.#runFx();
  }

  #shake(i: number): void {
    const view = this.#cards[i];
    if (!view || reducedMotion()) return;
    view.button.animate(
      [
        { transform: 'translateX(0)' },
        { transform: 'translateX(-5px)' },
        { transform: 'translateX(5px)' },
        { transform: 'translateX(-3px)' },
        { transform: 'translateX(0)' },
      ],
      { duration: 320, easing: 'ease-in-out' },
    );
  }

  #win(): void {
    this.#endedAt = performance.now();
    window.clearInterval(this.#clock);
    this.#clock = 0;
    const ms = this.#elapsed();
    const best = readBest(this.#size);
    const moves = this.#game.moves;
    const isBest = !best || moves < best.moves || (moves === best.moves && ms < best.ms);
    if (isBest) writeBest(this.#size, { moves, ms });

    this.#ui.summaryStats.textContent = `${String(moves)} moves · ${clock(ms)}`;
    this.#ui.summaryBest.textContent = isBest
      ? best
        ? 'New personal best on this board.'
        : 'First game on this board: that is your best to beat.'
      : `Your best: ${String(best.moves)} moves · ${clock(best.ms)}.`;

    window.setTimeout(() => {
      // View transition for the summary where supported (Chromium, Firefox 144+).
      swap(() => {
        this.#ui.summary.hidden = false;
      });
      const r = this.#fxCanvas;
      this.#fx.gravity = 700 * this.#dpr;
      for (let k = 0; k < 4; k += 1) {
        this.#fx.burst(
          r.width * (0.2 + 0.2 * k),
          r.height * 0.35,
          30,
          560 * this.#dpr,
          7 * this.#dpr,
          1.6,
        );
      }
      this.#runFx();
      this.#opts.sfx.play('win');
      this.#announce(`All pairs found in ${String(moves)} moves.`);
      this.#opts.onFinish();
    }, 520);
    this.#renderStats();
  }

  #onKey(e: KeyboardEvent): void {
    const i = this.#cards.findIndex((c) => c.button === document.activeElement);
    if (i < 0) return;
    const cols = SIZES[this.#size].cols;
    const n = this.#cards.length;
    const next =
      e.key === 'ArrowRight'
        ? i + 1
        : e.key === 'ArrowLeft'
          ? i - 1
          : e.key === 'ArrowDown'
            ? i + cols
            : e.key === 'ArrowUp'
              ? i - cols
              : e.key === 'Home'
                ? 0
                : e.key === 'End'
                  ? n - 1
                  : -1;
    if (next < 0 || next >= n || next === i) return;
    e.preventDefault();
    this.#cards[next]?.button.focus();
  }

  // ── Clock and stats ──

  #startClock(): void {
    if (this.#clock || !this.#visible) return;
    this.#clock = window.setInterval(() => {
      this.#renderStats();
    }, 250);
  }

  #elapsed(): number {
    if (this.#startedAt === null) return 0;
    return (this.#endedAt ?? performance.now()) - this.#startedAt;
  }

  #renderStats(): void {
    setText(this.#ui.moves, String(this.#game.moves));
    setText(this.#ui.pairs, `${String(this.#game.pairsFound)} / ${String(this.#game.pairs)}`);
    setText(this.#ui.time, clock(this.#elapsed()));
    const best = readBest(this.#size);
    setText(this.#ui.best, best ? `${String(best.moves)} · ${clock(best.ms)}` : '–');
  }

  #announce(text: string): void {
    this.#live.textContent = text;
  }

  // ── Confetti canvas ──

  #resizeFx(): void {
    const rect = this.#fxCanvas.getBoundingClientRect();
    const cores = navigator.hardwareConcurrency || 4;
    this.#dpr = Math.min(window.devicePixelRatio || 1, cores <= 4 ? 1 : 2);
    this.#fxCanvas.width = Math.max(1, Math.round(rect.width * this.#dpr));
    this.#fxCanvas.height = Math.max(1, Math.round(rect.height * this.#dpr));
  }

  #centre(node: HTMLElement): { x: number; y: number } {
    const a = node.getBoundingClientRect();
    const b = this.#fxCanvas.getBoundingClientRect();
    return {
      x: (a.left - b.left + a.width / 2) * this.#dpr,
      y: (a.top - b.top + a.height / 2) * this.#dpr,
    };
  }

  #runFx(): void {
    if (this.#fxRaf || !this.#fxCtx || reducedMotion()) return;
    this.#fxLast = performance.now();
    const tick = (now: number): void => {
      const ctx = this.#fxCtx;
      if (!ctx) return;
      const dt = Math.min(0.05, (now - this.#fxLast) / 1000);
      this.#fxLast = now;
      ctx.clearRect(0, 0, this.#fxCanvas.width, this.#fxCanvas.height);
      this.#fx.step(dt);
      this.#fx.draw(ctx);
      this.#fxRaf = this.#fx.alive > 0 ? requestAnimationFrame(tick) : 0;
      if (!this.#fxRaf) ctx.clearRect(0, 0, this.#fxCanvas.width, this.#fxCanvas.height);
    };
    this.#fxRaf = requestAnimationFrame(tick);
  }
}

/** Runs a DOM change inside a View Transition when the browser supports it. */
export function swap(update: () => void): void {
  if (reducedMotion() || typeof document.startViewTransition !== 'function') {
    update();
    return;
  }
  document.startViewTransition(update);
}

function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function readBest(size: BoardSize): { moves: number; ms: number } | null {
  try {
    const raw = localStorage.getItem(BEST_KEY + size);
    if (!raw) return null;
    const v = JSON.parse(raw) as unknown;
    if (
      typeof v === 'object' &&
      v !== null &&
      'moves' in v &&
      'ms' in v &&
      typeof v.moves === 'number' &&
      typeof v.ms === 'number'
    ) {
      return { moves: v.moves, ms: v.ms };
    }
    return null;
  } catch {
    return null;
  }
}

function writeBest(size: BoardSize, best: { moves: number; ms: number }): void {
  try {
    localStorage.setItem(BEST_KEY + size, JSON.stringify(best));
  } catch {
    // Storage blocked: the best score lasts for this visit only.
  }
}

function stat(parent: HTMLElement, name: IconName, label: string): HTMLElement {
  const box = el('div', 'mm-stat');
  const value = el('span', 'mm-stat-value', '–');
  const text = el('span', 'mm-stat-text');
  text.append(el('span', 'mm-stat-label', label), value);
  box.append(icon(name), text);
  parent.append(box);
  return value;
}

/** Card-face artwork (static constant paths). */
function faceIcon(paths: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.6');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  // Static constant paths only.
  svg.innerHTML = paths;
  return svg;
}
