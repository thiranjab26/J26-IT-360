import './break.css';
import { icon, iconButton, type IconName } from './icons.js';
import { MemoryMatchGame, swap } from './memory-match.js';
import { NeckStretchGame } from './neck-stretch.js';
import { Sfx } from './sfx.js';
import type { Pose } from './stretch-session.js';
import { el, soundToggle } from './ui.js';

/**
 * The Break tab: a picker with two short, calm games, and the game host.
 *
 * Both games are demo features, fully offline (no assets are fetched; icons,
 * art and sounds are generated in code). Switching between the picker and a
 * game uses a View Transition where the browser supports it.
 */

export type GameId = 'neck' | 'memory';

export interface BreakPanelOptions {
  /** Turns sensing on (the neck game needs the camera). */
  readonly requestSensing: () => void;
  /** Turns sensing off (the camera light goes out). */
  readonly stopSensing: () => void;
  /** A game was completed: counts as a break for the Wellbeing panel. */
  readonly onBreakTaken: () => void;
  /** The game layout changed (opened, closed, resized): re-place the camera preview. */
  readonly onLayout: () => void;
}

export class BreakPanel {
  readonly element: HTMLElement;
  readonly #sfx = new Sfx();
  readonly #opts: BreakPanelOptions;
  readonly #neck: NeckStretchGame;
  readonly #memory: MemoryMatchGame;
  readonly #picker: HTMLElement;
  readonly #host: HTMLElement;
  #active: GameId | null = null;
  #visible = false;

  constructor(options: BreakPanelOptions) {
    this.#opts = options;
    this.element = el('div', 'break');

    const head = el('header', 'section-head break-head');
    const titles = el('div');
    titles.append(
      el('h2', 'section-title', 'Take a break'),
      el(
        'p',
        'section-sub',
        'Two short, calm games for when you feel tired. A rest for your brain, not a test: no countdowns, no pressure.',
      ),
    );
    head.append(titles, soundToggle(this.#sfx));

    // ── Picker ──
    this.#picker = el('div', 'break-picker');
    this.#picker.append(
      gameCard({
        id: 'neck',
        index: '01',
        title: 'Neck stretch',
        text: 'Steer a glowing orb with your head through eight gentle stretches.',
        meta: [
          ['clock', 'About 90 s'],
          ['camera', 'Uses your camera'],
        ],
        art: neckArt(),
        onPlay: () => {
          this.open('neck');
        },
      }),
      gameCard({
        id: 'memory',
        index: '02',
        title: 'Memory match',
        text: 'Turn over cards and find the pairs. Calm, quick and tidy.',
        meta: [
          ['clock', '2–3 min'],
          ['cameraOff', 'No camera'],
        ],
        art: memoryArt(),
        onPlay: () => {
          this.open('memory');
        },
      }),
    );

    this.#host = el('div', 'break-host');
    this.#host.hidden = true;

    const back = (): void => {
      this.close();
    };
    this.#neck = new NeckStretchGame({
      sfx: this.#sfx,
      requestSensing: options.requestSensing,
      stopSensing: options.stopSensing,
      onFinish: options.onBreakTaken,
      onExit: back,
    });
    this.#memory = new MemoryMatchGame({
      sfx: this.#sfx,
      onFinish: options.onBreakTaken,
      onExit: back,
    });
    // Slot moves when it resizes or anything above it changes height.
    const layout = new ResizeObserver(() => {
      this.#opts.onLayout();
    });
    layout.observe(this.#neck.cameraSlot);
    layout.observe(this.element);

    this.element.append(head, this.#picker, this.#host);
  }

  get active(): GameId | null {
    return this.#active;
  }

  /** The slot for the live camera preview, when the neck game is open and on screen. */
  get cameraSlot(): HTMLElement | null {
    return this.#visible && this.#active === 'neck' ? this.#neck.cameraSlot : null;
  }

  open(game: GameId): void {
    this.#sfx.unlock();
    this.#active = game;
    swap(() => {
      this.#picker.hidden = true;
      this.#host.hidden = false;
      this.#host.replaceChildren(game === 'neck' ? this.#neck.element : this.#memory.element);
      this.element.dataset.game = game;
      this.#opts.onLayout();
    });
    if (game === 'neck') {
      this.#memory.setVisible(false);
      this.#neck.setVisible(this.#visible);
      this.#neck.start();
    } else {
      this.#neck.stop();
      this.#neck.setVisible(false);
      this.#memory.setVisible(this.#visible);
      this.#memory.start();
    }
    this.#opts.onLayout();
  }

  close(): void {
    this.#neck.stop();
    this.#neck.setVisible(false);
    this.#memory.setVisible(false);
    this.#active = null;
    swap(() => {
      this.#host.hidden = true;
      this.#host.replaceChildren();
      this.#picker.hidden = false;
      delete this.element.dataset.game;
      this.#opts.onLayout();
    });
    this.#opts.onLayout();
  }

  /** The Break tab became visible / hidden: games pause while hidden. */
  setVisible(visible: boolean): void {
    this.#visible = visible;
    this.#neck.setVisible(visible && this.#active === 'neck');
    this.#memory.setVisible(visible && this.#active === 'memory');
  }

  setSensing(active: boolean): void {
    this.#neck.setSensing(active);
  }

  /** Head pose for the neck game (absolute degrees), or null when no face. */
  pushPose(tMs: number, pose: Pose | null): void {
    if (this.#active === 'neck') this.#neck.pushPose(tMs, pose);
  }
}

function gameCard(spec: {
  id: GameId;
  index: string;
  title: string;
  text: string;
  meta: readonly (readonly [IconName, string])[];
  art: HTMLElement;
  onPlay: () => void;
}): HTMLElement {
  const card = el('article', `game-card game-card-${spec.id}`);
  const body = el('div', 'game-card-body');
  const top = el('div', 'game-card-top');
  top.append(el('span', 'game-card-index', spec.index), el('h3', 'game-card-title', spec.title));
  const meta = el('div', 'game-card-meta');
  for (const [name, text] of spec.meta) {
    const tag = el('span', 'game-card-tag');
    tag.append(icon(name), el('span', '', text));
    meta.append(tag);
  }
  const play = iconButton('play', 'Play', 'btn btn-primary game-card-play');
  play.dataset.testid = `play-${spec.id}`;
  play.setAttribute('aria-label', `Play ${spec.title}`);
  play.addEventListener('click', spec.onPlay);
  const foot = el('div', 'game-card-foot');
  foot.append(meta, play);
  body.append(top, el('p', 'game-card-text', spec.text), foot);
  card.append(spec.art, body);
  return card;
}

/** CSS-animated preview art: an orb travelling into a target ring. */
function neckArt(): HTMLElement {
  const art = el('div', 'game-art art-neck');
  art.setAttribute('aria-hidden', 'true');
  const badge = el('span', 'art-badge');
  badge.append(icon('neck'));
  art.append(
    el('span', 'art-orbit'),
    el('span', 'art-ring'),
    el('span', 'art-ring art-ring-2'),
    el('span', 'art-orb'),
    badge,
  );
  return art;
}

/** CSS-animated preview art: a small grid of cards flipping in turn. */
function memoryArt(): HTMLElement {
  const art = el('div', 'game-art art-memory');
  art.setAttribute('aria-hidden', 'true');
  const grid = el('div', 'art-cards');
  for (let i = 0; i < 6; i += 1) {
    const c = el('span', 'art-card');
    c.style.setProperty('--i', String(i));
    grid.append(c);
  }
  const badge = el('span', 'art-badge');
  badge.append(icon('cards'));
  art.append(grid, badge);
  return art;
}
