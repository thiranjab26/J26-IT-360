import { describe, expect, it } from 'vitest';
import {
  selectBackend,
  UnsupportedBackendError,
  type BackendRuntime,
} from '../../../src/core/landmarks/index.js';

/** A TF.js runtime double where each backend either initialises or not. */
function runtime(
  works: Record<string, boolean | Error>,
  reportedOverride?: string,
): BackendRuntime {
  let active: string | undefined;
  return {
    setBackend(name) {
      const outcome = works[name] ?? false;
      if (outcome instanceof Error) return Promise.reject(outcome);
      if (outcome) active = name;
      return Promise.resolve(outcome);
    },
    getBackend: () => reportedOverride ?? active,
    ready: () => Promise.resolve(),
  };
}

describe('selectBackend (ARCHITECTURE.md §3)', () => {
  it('prefers webgl', async () => {
    await expect(selectBackend(runtime({ webgl: true, wasm: true }))).resolves.toBe('webgl');
  });

  it('falls back to wasm when webgl fails to initialise', async () => {
    await expect(selectBackend(runtime({ webgl: false, wasm: true }))).resolves.toBe('wasm');
  });

  it('falls back to wasm when setting webgl throws', async () => {
    await expect(
      selectBackend(runtime({ webgl: new Error('WebGL context lost'), wasm: true })),
    ).resolves.toBe('wasm');
  });

  it('refuses to run when only cpu is left, listing why each backend failed', async () => {
    const promise = selectBackend(runtime({ webgl: false, wasm: new Error('no wasm'), cpu: true }));
    await expect(promise).rejects.toBeInstanceOf(UnsupportedBackendError);
    await expect(promise).rejects.toMatchObject({
      attempts: [
        { backend: 'webgl', reason: 'failed to initialise' },
        { backend: 'wasm', reason: 'no wasm' },
      ],
    });
  });

  it('does not accept a backend the runtime silently swapped for another', async () => {
    await expect(selectBackend(runtime({ webgl: true, wasm: true }, 'cpu'))).rejects.toBeInstanceOf(
      UnsupportedBackendError,
    );
  });
});
