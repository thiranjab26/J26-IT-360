/**
 * Particle bursts for the break games, built for low-end devices:
 * - a fixed pool in typed arrays (no allocation per particle, no GC pauses);
 * - glow comes from a sprite rendered once and stamped with drawImage, never
 *   from `shadowBlur`, which is slow on integrated GPUs;
 * - the owner stops its animation loop once `alive` reaches 0.
 */

const MAX = 160;

export class Particles {
  readonly #x = new Float32Array(MAX);
  readonly #y = new Float32Array(MAX);
  readonly #vx = new Float32Array(MAX);
  readonly #vy = new Float32Array(MAX);
  readonly #life = new Float32Array(MAX);
  readonly #ttl = new Float32Array(MAX);
  readonly #size = new Float32Array(MAX);
  readonly #colour = new Uint8Array(MAX);
  readonly #sprites: HTMLCanvasElement[];
  #alive = 0;
  #next = 0;
  /** Downward pull in px/s² (confetti falls, sparks float). */
  gravity = 0;

  /** `colours`: CSS colours; one glow sprite is made per colour. */
  constructor(colours: readonly string[]) {
    this.#sprites = colours.map((c) => glowSprite(c, 32));
  }

  get alive(): number {
    return this.#alive;
  }

  /** Radial burst at (x, y), speeds in px/s. */
  burst(x: number, y: number, count: number, speed: number, size: number, ttl = 0.9): void {
    for (let k = 0; k < count; k += 1) {
      const i = this.#next;
      this.#next = (this.#next + 1) % MAX;
      if (this.#life[i] === 0) this.#alive += 1;
      const angle = Math.random() * Math.PI * 2;
      const v = speed * (0.35 + Math.random() * 0.65);
      this.#x[i] = x;
      this.#y[i] = y;
      this.#vx[i] = Math.cos(angle) * v;
      this.#vy[i] = Math.sin(angle) * v;
      this.#ttl[i] = ttl * (0.6 + Math.random() * 0.4);
      this.#life[i] = this.#ttl[i] ?? ttl;
      this.#size[i] = size * (0.5 + Math.random() * 0.8);
      this.#colour[i] = Math.floor(Math.random() * this.#sprites.length);
    }
  }

  /** Advances by `dt` seconds. */
  step(dt: number): void {
    if (this.#alive === 0) return;
    const drag = Math.exp(-2.2 * dt);
    let alive = 0;
    for (let i = 0; i < MAX; i += 1) {
      const life = this.#life[i] ?? 0;
      if (life <= 0) continue;
      const next = life - dt;
      if (next <= 0) {
        this.#life[i] = 0;
        continue;
      }
      this.#life[i] = next;
      this.#vx[i] = (this.#vx[i] ?? 0) * drag;
      this.#vy[i] = (this.#vy[i] ?? 0) * drag + this.gravity * dt;
      this.#x[i] = (this.#x[i] ?? 0) + (this.#vx[i] ?? 0) * dt;
      this.#y[i] = (this.#y[i] ?? 0) + (this.#vy[i] ?? 0) * dt;
      alive += 1;
    }
    this.#alive = alive;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    if (this.#alive === 0) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < MAX; i += 1) {
      const life = this.#life[i] ?? 0;
      if (life <= 0) continue;
      const t = life / (this.#ttl[i] ?? 1);
      const s = (this.#size[i] ?? 4) * (0.4 + 0.6 * t);
      const sprite = this.#sprites[this.#colour[i] ?? 0];
      if (!sprite) continue;
      ctx.globalAlpha = t;
      ctx.drawImage(sprite, (this.#x[i] ?? 0) - s, (this.#y[i] ?? 0) - s, s * 2, s * 2);
    }
    ctx.restore();
  }

  clear(): void {
    this.#life.fill(0);
    this.#alive = 0;
  }
}

/** A soft round glow, rendered once: bright core fading to transparent. */
export function glowSprite(colour: string, radius: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = radius * 2;
  c.height = radius * 2;
  const ctx = c.getContext('2d');
  if (!ctx) return c;
  const g = ctx.createRadialGradient(radius, radius, 0, radius, radius, radius);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.18, colour);
  g.addColorStop(0.45, withAlpha(colour, 0.35));
  g.addColorStop(1, withAlpha(colour, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, radius * 2, radius * 2);
  return c;
}

/** `#rrggbb` → rgba() with the given alpha. */
export function withAlpha(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${String((n >> 16) & 255)}, ${String((n >> 8) & 255)}, ${String(n & 255)}, ${String(alpha)})`;
}
