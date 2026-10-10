import { HeuristicLoadClassifier } from '../classifier/heuristic.js';
import { LoadSmoother, type SmoothedLoad } from '../classifier/smoothing.js';
import type { LoadClassifier } from '../classifier/types.js';
import {
  AffectEstimator,
  EngagementEstimator,
  FatigueEstimator,
  FrustrationEstimator,
} from '../heuristics/estimators.js';
import { StrainTracker, type StrainResult, type StrainStorage } from '../heuristics/strain.js';
import type { NormalisedSecond, PipelineState } from '../window/feature-pipeline.js';
import type { ModelInput } from '../window/feature-window.js';
import { LoadStatePublisher, type ChannelFactory } from './broadcast.js';
import { Emitter } from './emitter.js';
import {
  HEARTBEAT_MS,
  LOAD_STATE_CHANNEL,
  SCHEMA_VERSION,
  SENSING_STATUSES,
  type AffectState,
  type Level,
  type LoadSensorStatus,
  type LoadStateEvent,
  type LoadStateMeta,
  type PresenceState,
} from './types.js';
import { validateLoadStateEvent } from './validate.js';

/**
 * What the owner of the camera tells the hub. `running` means frames are
 * flowing; the hub then derives `calibrating` / `active` / `no_face` from the
 * pipeline itself. Every other value is published as the event status.
 */
export type SourceStatus =
  Exclude<LoadSensorStatus, 'calibrating' | 'active' | 'no_face'> | 'running';

export interface HubEvents extends Record<string, unknown> {
  /** Every emission: changes and heartbeats. */
  state: LoadStateEvent;
  /** Only when something other than `timestamp`, `meta` or `confidence` changed. */
  change: LoadStateEvent;
  /** A bug caught at the boundary (e.g. an event that failed validation). */
  error: unknown;
}

/** Timer functions, injectable so tests control time. */
export interface HubTimers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface LoadStateHubOptions {
  readonly classifier?: LoadClassifier;
  /** FR3 ablation: also switches `affect` off (null) and the heuristic's lip weight. */
  readonly useExpressionFeatures?: boolean;
  readonly heartbeatMs?: number;
  /** Publish on the BroadcastChannel (default true). */
  readonly broadcast?: boolean;
  readonly channelName?: string;
  readonly channelFactory?: ChannelFactory;
  /** Where `strain` keeps today's totals; null = memory only. Default: localStorage. */
  readonly strainStorage?: StrainStorage | null;
  /** Wall clock for `timestamp` and the strain day (default `Date.now`). */
  readonly now?: () => number;
  readonly timers?: HubTimers;
  /** Diagnostics for `meta`; omit or return null to leave `meta` out. */
  readonly meta?: () => Omit<LoadStateMeta, 'model_version'> | null;
}

