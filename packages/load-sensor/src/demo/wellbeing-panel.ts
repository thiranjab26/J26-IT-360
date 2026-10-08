import type { NormalisedSecond } from '../core/window/index.js';
import type { AlarmReason } from './attention-alarm.js';

/**
 * Wellbeing side panel on the Camera tab: the away/asleep alarm controls,
 * screen time with break reminders, and health tips.
 *
 * Tips are general advice, shown as reminders, not as diagnoses. Which tip is
 * featured follows simple rules: tiredness signs → a walk; 20 min on screen →
 * an eye break; 30 min → movement; otherwise they rotate.
 */

type TipId = 'water' | 'eyes' | 'stretch' | 'walk' | 'posture' | 'blink' | 'breathe';

interface Tip {
  readonly id: TipId;
  readonly title: string;
  readonly body: string;
  readonly icon: string;
}

// Static inline icons (24×24, stroke = currentColor). No icon font or CDN (invariant 3).
const TIPS: readonly Tip[] = [
  {
    id: 'water',
    title: 'Drink some water',
    body: 'Keep a glass within reach and take a few sips now.',
    icon: '<path d="M12 3.5c-3 4-5.5 7-5.5 10a5.5 5.5 0 0 0 11 0c0-3-2.5-6-5.5-10z"/><path d="M9.5 14a2.5 2.5 0 0 0 2.5 2.5"/>',
  },
  {
    id: 'eyes',
    title: 'Rest your eyes · 20-20-20',
    body: 'Every 20 minutes, look at something about 6 m (20 ft) away for 20 seconds.',
    icon: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  },
  {
    id: 'stretch',
    title: 'Stretch neck and shoulders',
    body: 'Roll your shoulders back a few times, then tilt your head slowly to each side.',
    icon: '<circle cx="12" cy="4.5" r="2"/><path d="M4 9.5l8 1.5 8-1.5"/><path d="M12 11v4.5l-3 5M12 15.5l3 5"/>',
  },
  {
    id: 'walk',
    title: 'Take a short walk',
    body: 'Stand up and walk for a couple of minutes. Moving wakes you up better than pushing on.',
    icon: '<circle cx="13" cy="4.5" r="2"/><path d="M10 21l2-6 3 2v4M12 15l-1-5 4 2 3 1M11 10l-3 2-1 3"/>',
  },
  {
    id: 'posture',
    title: 'Check your posture',
    body: 'Feet flat, back supported, shoulders relaxed, top of the screen near eye level.',
    icon: '<rect x="13" y="4" width="8" height="6" rx="1"/><path d="M17 10v3"/><circle cx="6" cy="5" r="2"/><path d="M6 7v6h4l1 7M6 13l-2 7"/>',
  },
  {
    id: 'blink',
    title: 'Blink fully',
    body: 'People blink less while reading a screen. A few slow, full blinks help against dry eyes.',
    icon: '<path d="M3 10c2.5 3 5.5 4.5 9 4.5s6.5-1.5 9-4.5"/><path d="M6 13.5 4.5 16M12 14.5V17.5M18 13.5l1.5 2.5"/>',
  },
  {
    id: 'breathe',
    title: 'Take three slow breaths',
    body: 'Breathe in for a count of four, out for a count of six.',
    icon: '<path d="M4 9h11a3 3 0 1 0-3-3"/><path d="M3 13h15a3 3 0 1 1-3 3"/><path d="M5 17h5"/>',
  },
];

/** Break intervals (wall clock, while sensing is on and a face is present). */
const EYE_BREAK_MS = 20 * 60_000; // the 20-20-20 rule's 20 minutes
const MOVE_BREAK_MS = 30 * 60_000; // a common desk-work reminder interval; adjustable
/** Being away from the screen this long counts as a break and resets both timers. */
const AWAY_IS_BREAK_MS = 2 * 60_000;
/** Featured tip rotation when nothing more specific applies. */
const ROTATE_MS = 45_000;
/** Tiredness signs (long eye closures + yawns + nods) in 5 min that make "walk" the featured tip. */
const TIRED_EVENTS = 2;
const TIRED_WINDOW_S = 300;

export type AlarmView = 'sensing-off' | 'disabled' | 'watching' | AlarmReason;

