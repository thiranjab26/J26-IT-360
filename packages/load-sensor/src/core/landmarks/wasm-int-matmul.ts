import type { KernelConfig, KernelFunc, TensorInfo } from '@tensorflow/tfjs-core';

/** The part of `@tensorflow/tfjs-core` this module needs; a double in tests. */
export interface KernelRegistry {
  getKernel(kernelName: string, backendName: string): KernelConfig | undefined;
  registerKernel(config: KernelConfig): void;
  unregisterKernel(kernelName: string, backendName: string): void;
}

interface DisposableBackend {
  disposeData(dataId: object): boolean;
}

const patched = new WeakSet<KernelRegistry>();

/**
 * Lets the WASM backend run the attention mesh (TODO A3 bug, 30 Oct 2026).
 *
 * The 478-point landmark model (`refineLandmarks: true`) multiplies int32
 * matrices inside its SpatialTransformer layers (`BatchMatMulV2` on index
 * arithmetic). tfjs-backend-wasm 4.22.0 only implements float32 BatchMatMul
 * and throws "BatchMatMul for non non-float32 tensors not yet supported" on
 * every frame with a face, so without this the WASM fallback initialises and
 * then never produces landmarks.
 *
 * The wrapper casts int32 operands to float32, multiplies, and casts the
 * product back. This is exact while every value and partial sum stays below
 * 2^24 in magnitude (float32 represents all integers up to there); the
 * model's operands are pixel indices of a 192 px crop, far below that.
 * Float32 inputs go straight to the original kernel, so the normal path is
 * unchanged. Call once after importing the WASM backend and before the model
 * runs; repeat calls do nothing.
 */
export function patchWasmIntBatchMatMul(registry: KernelRegistry): void {
  if (patched.has(registry)) return;
  const original = registry.getKernel('BatchMatMul', 'wasm');
  const cast = registry.getKernel('Cast', 'wasm');
  if (!original || !cast) return;

  const kernelFunc: KernelFunc = (args) => {
    const { a, b } = args.inputs;
    if (!a || !b || (a.dtype === 'float32' && b.dtype === 'float32')) {
      return original.kernelFunc(args);
    }
    const backend = args.backend as DisposableBackend;
    const toFloat = (x: TensorInfo): TensorInfo =>
      x.dtype === 'float32'
        ? x
        : (cast.kernelFunc({ inputs: { x }, backend, attrs: { dtype: 'float32' } }) as TensorInfo);
    const af = toFloat(a);
    const bf = toFloat(b);
    const product = original.kernelFunc({ ...args, inputs: { a: af, b: bf } }) as TensorInfo;
    const out = cast.kernelFunc({
      inputs: { x: product },
      backend,
      attrs: { dtype: a.dtype },
    }) as TensorInfo;
    // Intermediates live only on the WASM heap, not in the tensor registry.
    for (const t of [af, bf, product]) {
      if (t !== a && t !== b) backend.disposeData(t.dataId);
    }
    return out;
  };

  registry.unregisterKernel('BatchMatMul', 'wasm');
  registry.registerKernel({ ...original, kernelFunc });
  patched.add(registry);
}
