/**
 * Demo settings shared by the sensor page (index.html) and the admin panel
 * (cog-admin.html), plus the control channel between them.
 *
 * Settings live in localStorage (a per-viewer preference, same origin only)
 * and sync across tabs through the `storage` event. Live status and commands
 * go over a BroadcastChannel: in-browser, same-origin, never the network.
 * Messages carry counters and states only — no frame, pixel or landmark data
 * (CLAUDE.md invariants 1–2).
 *
 * Demo only: none of this changes FEATURE_CONFIG, so features stay identical
 * to the ones written into feature_spec.json.
 */

import type { CameraStatus } from '../core/camera/index.js';
import type { AlarmReason } from './attention-alarm.js';

export interface DemoSettings {
  readonly sensing: {
    /** Landmark inference cap (FrameGate). 15 is the pipeline default. */
    readonly targetFps: number;
    /** Ring and number the landmarks the features use. */
    readonly featurePoints: boolean;
    /** FR3 ablation switch. Changing it restarts calibration. */
    readonly expressionFeatures: boolean;
  };
  readonly alarm: {
    readonly enabled: boolean;
    /** No face this long → beep. */
    readonly absentS: number;
    /** Eyes closed this long → beep. */
    readonly asleepS: number;
    /** 0–100 % of the alarm's built-in volume ramp. */
    readonly volume: number;
  };
  readonly wellbeing: {
    readonly eyeBreakMin: number;
    readonly moveBreakMin: number;
  };
}

export const DEFAULT_SETTINGS: DemoSettings = {
  sensing: { targetFps: 15, featurePoints: false, expressionFeatures: true },
  alarm: { enabled: true, absentS: 5, asleepS: 3, volume: 100 },
  // 20 min is the 20-20-20 rule; 30 min a common desk-work reminder.
  wellbeing: { eyeBreakMin: 20, moveBreakMin: 30 },
};

/**
 * Allowed range per numeric setting. The fps floor keeps a blink (≥ 80 ms,
 * blink.ts) at least one frame; the ceiling is above what a mid-range laptop
 * reaches with the tfjs runtime. The asleep floor stays above the 500 ms
 * longest blink so an ordinary blink can never trigger the alarm.
 */
export const LIMITS = {
  targetFps: { min: 5, max: 30, step: 1 },
  absentS: { min: 3, max: 60, step: 1 },
  asleepS: { min: 1, max: 30, step: 1 },
  volume: { min: 0, max: 100, step: 5 },
  eyeBreakMin: { min: 5, max: 60, step: 5 },
  moveBreakMin: { min: 10, max: 120, step: 5 },
} as const;

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

/** Coerces anything (e.g. JSON from storage) to valid settings; bad values fall back to defaults. */
export function sanitizeSettings(raw: unknown): DemoSettings {
  const r = isRecord(raw) ? raw : {};
  const s = isRecord(r.sensing) ? r.sensing : {};
  const a = isRecord(r.alarm) ? r.alarm : {};
  const w = isRecord(r.wellbeing) ? r.wellbeing : {};
  const d = DEFAULT_SETTINGS;
  return {
    sensing: {
      targetFps: num(s.targetFps, d.sensing.targetFps, LIMITS.targetFps),
      featurePoints: bool(s.featurePoints, d.sensing.featurePoints),
      expressionFeatures: bool(s.expressionFeatures, d.sensing.expressionFeatures),
    },
    alarm: {
      enabled: bool(a.enabled, d.alarm.enabled),
      absentS: num(a.absentS, d.alarm.absentS, LIMITS.absentS),
      asleepS: num(a.asleepS, d.alarm.asleepS, LIMITS.asleepS),
      volume: num(a.volume, d.alarm.volume, LIMITS.volume),
    },
    wellbeing: {
      eyeBreakMin: num(w.eyeBreakMin, d.wellbeing.eyeBreakMin, LIMITS.eyeBreakMin),
      moveBreakMin: num(w.moveBreakMin, d.wellbeing.moveBreakMin, LIMITS.moveBreakMin),
    },
  };
}

export function mergeSettings(base: DemoSettings, patch: DeepPartial<DemoSettings>): DemoSettings {
  return sanitizeSettings({
    sensing: { ...base.sensing, ...patch.sensing },
    alarm: { ...base.alarm, ...patch.alarm },
    wellbeing: { ...base.wellbeing, ...patch.wellbeing },
  });
}

