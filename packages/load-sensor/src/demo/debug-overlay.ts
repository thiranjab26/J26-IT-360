import { LANDMARK_COUNT, LANDMARK_STRIDE, type FaceResult } from '../core/landmarks/index.js';

/** First iris landmark: points 468–477 are the two irises (5 each) added by refinement. */
const FIRST_IRIS_INDEX = 468;

/**
 * Draws landmark points on a transparent canvas laid over the live <video>.
 *
 * Only the 478 points are drawn; the canvas never receives camera pixels, so
 * there is nothing on it that could be exported (invariant 1).
 */
export class LandmarkOverlay {
  readonly #canvas: HTMLCanvasElement;
  readonly #ctx: CanvasRenderingContext2D;

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas is not available');
    this.#canvas = canvas;
    this.#ctx = ctx;
  }

  draw(face: FaceResult | null, width: number, height: number): void {
    if (this.#canvas.width !== width || this.#canvas.height !== height) {
      this.#canvas.width = width;
      this.#canvas.height = height;
    }
    const ctx = this.#ctx;
    ctx.clearRect(0, 0, width, height);
    if (!face) return;

    const { landmarks } = face;
    const r = Math.max(1, Math.round(width / 400));
    for (let i = 0; i < LANDMARK_COUNT; i += 1) {
      const o = i * LANDMARK_STRIDE;
      const x = (landmarks[o] ?? 0) * width;
      const y = (landmarks[o + 1] ?? 0) * height;
      ctx.fillStyle = i >= FIRST_IRIS_INDEX ? '#ff3b6b' : '#28e0a0';
      ctx.fillRect(x - r / 2, y - r / 2, r, r);
    }
  }

  clear(): void {
    this.#ctx.clearRect(0, 0, this.#canvas.width, this.#canvas.height);
  }
}

/** A labelled read-out in the debug panel. `testId` is used by the e2e tests. */
export class StatsPanel {
  readonly #values = new Map<string, HTMLElement>();

  constructor(
    container: HTMLElement,
    rows: readonly { readonly testId: string; readonly label: string }[],
  ) {
    const list = document.createElement('dl');
    list.className = 'stats';
    for (const { testId, label } of rows) {
      const term = document.createElement('dt');
      term.textContent = label;
      const value = document.createElement('dd');
      value.dataset.testid = testId;
      value.textContent = '–';
      list.append(term, value);
      this.#values.set(testId, value);
    }
    container.append(list);
  }

  set(testId: string, value: string): void {
    const el = this.#values.get(testId);
    if (el && el.textContent !== value) el.textContent = value;
  }
}

export function formatMs(ms: number): string {
  return Number.isFinite(ms) ? `${ms.toFixed(1)} ms` : '–';
}
