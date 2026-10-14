import { describe, expect, it } from 'vitest';
import { calibrationView } from '../../../src/demo/calibration-prompt.js';
import type { PipelineState } from '../../../src/core/window/index.js';

function state(patch: Partial<PipelineState>): PipelineState {
  return {
    phase: 'calibrating',
    calibrationProgress: 0,
    calibrationSeconds: 0,
    calibrationTarget: 60,
    presence: 'present',
    classifiable: false,
    windowSeconds: 0,
    windowInvalidFraction: 0,
    ...patch,
  };
}

describe('calibration prompt (A6)', () => {
  it('is hidden while sensing is off', () => {
    const v = calibrationView({
      sensing: false,
      faceFound: false,
      state: null,
      justFinished: false,
    });
    expect(v.kind).toBe('hidden');
  });

  it('asks the learner to look at the screen and counts down while calibrating', () => {
    const v = calibrationView({
      sensing: true,
      faceFound: true,
      state: state({ calibrationSeconds: 15, calibrationProgress: 0.25 }),
      justFinished: false,
    });
    expect(v.kind).toBe('calibrating');
    expect(v.title).toBe('Look at the screen as you normally would');
    expect(v.detail).toContain('about 45 s left');
    expect(v.progress).toBe(0.25);
  });

  it('asks the learner to move into view when no face is seen', () => {
    const start = calibrationView({
      sensing: true,
      faceFound: false,
      state: state({}),
      justFinished: false,
    });
    expect(start.kind).toBe('find-face');
    expect(start.title).toBe('Move into view');

    const midway = calibrationView({
      sensing: true,
      faceFound: false,
      state: state({ calibrationSeconds: 40, calibrationProgress: 40 / 60 }),
      justFinished: false,
    });
    expect(midway.detail).toContain('about 20 s left');
  });

  it('confirms once when the baseline is ready, then gets out of the way', () => {
    const ready = state({ phase: 'ready', calibrationProgress: 1, calibrationSeconds: 60 });
    expect(
      calibrationView({ sensing: true, faceFound: true, state: ready, justFinished: true }).kind,
    ).toBe('done');
    expect(
      calibrationView({ sensing: true, faceFound: true, state: ready, justFinished: false }).kind,
    ).toBe('hidden');
  });
});
