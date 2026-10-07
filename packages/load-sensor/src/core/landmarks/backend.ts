/**
 * TF.js backend selection for adapter A (ARCHITECTURE.md §3).
 *
 * Order: WebGL (GPU), then WASM (SIMD CPU code). The plain `cpu` backend is
 * never accepted: it is pure JavaScript, runs the face mesh at a few fps at
 * best, and TF.js would otherwise fall back to it silently. When neither
 * acceptable backend initialises, selection fails and the sensor reports
 * `status: "unsupported"` instead of running uselessly slowly.
 */

export type InferenceBackend = 'webgl' | 'wasm';

export const DEFAULT_BACKEND_ORDER: readonly InferenceBackend[] = ['webgl', 'wasm'];

/** The part of `@tensorflow/tfjs-core` this module needs; a double in tests. */
export interface BackendRuntime {
  setBackend(name: string): Promise<boolean>;
  getBackend(): string | undefined;
  ready(): Promise<void>;
}

export interface BackendAttempt {
  readonly backend: InferenceBackend;
  readonly reason: string;
}

export class UnsupportedBackendError extends Error {
  override readonly name = 'UnsupportedBackendError';

  constructor(readonly attempts: readonly BackendAttempt[]) {
    super(
      `No supported inference backend: ${attempts
        .map((a) => `${a.backend} (${a.reason})`)
        .join(
          ', ',
        )}. The plain cpu backend is not used because it is too slow for real-time landmarks.`,
    );
  }
}

/**
 * Activates the first backend in `order` that initialises, and returns its
 * name. Throws `UnsupportedBackendError` listing why each one failed.
 */
export async function selectBackend(
  runtime: BackendRuntime,
  order: readonly InferenceBackend[] = DEFAULT_BACKEND_ORDER,
): Promise<InferenceBackend> {
  const attempts: BackendAttempt[] = [];
  for (const backend of order) {
    try {
      const ok = await runtime.setBackend(backend);
      if (!ok) {
        attempts.push({ backend, reason: 'failed to initialise' });
        continue;
      }
      await runtime.ready();
      // Belt and braces: confirm TF.js did not swap in another backend.
      const active = runtime.getBackend();
      if (active !== backend) {
        attempts.push({ backend, reason: `runtime reports ${active ?? 'none'} instead` });
        continue;
      }
      return backend;
    } catch (error) {
      attempts.push({ backend, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  throw new UnsupportedBackendError(attempts);
}