const ALARM_TEXT: Record<AlarmView, { label: string; hint: string }> = {
  'sensing-off': { label: 'Inactive', hint: 'Starts when sensing is on.' },
  disabled: { label: 'Off', hint: 'Turn on to get a beep when you leave or fall asleep.' },
  watching: {
    label: 'Watching',
    hint: 'Beeps after 5 s with no face or 3 s with eyes closed, until you are back.',
  },
  absent: { label: 'Not at the screen', hint: 'Come back to the screen to stop the beep.' },
  asleep: { label: 'Eyes closed — wake up', hint: 'Open your eyes to stop the beep.' },
};

export class WellbeingPanel {
  readonly element: HTMLElement;
  readonly alarmSwitch: HTMLInputElement;
  readonly testButton: HTMLButtonElement;

  readonly #alarm: { root: HTMLElement; label: HTMLElement; hint: HTMLElement };
  readonly #screenTime: HTMLElement;
  readonly #meters: Record<'eyes' | 'move', { bar: HTMLElement; text: HTMLElement }>;
  readonly #featured: {
    root: HTMLElement;
    icon: HTMLElement;
    title: HTMLElement;
    body: HTMLElement;
    reason: HTMLElement;
    play: HTMLButtonElement;
  };
  /** Set by the page: opens the neck-stretch game from the stretch tip. */
  onPlayStretch: (() => void) | null = null;
  readonly #listItems = new Map<TipId, HTMLElement>();

  #seconds: NormalisedSecond[] = [];
  #lastTick = 0;
  #onScreenMs = 0;
  #sinceEyeBreakMs = 0;
  #sinceMoveBreakMs = 0;
  #awayMs = 0;
  #rotateIndex = 0;
  #rotateAt = 0;
  #manual: TipId | null = null;
  #featuredId: TipId | null = null;

  constructor() {
    this.element = el('aside', 'wellbeing');
    this.element.setAttribute('aria-label', 'Wellbeing');

    // ── Alarm ──
    const alarmCard = el('section', 'card wb-card wb-alarm');
    const alarmHead = el('div', 'wb-head');
    alarmHead.append(el('h2', 'card-title', 'Away & sleep alarm'));
    const sw = el('label', 'switch');
    this.alarmSwitch = el('input');
    this.alarmSwitch.type = 'checkbox';
    this.alarmSwitch.setAttribute('role', 'switch');
    this.alarmSwitch.setAttribute('aria-label', 'Away and sleep alarm');
    this.alarmSwitch.dataset.testid = 'toggle-alarm';
    const track = el('span', 'switch-track');
    track.setAttribute('aria-hidden', 'true');
    sw.append(this.alarmSwitch, track);
    alarmHead.append(sw);
    const status = el('div', 'wb-alarm-status');
    const dot = el('span', 'wb-alarm-dot');
    dot.setAttribute('aria-hidden', 'true');
    const label = el('span', 'wb-alarm-label', '');
    label.dataset.testid = 'alarm-state';
    label.setAttribute('role', 'status');
    status.append(dot, label);
    const hint = el('p', 'wb-hint', '');
    this.testButton = el('button', 'btn btn-small', 'Test sound');
    this.testButton.type = 'button';
    this.testButton.dataset.testid = 'alarm-test';
    alarmCard.append(alarmHead, status, hint, this.testButton);
    this.#alarm = { root: alarmCard, label, hint };

    // ── Screen time and breaks ──
    const timeCard = el('section', 'card wb-card');
    const timeHead = el('div', 'wb-head');
    timeHead.append(el('h2', 'card-title', 'Screen time'));
    const breakBtn = el('button', 'btn btn-small btn-ghost', 'I took a break');
    breakBtn.type = 'button';
    breakBtn.dataset.testid = 'took-break';
    breakBtn.addEventListener('click', () => {
      this.markBreak();
    });
    timeHead.append(breakBtn);
    this.#screenTime = el('p', 'wb-big', '0:00');
    this.#screenTime.dataset.testid = 'screen-time';
    const caption = el('p', 'wb-hint', 'At the screen with sensing on, this session');
    const eyes = meter('Eye break', 'every 20 min');
    const move = meter('Movement break', 'every 30 min');
    this.#meters = { eyes, move };
    timeCard.append(timeHead, this.#screenTime, caption, eyes.root, move.root);

    // ── Featured tip ──
    const tipCard = el('section', 'card wb-card wb-featured');
    const tipHead = el('div', 'wb-head');
    tipHead.append(el('h2', 'card-title', 'Tip'));
    const next = el('button', 'btn btn-small btn-ghost', 'Next');
    next.type = 'button';
    next.addEventListener('click', () => {
      this.#manual = TIPS[(this.#indexOf(this.#featuredId) + 1) % TIPS.length]?.id ?? null;
      this.#rotateAt = performance.now() + ROTATE_MS;
      this.#renderFeatured();
    });
    tipHead.append(next);
    const fIcon = el('div', 'wb-tip-icon');
    const fTitle = el('p', 'wb-tip-title', '');
    fTitle.dataset.testid = 'featured-tip';
    const fBody = el('p', 'wb-tip-body', '');
    const fReason = el('p', 'wb-tip-reason', '');
    const fText = el('div', 'wb-tip-text');
    fText.append(fReason, fTitle, fBody);
    const fRow = el('div', 'wb-tip-row');
    fRow.append(fIcon, fText);
    fRow.setAttribute('aria-live', 'polite');
    const play = el('button', 'btn btn-small btn-primary wb-play', 'Play the neck-stretch game');
    play.type = 'button';
    play.dataset.testid = 'wb-play-stretch';
    play.hidden = true;
    play.addEventListener('click', () => {
      this.onPlayStretch?.();
    });
    tipCard.append(tipHead, fRow, play);
    this.#featured = {
      root: tipCard,
      icon: fIcon,
      title: fTitle,
      body: fBody,
      reason: fReason,
      play,
    };

    // ── All tips ──
    const listCard = el('section', 'card wb-card');
    listCard.append(el('h2', 'card-title', 'Healthy study habits'));
    const list = el('ul', 'wb-list');
    for (const tip of TIPS) {
      const item = el('li', 'wb-item');
      const ic = el('span', 'wb-item-icon');
      ic.append(icon(tip.icon));
      const txt = el('span', 'wb-item-text');
      txt.append(el('strong', '', tip.title), el('span', '', tip.body));
      item.append(ic, txt);
      list.append(item);
      this.#listItems.set(tip.id, item);
    }
    listCard.append(list);

    this.element.append(alarmCard, timeCard, tipCard, listCard);
    this.setAlarm('sensing-off');
    this.#renderFeatured();
    this.#renderTimes();
  }

  setAlarm(view: AlarmView): void {
    const text = ALARM_TEXT[view];
    if (this.#alarm.label.textContent !== text.label) this.#alarm.label.textContent = text.label;
    if (this.#alarm.hint.textContent !== text.hint) this.#alarm.hint.textContent = text.hint;
    this.#alarm.root.dataset.state = view;
  }

  pushSecond(s: NormalisedSecond): void {
    this.#seconds.push(s);
    while (this.#seconds.length > TIRED_WINDOW_S) this.#seconds.shift();
  }

  /**
   * Advances the timers. Call a few times a second. `present` = sensing on and
   * a face in view; time away from the screen does not count as screen time.
   */
  tick(sensing: boolean, present: boolean): void {
    const now = performance.now();
    const dt = this.#lastTick ? Math.min(2000, now - this.#lastTick) : 0;
    this.#lastTick = now;
    if (sensing && present) {
      this.#onScreenMs += dt;
      this.#sinceEyeBreakMs += dt;
      this.#sinceMoveBreakMs += dt;
      this.#awayMs = 0;
    } else if (sensing) {
      this.#awayMs += dt;
      if (this.#awayMs >= AWAY_IS_BREAK_MS) this.markBreak();
    }
    if (!this.#rotateAt) this.#rotateAt = now + ROTATE_MS;
    if (now >= this.#rotateAt) {
      this.#manual = null;
      this.#rotateIndex = (this.#rotateIndex + 1) % TIPS.length;
      this.#rotateAt = now + ROTATE_MS;
    }
    this.#renderTimes();
    this.#renderFeatured();
  }

  /** Clears the session (sensing turned off). */
  reset(): void {
    this.#seconds = [];
    this.#onScreenMs = 0;
    this.#sinceEyeBreakMs = 0;
    this.#sinceMoveBreakMs = 0;
    this.#awayMs = 0;
    this.#renderTimes();
    this.#renderFeatured();
  }

  /** Resets both break timers (button, 2 min away, or a finished break game). */
  markBreak(): void {
    this.#sinceEyeBreakMs = 0;
    this.#sinceMoveBreakMs = 0;
    this.#awayMs = 0;
    this.#renderTimes();
    this.#renderFeatured();
  }

  #tiredEvents(): number {
    return this.#seconds.reduce((a, s) => a + s.aux.longClosures + s.aux.yawns + s.aux.nods, 0);
  }

  /** Featured tip and why: a rule if one applies, else the user's pick, else rotation. */
  #pick(): { id: TipId; reason: string } {
    if (this.#tiredEvents() >= TIRED_EVENTS) {
      return { id: 'walk', reason: 'Suggested · signs of tiredness in the last 5 min' };
    }
    if (this.#sinceMoveBreakMs >= MOVE_BREAK_MS) {
      return { id: 'stretch', reason: 'Suggested · 30 min since your last break' };
    }
    if (this.#sinceEyeBreakMs >= EYE_BREAK_MS) {
      return { id: 'eyes', reason: 'Suggested · 20 min of screen time' };
    }
    if (this.#manual) return { id: this.#manual, reason: 'Reminder' };
    return { id: TIPS[this.#rotateIndex]?.id ?? 'water', reason: 'Reminder' };
  }

  #renderFeatured(): void {
    const { id, reason } = this.#pick();
    const tip = TIPS.find((t) => t.id === id);
    if (!tip) return;
    const f = this.#featured;
    f.root.dataset.suggested = String(reason !== 'Reminder');
    f.play.hidden = id !== 'stretch' || this.onPlayStretch === null;
    if (f.reason.textContent !== reason) f.reason.textContent = reason;
    if (this.#featuredId === id) return;
    this.#featuredId = id;
    f.title.textContent = tip.title;
    f.body.textContent = tip.body;
    f.icon.replaceChildren(icon(tip.icon));
    // Restart the fade-in on change.
    f.root.classList.remove('wb-swap');
    requestAnimationFrame(() => {
      f.root.classList.add('wb-swap');
    });
    for (const [tid, item] of this.#listItems) item.dataset.current = String(tid === id);
  }

  #renderTimes(): void {
    const t = clock(this.#onScreenMs);
    if (this.#screenTime.textContent !== t) this.#screenTime.textContent = t;
    setMeter(this.#meters.eyes, this.#sinceEyeBreakMs, EYE_BREAK_MS);
    setMeter(this.#meters.move, this.#sinceMoveBreakMs, MOVE_BREAK_MS);
  }

  #indexOf(id: TipId | null): number {
    return Math.max(
      0,
      TIPS.findIndex((t) => t.id === id),
    );
  }
}

function meter(
  label: string,
  every: string,
): { root: HTMLElement; bar: HTMLElement; text: HTMLElement } {
  const root = el('div', 'wb-meter');
  const top = el('div', 'wb-meter-top');
  const text = el('span', 'wb-meter-value', '');
  top.append(el('span', 'wb-meter-label', `${label} · ${every}`), text);
  const track = el('div', 'wb-meter-track');
  const bar = el('div', 'wb-meter-bar');
  track.append(bar);
  root.append(top, track);
  return { root, bar, text };
}

function setMeter(m: { bar: HTMLElement; text: HTMLElement }, ms: number, limit: number): void {
  const frac = Math.min(1, ms / limit);
  m.bar.style.width = `${(frac * 100).toFixed(1)}%`;
  m.bar.parentElement?.parentElement?.setAttribute('data-due', String(frac >= 1));
  const left = limit - ms;
  const text = left > 0 ? `in ${clock(left, true)}` : 'due now';
  if (m.text.textContent !== text) m.text.textContent = text;
}

/** m:ss, or h:mm:ss past an hour. `ceil` rounds up (countdowns never show 0:00 early). */
function clock(ms: number, ceil = false): string {
  const total = ceil ? Math.ceil(ms / 1000) : Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${String(h)}:${String(m).padStart(2, '0')}:${ss}` : `${String(m)}:${ss}`;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function icon(paths: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.7');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  // Paths are the static constants above, never user or network data.
  svg.innerHTML = paths;
  return svg;
}