const defaultTimers: HubTimers = {
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) => {
    globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

/**
 * Turns pipeline output and the camera's status into the `LoadStateEvent`
 * stream (ARCHITECTURE.md §7, §8, §8a):
 *
 *   status + seconds → classifier → EMA + hysteresis ─┐
 *                    → engagement / fatigue / affect ─┼→ event → validate → emit
 *                    → frustration / strain ──────────┘           (in page + channel)
 *
 * Emits as soon as anything other than the timestamp, meta or confidence
 * changes, and otherwise every `heartbeatMs` (5 s), so a consumer can tell
 * "unchanged" from "dead".
 *
 * Holds numbers only. It cannot import camera/ or landmarks/ (lint rule),
 * so frames and the face mesh cannot reach the event stream (§9).
 */
export class LoadStateHub {
  readonly classifier: LoadClassifier;
  readonly useExpressionFeatures: boolean;

  readonly #emitter = new Emitter<HubEvents>();
  readonly #publisher: LoadStatePublisher | null;
  readonly #heartbeatMs: number;
  readonly #now: () => number;
  readonly #timers: HubTimers;
  readonly #meta: (() => Omit<LoadStateMeta, 'model_version'> | null) | undefined;

  readonly #smoother = new LoadSmoother();
  readonly #engagement = new EngagementEstimator();
  readonly #frustration: FrustrationEstimator;
  readonly #fatigue = new FatigueEstimator();
  readonly #affect = new AffectEstimator();
  readonly #strain: StrainTracker;

  #source: SourceStatus = 'disabled';
  #pipeline: PipelineState | null = null;
  #load: SmoothedLoad | null = null;
  #engagementLevel: Level | null = null;
  #frustrated = false;
  #fatigueLevel: Level | null = null;
  #affectState: AffectState | null = null;
  #strainResult: StrainResult | null = null;

  #latest: LoadStateEvent;
  #latestKey: string;
  #timer: unknown = null;
  #closed = false;

  constructor(options: LoadStateHubOptions = {}) {
    this.useExpressionFeatures = options.useExpressionFeatures ?? true;
    this.classifier =
      options.classifier ??
      new HeuristicLoadClassifier({ useExpressionFeatures: this.useExpressionFeatures });
    this.#heartbeatMs = options.heartbeatMs ?? HEARTBEAT_MS;
    if (!(this.#heartbeatMs > 0)) throw new RangeError('heartbeatMs must be positive');
    this.#now = options.now ?? (() => Date.now());
    this.#timers = options.timers ?? defaultTimers;
    this.#meta = options.meta;
    this.#frustration = new FrustrationEstimator(this.useExpressionFeatures);
    this.#strain = new StrainTracker({
      ...(options.strainStorage === undefined ? {} : { storage: options.strainStorage }),
      now: this.#now,
    });

    this.#publisher =
      options.broadcast === false
        ? null
        : new LoadStatePublisher(
            () => this.#latest,
            options.channelFactory,
            options.channelName ?? LOAD_STATE_CHANNEL,
          );

    this.#latest = this.#build();
    this.#latestKey = changeKey(this.#latest);
    this.#publisher?.publish(this.#latest);
    this.#schedule();
  }

  /** The last emitted event. */
  get latest(): LoadStateEvent {
    return this.#latest;
  }

  get status(): LoadSensorStatus {
    return this.#latest.status;
  }

  /** True while the BroadcastChannel is open. */
  get broadcasting(): boolean {
    return this.#publisher?.available ?? false;
  }

  on<K extends keyof HubEvents>(type: K, listener: (value: HubEvents[K]) => void): () => void {
    return this.#emitter.on(type, listener);
  }

  /** The camera / model status changed. */
  setSource(source: SourceStatus): void {
    if (this.#closed || source === this.#source) return;
    const wasRunning = this.#source === 'running';
    this.#source = source;
    if (source === 'running' && !wasRunning) this.#strain.begin();
    if (wasRunning && source !== 'running') this.#strain.flush();
    this.#update();
  }

  /** Per-frame pipeline state: presence and classifiability can change between seconds. */
  updatePipeline(state: PipelineState): void {
    if (this.#closed) return;
    this.#pipeline = state;
    this.#update();
  }

  /**
   * One finished second from the feature pipeline.
   *
   * @param input the window to classify, or null when it is not classifiable
   */
  pushSecond(second: NormalisedSecond, state: PipelineState, input: ModelInput | null): void {
    if (this.#closed) return;
    this.#pipeline = state;

    if (second.phase === 'ready' && input) {
      this.#load = this.#smoother.update(this.classifier.classify(input));
    }
    const active = this.#derivedStatus() === 'active';
    const load = active ? (this.#load?.level ?? null) : null;

    this.#engagementLevel = this.#engagement.update(second);
    this.#fatigueLevel = this.#fatigue.update(second);
    this.#affectState = this.#affect.update(second);
    this.#frustrated = this.#frustration.update(second, load);
    if (this.#source === 'running') {
      this.#strainResult = this.#strain.update({
        valid: second.valid,
        load,
        fatigue: active ? this.#fatigueLevel : null,
      });
    }
    this.#update();
  }

  /** The learner took a break (resets "time since last break" in `strain`). */
  markBreak(): void {
    this.#strain.markBreak();
    this.#strainResult = this.#strain.result();
    this.#update();
  }

  /**
   * Forgets the estimates (not today's strain totals). Call with a new
   * calibration or when sensing is turned off, so an old window never
   * leaks into a new session's first event.
   */
  reset(): void {
    this.#pipeline = null;
    this.#load = null;
    this.#smoother.reset();
    this.#engagement.reset();
    this.#frustration.reset();
    this.#fatigue.reset();
    this.#affect.reset();
    this.#engagementLevel = null;
    this.#frustrated = false;
    this.#fatigueLevel = null;
    this.#affectState = null;
    this.#update();
  }

  /** Emits a final `disabled` event, saves strain and releases timer and channel. */
  close(): void {
    if (this.#closed) return;
    this.setSource('disabled');
    this.#strain.flush();
    this.#closed = true;
    if (this.#timer !== null) this.#timers.clearTimeout(this.#timer);
    this.#timer = null;
    this.#publisher?.close();
    this.#emitter.clear();
    this.classifier.dispose?.();
  }

  #derivedStatus(): LoadSensorStatus {
    if (this.#source !== 'running') return this.#source;
    const p = this.#pipeline;
    if (!p) return 'calibrating';
    if (p.presence === 'absent') return 'no_face';
    // Baseline still collecting, window still filling, or refilling after a
    // gap (§5.5): warming up, not "no face", since the face is visible.
    if (p.phase === 'calibrating' || !p.classifiable || !this.#load) return 'calibrating';
    return 'active';
  }

  #build(): LoadStateEvent {
    const status = this.#derivedStatus();
    const active = status === 'active';
    const sensing = SENSING_STATUSES.has(status);
    const load = active ? this.#load : null;
    const strain = sensing ? this.#strainResult : null;
    const meta = this.#meta?.() ?? null;

    return {
      load_state: load?.level ?? null,
      confidence: load ? round(load.confidence, 3) : null,
      frustration: active ? this.#frustrated : null,
      engagement: active ? this.#engagementLevel : null,
      timestamp: new Date(this.#now()).toISOString(),
      schema_version: SCHEMA_VERSION,
      status,
      presence: sensing ? toPresence(this.#pipeline?.presence) : null,
      fatigue: active ? this.#fatigueLevel : null,
      affect: active && this.useExpressionFeatures ? this.#affectState : null,
      strain: strain?.strain ?? null,
      suggest_break: strain?.suggestBreak ?? null,
      ...(meta
        ? {
            meta: {
              fps: round(meta.fps, 1),
              backend: meta.backend,
              model_version: this.classifier.modelVersion,
            },
          }
        : {}),
    };
  }

  /** Emits if anything a consumer acts on changed. */
  #update(): void {
    if (this.#closed) return;
    const next = this.#build();
    if (changeKey(next) !== this.#latestKey) this.#emit(next, true);
  }

  #emit(event: LoadStateEvent, changed: boolean): void {
    const result = validateLoadStateEvent(event);
    if (!result.ok) {
      // A bug, not a state: keep the last good event and say why.
      this.#emitter.emit('error', new Error(`invalid LoadStateEvent: ${result.errors.join('; ')}`));
      return;
    }
    this.#latest = event;
    this.#latestKey = changeKey(event);
    this.#publisher?.publish(event);
    this.#emitter.emit('state', event);
    if (changed) this.#emitter.emit('change', event);
    this.#schedule();
  }

  /** (Re)arms the heartbeat so the gap between emissions never exceeds heartbeatMs. */
  #schedule(): void {
    if (this.#closed) return;
    if (this.#timer !== null) this.#timers.clearTimeout(this.#timer);
    this.#timer = this.#timers.setTimeout(() => {
      this.#timer = null;
      this.#emit(this.#build(), false);
    }, this.#heartbeatMs);
  }
}

function toPresence(p: PipelineState['presence'] | undefined): PresenceState | null {
  return p === 'present' || p === 'away' || p === 'absent' ? p : null;
}

function round(x: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
}

/** Everything a consumer acts on; timestamp, meta and confidence ride along with heartbeats. */
function changeKey(e: LoadStateEvent): string {
  return [
    e.status,
    e.load_state,
    e.frustration,
    e.engagement,
    e.presence,
    e.fatigue,
    e.affect,
    e.strain,
    e.suggest_break,
  ].join('|');
}
