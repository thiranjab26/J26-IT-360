/**
 * Memory-match game logic: pure, no DOM, deterministic with a seeded RNG.
 *
 * Standard rules: flip two cards; a pair stays face up, a non-pair turns back.
 * Flipping a third card while a non-pair is still showing turns that pair back
 * at once, so a quick player is never blocked by an animation delay.
 */

export type CardState = 'down' | 'up' | 'matched';

export interface Card {
  readonly id: number;
  /** Pair key: two cards share each face. */
  readonly face: number;
  state: CardState;
}

export type FlipResult =
  | { readonly kind: 'ignored' }
  | { readonly kind: 'first'; readonly index: number; readonly hidden: readonly number[] }
  | { readonly kind: 'match'; readonly pair: readonly [number, number]; readonly won: boolean }
  | { readonly kind: 'mismatch'; readonly pair: readonly [number, number] };

export class MemoryGame {
  readonly cards: Card[];
  #open: number[] = [];
  #moves = 0;
  #matched = 0;

  constructor(pairs: number, random: () => number = Math.random) {
    if (pairs < 2) throw new Error('Memory match needs at least two pairs');
    const faces: number[] = [];
    for (let f = 0; f < pairs; f += 1) faces.push(f, f);
    shuffle(faces, random);
    this.cards = faces.map((face, id) => ({ id, face, state: 'down' }));
  }

  get moves(): number {
    return this.#moves;
  }

  get pairsFound(): number {
    return this.#matched;
  }

  get pairs(): number {
    return this.cards.length / 2;
  }

  get won(): boolean {
    return this.#matched === this.pairs;
  }

  /** Indexes of an unmatched pair still face up (waiting to turn back). */
  get pendingMismatch(): readonly number[] {
    return this.#open.length === 2 ? [...this.#open] : [];
  }

  flip(index: number): FlipResult {
    const card = this.cards[index];
    if (!card || this.won) return { kind: 'ignored' };
    // Clicking a card of the non-pair that is still showing makes it the new
    // first pick (the other one turns back), instead of being ignored.
    const inMismatch = this.#open.length === 2 && this.#open.includes(index);
    if (card.state !== 'down' && !inMismatch) return { kind: 'ignored' };

    // A non-pair is still showing: turn it back first.
    const hidden = this.#open.length === 2 ? this.hideMismatch() : [];

    card.state = 'up';
    this.#open.push(index);
    if (this.#open.length === 1) return { kind: 'first', index, hidden };

    this.#moves += 1;
    const [a, b] = this.#open as [number, number];
    const ca = this.cards[a];
    const cb = this.cards[b];
    if (ca && ca.face === cb?.face) {
      cb.state = 'matched';
      ca.state = 'matched';
      this.#open = [];
      this.#matched += 1;
      return { kind: 'match', pair: [a, b], won: this.won };
    }
    return { kind: 'mismatch', pair: [a, b] };
  }

  /** Turns a showing non-pair face down; returns the indexes that turned. */
  hideMismatch(): number[] {
    if (this.#open.length !== 2) return [];
    const turned = [...this.#open];
    for (const i of turned) {
      const c = this.cards[i];
      if (c?.state === 'up') c.state = 'down';
    }
    this.#open = [];
    return turned;
  }
}

/** Fisher–Yates, in place. */
export function shuffle(items: unknown[], random: () => number): void {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const a = items[i];
    const b = items[j];
    if (a === undefined || b === undefined) continue;
    items[i] = b;
    items[j] = a;
  }
}

/** Small seeded PRNG (mulberry32) for reproducible tests. */
export function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
