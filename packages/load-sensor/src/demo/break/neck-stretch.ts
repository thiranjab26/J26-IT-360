import { OneEuroVector } from '../one-euro.js';
import { glowSprite, Particles, withAlpha } from './particles.js';
import { icon, iconButton, setIconButton, type IconName } from './icons.js';
import type { Sfx } from './sfx.js';
import {
  ROUTINE,
  StretchSession,
  type Pose,
  type StretchCue,
  type StretchState,
} from './stretch-session.js';
import { clock, el, gameToolbar, setText, soundToggle } from './ui.js';

/**
 * Neck-stretch game: steer a glowing orb with your head onto gentle targets and
 * hold each one. Uses the head pose the sensor already computes, so it adds no
 * model and no inference; only drawing.
 *
 * Low-end friendly: one 2D canvas, the static background cached to an
 * offscreen canvas on resize, glows from pre-rendered sprites, a fixed
 * particle pool, device-pixel ratio capped (1 on ≤ 4-core machines), and the
 * animation loop stops whenever the game is hidden or idle.
 */

const COLOURS = {
  accent: '#d4ff3a',
  coral: '#ff7a59',
  amber: '#ffbe3d',
  sky: '#7cb2ff',
  ink: '#0b0c0a',
} as const;

/** Degrees of yaw / pitch from the centre to the edge of the play area. */
const YAW_RANGE = 30;
const PITCH_RANGE = 22;
/** Pose smoothing (degrees, deg/s): steady at rest, responsive when turning. */
const POSE_SMOOTHING = { minCutoff: 1, beta: 0.07, dCutoff: 1 } as const;
/** Screen easing between ~15 fps pose samples. */
const EASE_S = 0.06;
const TRAIL = 22;

export interface NeckStretchOptions {
  readonly sfx: Sfx;
  /** Turns sensing on (the camera is needed for this game). */
  readonly requestSensing: () => void;
  /** Turns sensing off (camera light goes out). */
  readonly stopSensing: () => void;
  /** Called once when a routine is completed (counts as a break). */
  readonly onFinish: () => void;
  readonly onExit: () => void;
}

const CUE_ICON: Record<StretchCue, IconName> = {
  right: 'right',
  left: 'left',
  up: 'up',
  down: 'down',
  tiltRight: 'tiltRight',
  tiltLeft: 'tiltLeft',
  upRight: 'upRight',
  downLeft: 'downLeft',
};

