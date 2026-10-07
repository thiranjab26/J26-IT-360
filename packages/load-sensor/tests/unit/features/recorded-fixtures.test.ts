import { describe, expect, it } from 'vitest';
import {
  computeFrameSignals,
  FEATURE_INDEX,
  FEATURE_LANDMARKS,
} from '../../../src/core/features/index.js';
import { FeaturePipeline, type NormalisedSecond } from '../../../src/core/window/index.js';
import {
  compressFrame,
  expandFrame,
  listRecordedFixtures,
  loadFixture,
} from '../../fixtures/landmark-fixture.js';
import { DEFAULT_ASPECT, syntheticFace } from '../../fixtures/synthetic-face.js';

const INDICES = FEATURE_LANDMARKS.map((l) => l.index).sort((a, b) => a - b);

describe('fixture format', () => {
  it('the stored subset of landmarks (4 dp) gives the same signals as the full mesh', () => {
    const full = syntheticFace({ yaw: 12, pitch: -6, ear: 0.27, irisDx: 0.05, mouthOpen: 0.1 });
    const sparse = expandFrame(INDICES, compressFrame(INDICES, full));
    const a = computeFrameSignals({ landmarks: full, aspect: DEFAULT_ASPECT });
    const b = computeFrameSignals({ landmarks: sparse, aspect: DEFAULT_ASPECT });
    expect(a).not.toBeNull();
    for (const key of Object.keys(a ?? {}) as (keyof NonNullable<typeof a>)[]) {
      // Angles in degrees; everything else in small ratios.
      const tol = key === 'yaw' || key === 'pitch' || key === 'roll' ? 0.2 : 0.005;
      expect(Math.abs((a?.[key] ?? 0) - (b?.[key] ?? 0)), key).toBeLessThan(tol);
    }
  });
});

// Real recordings of the developer's own face (TODO A4), made with the demo's
// dev-only Fixture recorder and saved in tests/fixtures/. Skipped until one exists.
const recorded = await listRecordedFixtures();

describe.skipIf(recorded.length === 0)('recorded landmark fixtures', () => {
  it.each(recorded)('%s runs through the pipeline with finite features', async (name) => {
    const fx = await loadFixture(name);
    const pipeline = new FeaturePipeline();
    const seconds: NormalisedSecond[] = [];
    pipeline.onSecond((s) => seconds.push(s));
    for (const f of fx.frames) {
      pipeline.push(f.t, f.p ? expandFrame(fx.indices, f.p) : null, fx.aspect);
    }
    expect(seconds.length).toBeGreaterThan(0);
    for (const s of seconds) expect(Array.from(s.raw).every(Number.isFinite)).toBe(true);

    if (fx.expected.blinks !== undefined) {
      const detected = seconds.reduce((n, s) => n + (s.raw[FEATURE_INDEX.blink_count] ?? 0), 0);
      // The first second has no open-eye reference yet; allow ±1 or ±10 %.
      const tolerance = Math.max(1, Math.round(fx.expected.blinks * 0.1));
      expect(Math.abs(detected - fx.expected.blinks)).toBeLessThanOrEqual(tolerance);
    }
  });
});
