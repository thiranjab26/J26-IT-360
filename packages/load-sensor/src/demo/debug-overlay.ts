import { MEDIAPIPE_FACE_MESH_CONNECTED_KEYPOINTS_PAIRS as CONTOUR_PAIRS } from '@tensorflow-models/face-landmarks-detection/dist/constants.js';
import { FEATURE_LANDMARKS, LANDMARKS } from '../core/features/index.js';
import { LANDMARK_COUNT, LANDMARK_STRIDE, type FaceResult } from '../core/landmarks/index.js';
import { OneEuroVector } from './one-euro.js';

/** First iris landmark: points 468–477 are the two irises (5 each) added by refinement. */
const FIRST_IRIS_INDEX = 468;

/**
 * Overlay smoothing, display only (see one-euro.ts). Coordinates are in
 * normalised image units (0–1), so speeds are in frame widths per second.
 * minCutoff 1.2 Hz removes the visible jitter of a still face; beta 10 lifts
 * the cutoff to about 7 Hz for a head turn of 0.6 frame widths/s, so a moving
 * face is followed without a visible trail. Chosen by eye, not measured.
 */
const SMOOTHING = { minCutoff: 1.2, beta: 10, dCutoff: 1 } as const;
/**
 * Landmarks arrive at ~15 fps but the screen refreshes at 60 Hz or more:
 * between samples the drawn mesh eases towards the newest one with this time
 * constant instead of jumping. 40 ms is under one landmark interval (67 ms).
 */
const EASE_MS = 40;
/** Mesh fade-in when a face is found, fade-out when it is lost. */
const FADE_MS = 280;

const COLOURS = {
  mesh: '212, 255, 58',
  iris: '255, 122, 89',
  feature: '#ffd166',
  ink: '#0b0d0a',
} as const;

const IRISES = [
  [LANDMARKS.RIGHT_IRIS_CENTER, LANDMARKS.RIGHT_IRIS_RIM],
  [LANDMARKS.LEFT_IRIS_CENTER, LANDMARKS.LEFT_IRIS_RIM],
] as const;

/**
 * Draws the face mesh on a transparent canvas laid over the live <video>: the
 * contour lines (eyes, brows, lips, face oval), all 468 mesh points, iris rings
 * and a tracking box that follows the face.
 *
 * Only landmark coordinates are drawn; the canvas never receives camera pixels,
 * so there is nothing on it that could be exported (invariant 1).
 */