export class NeckStretchGame {
  readonly element: HTMLElement;
  /** Where the page places the live camera preview while this game is open. */
  readonly cameraSlot: HTMLElement;
  readonly #opts: NeckStretchOptions;
  readonly #canvas: HTMLCanvasElement;
  readonly #ctx: CanvasRenderingContext2D;
  readonly #bg = document.createElement('canvas');
  readonly #orb = glowSprite(COLOURS.accent, 48);
  readonly #trailSprite = glowSprite(COLOURS.accent, 16);
  readonly #fx = new Particles([COLOURS.accent, COLOURS.coral, COLOURS.amber, COLOURS.sky]);
  readonly #filter = new OneEuroVector(POSE_SMOOTHING);
  readonly #ui: {
    camBtn: HTMLButtonElement;
    time: HTMLElement;
    stepNo: HTMLElement;
    cueIcon: HTMLElement;
    instruction: HTMLElement;
    sub: HTMLElement;
    holdBar: HTMLElement;
    holdText: HTMLElement;
    steps: HTMLElement[];
    overlay: HTMLElement;
    overlayIcon: HTMLElement;
    overlayTitle: HTMLElement;
    overlayText: HTMLElement;
    overlayBtn: HTMLButtonElement;
    summary: HTMLElement;
    summaryStats: HTMLElement;
    slotEmpty: HTMLElement;
  };

  #session = new StretchSession();
  #state: StretchState;
  #sensing = false;
  #visible = false;
  #running = false;
  #raf = 0;
  #lastFrame = 0;
  #w = 0;
  #h = 0;
  #dpr = 1;
  #scale = 1;
  /** Eased cursor (px) and roll (deg) actually drawn. */
  #cx = 0;
  #cy = 0;
  #roll = 0;
  #trailX = new Float32Array(TRAIL);
  #trailY = new Float32Array(TRAIL);
  #trailHead = 0;
  #lastQuarter = 0;
  #finished = false;
  #time = 0;
  #cueShown: StretchCue | 'neutral' | 'done' | null = null;

  constructor(options: NeckStretchOptions) {
    this.#opts = options;
    this.#state = this.#session.state;

    // ── Toolbar (above the play area) ──
    const time = el('span', 'gchip');
    const timeText = el('span', '', '0:00');
    time.append(icon('timer'), timeText);
    const camBtn = iconButton('camera', 'Camera on', 'gbtn');
    camBtn.dataset.testid = 'ns-camera-toggle';
    camBtn.addEventListener('click', () => {
      this.#opts.sfx.unlock();
      if (this.#sensing) this.#opts.stopSensing();
      else this.#opts.requestSensing();
    });
    const bar = gameToolbar(
      'Neck stretch',
      () => {
        this.#opts.onExit();
      },
      time,
      camBtn,
      soundToggle(this.#opts.sfx),
    );

    // ── Play area: canvas only, plus full-cover state cards ──
    const stage = el('div', 'game-stage ns-stage');
    this.#canvas = el('canvas', 'ns-canvas');
    this.#canvas.setAttribute('aria-hidden', 'true');
    const ctx = this.#canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('2D canvas is not available');
    this.#ctx = ctx;

    const overlay = el('div', 'game-overlay');
    const overlayIcon = el('div', 'game-overlay-icon');
    const overlayTitle = el('p', 'game-overlay-title', '');
    const overlayText = el('p', 'game-overlay-text', '');
    const overlayBtn = iconButton('camera', 'Turn the camera on', 'btn btn-primary');
    overlayBtn.dataset.testid = 'ns-camera';
    overlayBtn.addEventListener('click', () => {
      this.#opts.sfx.unlock();
      this.#opts.requestSensing();
    });
    overlay.append(overlayIcon, overlayTitle, overlayText, overlayBtn);

    const summary = el('div', 'game-summary');
    summary.dataset.testid = 'ns-summary';
    const badge = el('div', 'game-summary-badge');
    badge.append(icon('check'));
    const summaryStats = el('div', 'game-summary-stats');
    const again = iconButton('play', 'Stretch again', 'btn btn-primary');
    again.addEventListener('click', () => {
      this.start();
    });
    const back = iconButton('back', 'Back to games', 'btn');
    back.addEventListener('click', () => {
      this.#opts.onExit();
    });
    const actions = el('div', 'game-summary-actions');
    actions.append(again, back);
    summary.append(
      badge,
      el('p', 'game-summary-title', 'Neck refreshed'),
      el(
        'p',
        'game-summary-text',
        'Nice and slow. Roll your shoulders once more before you go back.',
      ),
      summaryStats,
      actions,
    );
    stage.append(this.#canvas, overlay, summary);

    // ── Coach panel (beside the play area) ──
    const coach = el('aside', 'ns-coach');
    coach.setAttribute('aria-label', 'Stretch coach');

    const now = el('section', 'ns-now');
    const nowHead = el('div', 'ns-now-head');
    const cueIcon = el('span', 'ns-cue');
    const stepNo = el('span', 'ns-stepno', '');
    stepNo.dataset.testid = 'ns-step';
    nowHead.append(cueIcon, stepNo);
    const say = el('div', 'ns-say');
    say.setAttribute('aria-live', 'polite');
    const instruction = el('p', 'ns-instruction', '');
    instruction.dataset.testid = 'ns-instruction';
    const sub = el('p', 'ns-sub', '');
    say.append(instruction, sub);
    const hold = el('div', 'ns-hold');
    const holdTrack = el('div', 'ns-hold-track');
    const holdBar = el('div', 'ns-hold-bar');
    holdTrack.append(holdBar);
    const holdText = el('span', 'ns-hold-text', 'Hold');
    hold.append(holdTrack, holdText);
    now.append(nowHead, say, hold);

    this.cameraSlot = el('div', 'ns-slot');
    this.cameraSlot.dataset.testid = 'ns-slot';
    const slotEmpty = el('div', 'ns-slot-empty');
    slotEmpty.append(icon('cameraOff'), el('span', '', 'Camera off'));
    this.cameraSlot.append(slotEmpty);

    const list = el('ol', 'ns-list');
    list.setAttribute('aria-label', 'Stretches');
    const steps = ROUTINE.map((t, i) => {
      const li = el('li', 'ns-item');
      const n = el('span', 'ns-item-n', String(i + 1).padStart(2, '0'));
      const ic = el('span', 'ns-item-icon');
      ic.append(icon(CUE_ICON[t.cue]));
      li.append(n, ic, el('span', 'ns-item-name', t.short));
      list.append(li);
      return li;
    });

    coach.append(now, this.cameraSlot, list);

    const body = el('div', 'ns-body');
    body.append(stage, coach);
    const safety = el('p', 'game-note');
    safety.append(
      icon('heart'),
      el('span', '', 'Move slowly and only as far as is comfortable. Stop if anything hurts.'),
    );

    this.element = el('div', 'game ns');
    this.element.append(bar, body, safety);
    this.#ui = {
      camBtn,
      time: timeText,
      stepNo,
      cueIcon,
      instruction,
      sub,
      holdBar,
      holdText,
      steps,
      overlay,
      overlayIcon,
      overlayTitle,
      overlayText,
      overlayBtn,
      summary,
      summaryStats,
      slotEmpty,
    };

    new ResizeObserver(() => {
      this.#resize();
    }).observe(stage);
    this.#renderUi();
  }

  /** Starts (or restarts) a routine. */
  start(): void {
    this.#session = new StretchSession();
    this.#state = this.#session.state;
    this.#filter.reset();
    this.#fx.clear();
    this.#finished = false;
    this.#lastQuarter = 0;
    this.#running = true;
    this.#cx = 0;
    this.#cy = 0;
    this.#roll = 0;
    this.#trailX.fill(0);
    this.#trailY.fill(0);
    this.#renderUi();
    this.#loop();
  }

  stop(): void {
    this.#running = false;
  }

  setSensing(active: boolean): void {
    if (this.#sensing === active) return;
    this.#sensing = active;
    this.#renderUi();
  }

  setVisible(visible: boolean): void {
    this.#visible = visible;
    if (visible) this.#loop();
  }

  /** One frame from the pipeline: absolute head pose, or null when no face. */
  pushPose(tMs: number, pose: Pose | null): void {
    if (!this.#running || !this.#visible || !this.#sensing) return;
    let input: Pose | null = null;
    if (pose) {
      const [yaw = 0, pitch = 0, roll = 0] = this.#filter.filter(
        [pose.yaw, pose.pitch, pose.roll],
        tMs,
      );
      input = { yaw, pitch, roll };
    } else {
      this.#filter.reset();
    }
    const prev = this.#state;
    this.#state = this.#session.update(tMs, input);
    const s = this.#state;

    if (prev.phase === 'neutral' && s.phase === 'playing') this.#opts.sfx.play('progress');
    const quarter = Math.floor(s.hold * 4);
    if (quarter > this.#lastQuarter && quarter < 4) this.#opts.sfx.play('progress');
    this.#lastQuarter = quarter;

    if (s.completed !== null) {
      const t = this.#targetPx(s.completed);
      this.#fx.burst(t.x, t.y, 46, 420 * this.#dpr, 9 * this.#dpr);
      this.#opts.sfx.play('success');
      this.#lastQuarter = 0;
    }
    if (s.phase === 'done' && !this.#finished) {
      this.#finished = true;
      this.#fx.burst(this.#w / 2, this.#h / 2, 120, 620 * this.#dpr, 12 * this.#dpr, 1.4);
      this.#opts.sfx.play('win');
      this.#opts.onFinish();
    }
    this.#renderUi();
    this.#loop();
  }

  // ── Rendering ──

  #loop(): void {
    if (this.#raf || !this.#visible) return;
    this.#lastFrame = performance.now();
    this.#raf = requestAnimationFrame((t) => {
      this.#frame(t);
    });
  }

  #frame(now: number): void {
    this.#raf = 0;
    const dt = Math.min(0.1, Math.max(0, (now - this.#lastFrame) / 1000));
    this.#lastFrame = now;
    this.#time += dt;
    this.#draw(dt);
    const active = this.#running && this.#state.phase !== 'done';
    if (this.#visible && (active || this.#fx.alive > 0)) {
      this.#raf = requestAnimationFrame((t) => {
        this.#frame(t);
      });
    }
  }

  #resize(): void {
    const rect = this.#canvas.getBoundingClientRect();
    if (rect.width === 0) return;
    // Low-end machines (≤ 4 logical cores) draw at 1×; others at up to 2×.
    const cores = navigator.hardwareConcurrency || 4;
    this.#dpr = Math.min(window.devicePixelRatio || 1, cores <= 4 ? 1 : 2);
    this.#w = Math.round(rect.width * this.#dpr);
    this.#h = Math.round(rect.height * this.#dpr);
    this.#canvas.width = this.#w;
    this.#canvas.height = this.#h;
    const margin = 34 * this.#dpr;
    this.#scale = Math.min(
      (this.#w / 2 - margin) / YAW_RANGE,
      (this.#h / 2 - margin) / PITCH_RANGE,
    );
    this.#paintBackground();
    this.#draw(0);
  }

  /** Static backdrop: vignette, dot field, range ellipses, axes. Drawn once per resize. */
  #paintBackground(): void {
    const c = this.#bg;
    c.width = this.#w;
    c.height = this.#h;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const w = this.#w;
    const h = this.#h;
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.7);
    g.addColorStop(0, '#171a14');
    g.addColorStop(1, '#090a08');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    const step = 26 * this.#dpr;
    ctx.fillStyle = 'rgba(236, 239, 230, 0.07)';
    for (let y = (h / 2) % step; y < h; y += step) {
      for (let x = (w / 2) % step; x < w; x += step) {
        ctx.fillRect(x, y, this.#dpr, this.#dpr);
      }
    }
    ctx.strokeStyle = 'rgba(236, 239, 230, 0.07)';
    ctx.lineWidth = this.#dpr;
    for (const f of [0.33, 0.66, 1]) {
      ctx.beginPath();
      ctx.ellipse(
        w / 2,
        h / 2,
        YAW_RANGE * this.#scale * f,
        PITCH_RANGE * this.#scale * f,
        0,
        0,
        Math.PI * 2,
      );
      ctx.stroke();
    }
    ctx.setLineDash([3 * this.#dpr, 6 * this.#dpr]);
    ctx.beginPath();
    ctx.moveTo(w / 2, 0);
    ctx.lineTo(w / 2, h);
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  #toPx(yaw: number, pitch: number): { x: number; y: number } {
    // Preview is mirrored: turning to your right moves the orb right; head down moves it down.
    return { x: this.#w / 2 + yaw * this.#scale, y: this.#h / 2 + pitch * this.#scale };
  }

  #targetPx(index: number): { x: number; y: number } {
    const t = ROUTINE[index];
    if (t?.kind !== 'turn') return { x: this.#w / 2, y: this.#h / 2 };
    const need = Math.hypot(t.yaw, t.pitch);
    const r = Math.max(0, need - this.#session.config.reachSlack) / need;
    return this.#toPx(t.yaw * r, t.pitch * r);
  }

  #draw(dt: number): void {
    const ctx = this.#ctx;
    const w = this.#w;
    const h = this.#h;
    if (w === 0) return;
    const d = this.#dpr;
    ctx.drawImage(this.#bg, 0, 0);
    const s = this.#state;
    const pulse = 0.5 + 0.5 * Math.sin(this.#time * 3.2);

    // Ease the drawn cursor towards the newest pose.
    const k = 1 - Math.exp(-dt / EASE_S);
    const pose = s.pose;
    if (pose) {
      const p = this.#toPx(
        clamp(pose.yaw, -YAW_RANGE, YAW_RANGE),
        clamp(pose.pitch, -PITCH_RANGE, PITCH_RANGE),
      );
      this.#cx += (p.x - this.#cx) * k;
      this.#cy += (p.y - this.#cy) * k;
      this.#roll += (pose.roll - this.#roll) * k;
    } else if (this.#cx === 0 && this.#cy === 0) {
      this.#cx = w / 2;
      this.#cy = h / 2;
    }

    if (s.phase === 'neutral') {
      // Centre ring fills while the neutral pose is measured.
      const r = 34 * d;
      ctx.lineWidth = 3 * d;
      ctx.strokeStyle = withAlpha(COLOURS.accent, 0.18 + 0.2 * pulse);
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, r + 10 * d * pulse, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = COLOURS.accent;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * s.neutralProgress);
      ctx.stroke();
    }

    const target = s.target;
    const cfg = this.#session.config;
    if (target?.kind === 'turn') {
      // Reach zone: "this far or further" in the target direction. The wedge
      // starts at the reach angle and runs to the edge; turning past the
      // marker is fine (it is a stretch, not a bullseye).
      const cx = w / 2;
      const cy = h / 2;
      const need = Math.hypot(target.yaw, target.pitch);
      const r0 = Math.max(0, need - cfg.reachSlack) * this.#scale;
      const r1 = Math.hypot(w, h);
      const ang = Math.atan2(target.pitch, target.yaw);
      const half = Math.atan(cfg.sideRatio);
      ctx.fillStyle = s.onTarget
        ? withAlpha(COLOURS.accent, 0.13)
        : withAlpha(COLOURS.coral, 0.06 + 0.05 * pulse);
      ctx.beginPath();
      ctx.arc(cx, cy, r1, ang - half, ang + half);
      ctx.arc(cx, cy, r0, ang + half, ang - half, true);
      ctx.closePath();
      ctx.fill();
      ctx.setLineDash([6 * d, 5 * d]);
      ctx.lineWidth = 2 * d;
      ctx.strokeStyle = withAlpha(s.onTarget ? COLOURS.accent : COLOURS.coral, 0.9);
      ctx.beginPath();
      ctx.arc(cx, cy, r0, ang - half, ang + half);
      ctx.stroke();
      ctx.setLineDash([]);

      // Marker on the reach line, guide from the orb, hold ring around the marker.
      const mx = cx + Math.cos(ang) * r0;
      const my = cy + Math.sin(ang) * r0;
      ctx.setLineDash([2 * d, 8 * d]);
      ctx.strokeStyle = withAlpha(COLOURS.accent, 0.3);
      ctx.beginPath();
      ctx.moveTo(this.#cx, this.#cy);
      ctx.lineTo(mx, my);
      ctx.stroke();
      ctx.setLineDash([]);
      const mr = 15 * d;
      ctx.lineWidth = 1.5 * d;
      ctx.strokeStyle = withAlpha(COLOURS.coral, 0.25 + 0.35 * (1 - pulse));
      ctx.beginPath();
      ctx.arc(mx, my, mr + 10 * d * pulse, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = withAlpha(s.onTarget ? COLOURS.accent : COLOURS.coral, 0.9);
      ctx.beginPath();
      ctx.arc(mx, my, 5 * d, 0, Math.PI * 2);
      ctx.fill();
      chevrons(ctx, mx, my, ang, 22 * d, withAlpha(COLOURS.coral, 0.55 + 0.35 * pulse), d);
      // Hold ring follows the orb: progress stays where the learner is looking.
      this.#holdArc(this.#cx, this.#cy, 38 * d, s.hold);
    } else if (target?.kind === 'tilt') {
      // Tilt: bring your head's bar (solid) to the dashed bar or past it.
      // Canvas angle = −roll (mirrored preview: tilting to your left
      // shoulder dips the left end).
      const cx = w / 2;
      const cy = h / 2;
      const len = Math.min(w, h) * 0.32;
      const sign = Math.sign(target.roll);
      const deg = Math.PI / 180;
      const a0 = -sign * Math.max(0, Math.abs(target.roll) - cfg.reachSlack) * deg;
      const a1 = a0 - sign * 22 * deg;
      ctx.fillStyle = s.onTarget
        ? withAlpha(COLOURS.accent, 0.13)
        : withAlpha(COLOURS.coral, 0.07 + 0.05 * pulse);
      for (const side of [0, Math.PI]) {
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, len, Math.min(a0, a1) + side, Math.max(a0, a1) + side);
        ctx.closePath();
        ctx.fill();
      }
      bar(ctx, cx, cy, len, a0, withAlpha(COLOURS.coral, 0.9), 3 * d, [6 * d, 6 * d]);
      const ra = -this.#roll * deg;
      bar(
        ctx,
        cx,
        cy,
        len * 0.9,
        ra,
        s.onTarget ? COLOURS.accent : withAlpha(COLOURS.accent, 0.75),
        5 * d,
        [],
      );
      this.#holdArc(cx, cy, 30 * d, s.hold);
    }

    // Orb trail and orb.
    if (s.phase !== 'neutral' || pose) {
      this.#trailHead = (this.#trailHead + 1) % TRAIL;
      this.#trailX[this.#trailHead] = this.#cx;
      this.#trailY[this.#trailHead] = this.#cy;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 1; i < TRAIL; i += 1) {
        const j = (this.#trailHead - i + TRAIL) % TRAIL;
        const a = 1 - i / TRAIL;
        const r = (5 + 9 * a) * d;
        ctx.globalAlpha = a * 0.35;
        ctx.drawImage(
          this.#trailSprite,
          (this.#trailX[j] ?? 0) - r,
          (this.#trailY[j] ?? 0) - r,
          r * 2,
          r * 2,
        );
      }
      ctx.globalAlpha = s.faceLost ? 0.35 : 1;
      const orbR = (target?.kind === 'tilt' ? 20 : 30) * d * (1 + 0.06 * pulse);
      ctx.drawImage(this.#orb, this.#cx - orbR, this.#cy - orbR, orbR * 2, orbR * 2);
      ctx.restore();
      ctx.fillStyle = COLOURS.ink;
      ctx.beginPath();
      ctx.arc(this.#cx, this.#cy, 3 * d, 0, Math.PI * 2);
      ctx.fill();
    }

    this.#fx.step(dt);
    this.#fx.draw(ctx);
    this.#renderHold();
  }

  #holdArc(x: number, y: number, r: number, hold: number): void {
    if (hold <= 0) return;
    const ctx = this.#ctx;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineWidth = 5 * this.#dpr;
    ctx.strokeStyle = COLOURS.accent;
    ctx.beginPath();
    ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * hold);
    ctx.stroke();
    ctx.restore();
  }

  // ── DOM ──

  #renderUi(): void {
    const s = this.#state;
    const ui = this.#ui;
    const total = this.#session.total;
    const done = s.phase === 'done';

    // Camera toggle and slot.
    setIconButton(
      ui.camBtn,
      this.#sensing ? 'camera' : 'cameraOff',
      this.#sensing ? 'Camera on' : 'Camera off',
    );
    ui.camBtn.setAttribute('aria-pressed', String(this.#sensing));
    ui.camBtn.dataset.on = String(this.#sensing);
    ui.slotEmpty.hidden = this.#sensing;

    // Full-cover state cards: camera needed, or face lost.
    const needCamera = !this.#sensing && !done;
    const faceLost = this.#sensing && s.faceLost && !done && this.#running;
    ui.overlay.hidden = !needCamera && !faceLost;
    ui.overlayBtn.hidden = !needCamera;
    const mode = needCamera ? 'camera' : 'neck';
    if (ui.overlayIcon.dataset.mode !== mode) {
      ui.overlayIcon.dataset.mode = mode;
      ui.overlayIcon.replaceChildren(icon(mode));
    }
    if (needCamera) {
      setText(ui.overlayTitle, 'This game uses your camera');
      setText(
        ui.overlayText,
        'Your head steers the orb. Video stays on this device and is never recorded.',
      );
    } else {
      setText(ui.overlayTitle, 'Face not in view');
      setText(ui.overlayText, 'Sit back in front of the camera to continue.');
    }
    ui.summary.hidden = !done;
    this.element.dataset.phase = s.phase;

    // Coach: current step.
    const step = done ? total : Math.min(s.index + 1, total);
    setText(
      ui.stepNo,
      s.phase === 'neutral'
        ? 'Get ready'
        : done
          ? 'Complete'
          : `Stretch ${String(step).padStart(2, '0')} / ${String(total).padStart(2, '0')}`,
    );
    const cue = s.phase === 'neutral' ? 'neutral' : done ? 'done' : (s.target?.cue ?? null);
    if (cue !== this.#cueShown) {
      this.#cueShown = cue;
      ui.cueIcon.replaceChildren(
        icon(cue === 'neutral' ? 'neck' : cue === 'done' ? 'check' : cue ? CUE_ICON[cue] : 'neck'),
      );
      ui.cueIcon.dataset.cue = String(cue);
    }
    setText(
      ui.instruction,
      s.phase === 'neutral'
        ? 'Sit comfortably and look at the centre'
        : done
          ? 'All done'
          : (s.target?.label ?? ''),
    );
    setText(
      ui.sub,
      s.phase === 'neutral'
        ? 'Measuring your resting position…'
        : done
          ? 'Eight stretches finished'
          : s.onTarget
            ? 'Hold it there…'
            : s.reach > 0.35
              ? 'A little further…'
              : s.target?.kind === 'tilt'
                ? 'Bring the solid line to the dashed line or past it'
                : 'Move the orb past the dashed line and hold',
    );
    ui.steps.forEach((li, i) => {
      li.dataset.state =
        i < s.index || done ? 'done' : i === s.index && s.phase === 'playing' ? 'now' : '';
    });
    if (done) setText(ui.summaryStats, `${String(total)} stretches · ${clock(s.elapsedMs)}`);
    this.#renderHold();
  }

  /** Hold meter and timer: cheap DOM writes, called every animation frame. */
  #renderHold(): void {
    const s = this.#state;
    const pct = s.phase === 'neutral' ? s.neutralProgress : s.phase === 'done' ? 1 : s.hold;
    this.#ui.holdBar.style.transform = `scaleX(${pct.toFixed(3)})`;
    this.#ui.holdBar.dataset.on = String(s.onTarget || s.phase === 'neutral');
    setText(
      this.#ui.holdText,
      s.phase === 'neutral'
        ? 'Calibrating'
        : s.phase === 'done'
          ? 'Done'
          : s.onTarget
            ? 'Holding…'
            : 'Hold',
    );
    setText(this.#ui.time, clock(this.#state.elapsedMs));
  }
}

function bar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  half: number,
  angle: number,
  colour: string,
  width: number,
  dash: number[],
): void {
  const dx = Math.cos(angle) * half;
  const dy = Math.sin(angle) * half;
  ctx.save();
  ctx.setLineDash(dash);
  ctx.lineCap = 'round';
  ctx.lineWidth = width;
  ctx.strokeStyle = colour;
  ctx.beginPath();
  ctx.moveTo(x - dx, y - dy);
  ctx.lineTo(x + dx, y + dy);
  ctx.stroke();
  ctx.restore();
}

/** Two small chevrons beyond the marker, pointing outwards: "further is fine". */
function chevrons(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  gap: number,
  colour: string,
  d: number,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.strokeStyle = colour;
  ctx.lineWidth = 2 * d;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (const k of [1, 1.6]) {
    const cx = gap * k;
    ctx.moveTo(cx - 4 * d, -6 * d);
    ctx.lineTo(cx + 2 * d, 0);
    ctx.lineTo(cx - 4 * d, 6 * d);
  }
  ctx.stroke();
  ctx.restore();
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