export const SETTINGS_KEY = 'adaptlearn.c2.settings';
/** Pre-settings key of the alarm switch; read once so an existing choice is kept. */
const LEGACY_ALARM_KEY = 'adaptlearn.c2.alarm';
/** Every localStorage key the demo uses starts with this. */
export const STORAGE_PREFIX = 'adaptlearn.c2.';

/**
 * Settings with change notification, in this tab and from other tabs.
 * Storage may be blocked (private window): settings then still work for this visit.
 */
export class SettingsStore {
  #value: DemoSettings;
  readonly #listeners = new Set<(s: DemoSettings, prev: DemoSettings) => void>();

  constructor() {
    this.#value = readStored();
    window.addEventListener('storage', (e) => {
      if (e.key !== SETTINGS_KEY && e.key !== null) return;
      this.#set(readStored());
    });
  }

  get value(): DemoSettings {
    return this.#value;
  }

  update(patch: DeepPartial<DemoSettings>): void {
    const next = mergeSettings(this.#value, patch);
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    } catch {
      // Storage blocked: keep the change for this visit only.
    }
    this.#set(next);
  }

  reset(): void {
    try {
      localStorage.removeItem(SETTINGS_KEY);
      localStorage.removeItem(LEGACY_ALARM_KEY);
    } catch {
      // Storage blocked: nothing stored to remove.
    }
    this.#set(DEFAULT_SETTINGS);
  }

  onChange(listener: (s: DemoSettings, prev: DemoSettings) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #set(next: DemoSettings): void {
    const prev = this.#value;
    if (JSON.stringify(prev) === JSON.stringify(next)) return;
    this.#value = next;
    for (const l of this.#listeners) l(next, prev);
  }
}

function readStored(): DemoSettings {
  try {
    const json = localStorage.getItem(SETTINGS_KEY);
    if (json !== null) return sanitizeSettings(JSON.parse(json));
    const legacyAlarm = localStorage.getItem(LEGACY_ALARM_KEY);
    if (legacyAlarm !== null)
      return mergeSettings(DEFAULT_SETTINGS, { alarm: { enabled: legacyAlarm !== 'off' } });
  } catch {
    // Blocked storage or corrupt JSON: defaults.
  }
  return DEFAULT_SETTINGS;
}

// ── Control channel ──────────────────────────────────────────────────────

export const CONTROL_CHANNEL = 'adaptlearn.c2.control';

/**
 * What the sensor page reports, twice a second. Counters and states only.
 * The admin panel cannot turn sensing *on*: the camera prompt and the consent
 * belong on the page that shows the camera (invariant 4), and a background
 * tab's permission prompt would go unseen. It can pause, resume or stop.
 */
export interface SensorStatus {
  readonly camera: CameraStatus;
  readonly modelState: 'not loaded' | 'loading' | 'ready' | 'failed';
  readonly backend: string | null;
  readonly fps: number;
  readonly targetFps: number;
  readonly inferenceP50: number;
  readonly inferenceP95: number;
  readonly face: 'found' | 'none' | 'not tracking';
  readonly phase: 'calibrating' | 'ready';
  readonly calibrationProgress: number;
  readonly classifiable: boolean;
  readonly windowInvalidFraction: number;
  readonly alarm: AlarmReason | null;
  readonly onScreenMs: number;
  readonly sinceEyeBreakMs: number;
  readonly sinceMoveBreakMs: number;
  readonly tensors: number | null;
  readonly errors: number;
}

export type ControlCommand = 'pause' | 'resume' | 'stop' | 'recalibrate' | 'break-taken';

export type ControlMessage =
  | { readonly type: 'status'; readonly status: SensorStatus }
  | { readonly type: 'command'; readonly command: ControlCommand }
  | { readonly type: 'hello' };

/** Opens the control channel, or null where BroadcastChannel is missing (very old browsers). */
export function openControlChannel(onMessage: (m: ControlMessage) => void): {
  post(m: ControlMessage): void;
  close(): void;
} | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  const ch = new BroadcastChannel(CONTROL_CHANNEL);
  ch.addEventListener('message', (e: MessageEvent<unknown>) => {
    if (isRecord(e.data) && typeof e.data.type === 'string') onMessage(e.data as ControlMessage);
  });
  return {
    post: (m) => {
      ch.postMessage(m);
    },
    close: () => {
      ch.close();
    },
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function num(
  v: unknown,
  fallback: number,
  lim: { min: number; max: number; step: number },
): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  const snapped = Math.round(v / lim.step) * lim.step;
  return Math.min(lim.max, Math.max(lim.min, snapped));
}