export class LandmarkOverlay {
  readonly #canvas: HTMLCanvasElement;
  readonly #ctx: CanvasRenderingContext2D;
  readonly #filter = new OneEuroVector(SMOOTHING);
  /** Smoothed newest sample, and what is on screen now (eases towards it). */
  #target: Float32Array | null = null;
  #shown: Float32Array | null = null;
  #videoW = 0;
  #videoH = 0;
  #hasFace = false;
  #opacity = 0;
  #lastFrame = 0;
  #raf = 0;

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas is not available');
    this.#canvas = canvas;
    this.#ctx = ctx;
  }

  /** When true, the landmarks the features use are ringed and numbered for checking. */
  featurePoints = false;

  /** New landmark sample at frame time `tMs`; drawing happens on animation frames. */
  update(face: FaceResult | null, videoWidth: number, videoHeight: number, tMs: number): void {
    this.#videoW = videoWidth;
    this.#videoH = videoHeight;
    if (face) {
      // A face found after a gap starts fresh instead of sliding in from where it was lost.
      if (!this.#hasFace) this.#filter.reset();
      const smoothed = this.#filter.filter(face.landmarks, tMs);
      if (!this.#target || !this.#shown || !this.#hasFace) {
        this.#target = Float32Array.from(smoothed);
        this.#shown = Float32Array.from(smoothed);
      } else {
        this.#target.set(smoothed);
      }
    }
    this.#hasFace = face !== null;
    this.#start();
  }

  clear(): void {
    cancelAnimationFrame(this.#raf);
    this.#raf = 0;
    this.#hasFace = false;
    this.#opacity = 0;
    this.#target = null;
    this.#shown = null;
    this.#filter.reset();
    this.#ctx.clearRect(0, 0, this.#canvas.width, this.#canvas.height);
  }

  #start(): void {
    if (this.#raf) return;
    this.#lastFrame = performance.now();
    this.#raf = requestAnimationFrame((t) => {
      this.#tick(t);
    });
  }

  #tick(now: number): void {
    this.#raf = 0;
    const dt = Math.min(100, Math.max(0, now - this.#lastFrame));
    this.#lastFrame = now;

    const target = this.#target;
    const shown = this.#shown;
    if (target && shown) {
      const k = 1 - Math.exp(-dt / EASE_MS);
      for (let i = 0; i < shown.length; i += 1) {
        const s = shown[i] ?? 0;
        shown[i] = s + k * ((target[i] ?? 0) - s);
      }
    }
    const step = dt / FADE_MS;
    this.#opacity = this.#hasFace
      ? Math.min(1, this.#opacity + step)
      : Math.max(0, this.#opacity - step);

    this.#draw();
    // Keep animating while the mesh is visible; stop once it has faded out.
    if (this.#opacity > 0 || this.#hasFace) {
      this.#raf = requestAnimationFrame((t) => {
        this.#tick(t);
      });
    }
  }

  #draw(): void {
    // Canvas at display resolution (crisp on HiDPI). Image coordinates are
    // mapped the way CSS object-fit: cover maps the video, so they line up.
    const canvas = this.#canvas;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const ch = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }
    const ctx = this.#ctx;
    ctx.clearRect(0, 0, cw, ch);
    const lm = this.#shown;
    const vw = this.#videoW;
    const vh = this.#videoH;
    if (!lm || this.#opacity <= 0 || vw <= 0 || vh <= 0) return;

    const scale = Math.max(cw / vw, ch / vh);
    const ox = (cw - vw * scale) / 2;
    const oy = (ch - vh * scale) / 2;
    const sx = vw * scale;
    const sy = vh * scale;
    const px = (i: number): number => ox + (lm[i * LANDMARK_STRIDE] ?? 0) * sx;
    const py = (i: number): number => oy + (lm[i * LANDMARK_STRIDE + 1] ?? 0) * sy;
    const unit = Math.max(0.5, cw / 640);
    const fade = easeOut(this.#opacity);
    const a = fade * (this.featurePoints ? 0.45 : 1);

    // Tracking box: corner brackets around the face, padded 8 %. They start
    // wider and close in while the mesh fades in ("lock on").
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let i = 0; i < FIRST_IRIS_INDEX; i += 1) {
      const x = px(i);
      const y = py(i);
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
    const pad = (x1 - x0) * 0.08 + (1 - fade) * 18 * unit;
    drawBrackets(
      ctx,
      [x0 - pad, y0 - pad, x1 + pad, y1 + pad],
      `rgba(${COLOURS.mesh}, ${String(0.9 * a)})`,
      2 * unit,
    );

    // Contours: eyes, brows, lips and face oval as thin lines.
    ctx.lineWidth = 1.1 * unit;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = `rgba(${COLOURS.mesh}, ${String(0.55 * a)})`;
    ctx.beginPath();
    for (const [i, j] of CONTOUR_PAIRS) {
      ctx.moveTo(px(i), py(i));
      ctx.lineTo(px(j), py(j));
    }
    ctx.stroke();

    // Mesh points: small round dots, drawn as one path.
    const r = 0.9 * unit;
    ctx.fillStyle = `rgba(${COLOURS.mesh}, ${String(0.7 * a)})`;
    ctx.beginPath();
    for (let i = 0; i < FIRST_IRIS_INDEX; i += 1) {
      const x = px(i);
      const y = py(i);
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, Math.PI * 2);
    }
    ctx.fill();

    // Irises: a ring through the four rim points, and the centre.
    if (lm.length >= LANDMARK_COUNT * LANDMARK_STRIDE) {
      ctx.strokeStyle = `rgba(${COLOURS.iris}, ${String(0.95 * a)})`;
      ctx.fillStyle = ctx.strokeStyle;
      ctx.lineWidth = 1.4 * unit;
      for (const [centre, rim] of IRISES) {
        const cx = px(centre);
        const cy = py(centre);
        let radius = 0;
        for (const i of rim) radius += Math.hypot(px(i) - cx, py(i) - cy) / rim.length;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx, cy, 1.3 * unit, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (!this.featurePoints) return;

    // Feature landmarks: ring + index number, so each constant in
    // landmark-indices.ts can be checked against a real face (TODO A4).
    const ring = 3.5 * unit;
    const box = 8 * unit;
    ctx.font = `600 ${String(Math.round(10 * unit))}px ui-monospace, Consolas, monospace`;
    ctx.textBaseline = 'middle';
    for (const { index } of FEATURE_LANDMARKS) {
      const x = px(index);
      const y = py(index);
      ctx.beginPath();
      ctx.arc(x, y, ring, 0, Math.PI * 2);
      ctx.fillStyle = COLOURS.feature;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = COLOURS.ink;
      ctx.stroke();
      // The canvas is mirrored with CSS like the preview; un-mirror the text.
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(-1, 1);
      const label = String(index);
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = 'rgba(11, 13, 10, 0.78)';
      ctx.fillRect(ring + 2, -box, tw + 6, box * 2);
      ctx.fillStyle = COLOURS.feature;
      ctx.fillText(label, ring + 5, 0);
      ctx.restore();
    }
  }
}

function drawBrackets(
  ctx: CanvasRenderingContext2D,
  [x0, y0, x1, y1]: readonly [number, number, number, number],
  colour: string,
  width: number,
): void {
  const len = Math.min(x1 - x0, y1 - y0) * 0.16;
  ctx.strokeStyle = colour;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (const [x, y, dx, dy] of [
    [x0, y0, 1, 1],
    [x1, y0, -1, 1],
    [x0, y1, 1, -1],
    [x1, y1, -1, -1],
  ] as const) {
    ctx.moveTo(x, y + dy * len);
    ctx.lineTo(x, y);
    ctx.lineTo(x + dx * len, y);
  }
  ctx.stroke();
}

function easeOut(t: number): number {
  return 1 - (1 - t) ** 3;
}

export interface StatRow {
  /** Used by the e2e tests; keep stable. */
  readonly testId: string;
  readonly label: string;
}

/**
 * Debug read-outs: headline numbers as tiles, the rest as a key/value list.
 * Values are updated in place by `testId`.
 */
export class StatsPanel {
  readonly #values = new Map<string, HTMLElement>();

  /** Large tiles for the numbers people watch (fps, frame time). */
  addTiles(container: HTMLElement, rows: readonly StatRow[]): void {
    const grid = document.createElement('div');
    grid.className = 'metrics';
    for (const { testId, label } of rows) {
      const tile = document.createElement('div');
      tile.className = 'metric';
      const name = document.createElement('p');
      name.className = 'metric-label';
      name.textContent = label;
      const value = document.createElement('p');
      value.className = 'metric-value';
      value.dataset.testid = testId;
      value.textContent = '–';
      tile.append(name, value);
      grid.append(tile);
      this.#values.set(testId, value);
    }
    container.append(grid);
  }

  /** A compact label/value list. */
  addList(container: HTMLElement, rows: readonly StatRow[]): void {
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
    if (el && el.textContent !== value) {
      el.textContent = value;
      el.title = value;
    }
  }
}

export function formatMs(ms: number): string {
  return Number.isFinite(ms) ? `${ms.toFixed(1)} ms` : '–';
}
