import { useEffect, useRef, useState } from 'react';

/** True when the person has asked their system for less motion. */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

const COLOURS = ['#5b6fd6', '#f2c230', '#9b5de5', '#ff7a45', '#3fb27f', '#ffffff'];

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  spin: number;
  angle: number;
  colour: string;
  life: number;
}

/**
 * A short burst of confetti over the whole screen. Drawn on a throwaway canvas that
 * removes itself, so there is nothing to mount or clean up. Does nothing for people who
 * prefer reduced motion.
 *
 * `power` sets how many pieces and how hard they are thrown: a small burst for a correct
 * answer, a big one for a level up or a badge.
 */
export function fireConfetti(
  power: 'small' | 'big' = 'small',
  origin: { x: number; y: number } = { x: 0.5, y: 0.35 },
): void {
  if (typeof document === 'undefined' || prefersReducedMotion()) return;

  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, {
    position: 'fixed',
    inset: '0',
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
    zIndex: '200',
  });
  const dpr = window.devicePixelRatio || 1;
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    canvas.remove();
    return;
  }
  ctx.scale(dpr, dpr);

  const count = power === 'big' ? 170 : 70;
  const force = power === 'big' ? 15 : 10;
  const ox = origin.x * window.innerWidth;
  const oy = origin.y * window.innerHeight;
  const particles: Particle[] = Array.from({ length: count }, () => {
    const direction = Math.random() * Math.PI * 2;
    const speed = force * (0.35 + Math.random() * 0.65);
    return {
      x: ox,
      y: oy,
      vx: Math.cos(direction) * speed,
      vy: Math.sin(direction) * speed - force * 0.45,
      size: 5 + Math.random() * 6,
      spin: (Math.random() - 0.5) * 0.4,
      angle: Math.random() * Math.PI,
      colour: COLOURS[Math.floor(Math.random() * COLOURS.length)] ?? '#5b6fd6',
      life: 0,
    };
  });

  const started = performance.now();
  const frame = (now: number) => {
    const elapsed = now - started;
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    let alive = false;
    for (const p of particles) {
      p.vy += 0.38; // gravity
      p.vx *= 0.992; // air drag
      p.x += p.vx;
      p.y += p.vy;
      p.angle += p.spin;
      p.life += 1;
      const fade = Math.max(0, 1 - Math.max(0, elapsed - 1400) / 1100);
      if (fade > 0 && p.y < window.innerHeight + 30) alive = true;
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      ctx.fillStyle = p.colour;
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      ctx.restore();
    }
    if (alive && elapsed < 2800) requestAnimationFrame(frame);
    else canvas.remove();
  };
  requestAnimationFrame(frame);
}

/**
 * A number that counts up to its target instead of jumping. The first value shows at once;
 * later changes ease from the previous value, which is what makes earning XP feel earned.
 */
export function useCountUp(target: number, duration = 750): number {
  const [shown, setShown] = useState(target);
  const from = useRef(target);

  useEffect(() => {
    if (prefersReducedMotion() || from.current === target) {
      from.current = target;
      setShown(target);
      return;
    }
    const start = performance.now();
    const origin = from.current;
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const value = Math.round(origin + (target - origin) * eased);
      setShown(value);
      from.current = value;
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);

  return shown;
}

/** True once `active` has been true for `delay` ms, so quick things never flash a loader. */
export function useAfterDelay(active: boolean, delay = 600): boolean {
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (!active) {
      setLate(false);
      return;
    }
    const id = window.setTimeout(() => setLate(true), delay);
    return () => window.clearTimeout(id);
  }, [active, delay]);
  return active && late;
}

/** Whole seconds since `active` became true; 0 while it is false. */
export function useElapsedSeconds(active: boolean): number {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!active) {
      setSeconds(0);
      return;
    }
    const started = Date.now();
    const id = window.setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 500);
    return () => window.clearInterval(id);
  }, [active]);
  return seconds;
}
