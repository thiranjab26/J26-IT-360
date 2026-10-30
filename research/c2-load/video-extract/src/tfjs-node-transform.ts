/**
 * Adds the missing `Transform` kernel (tf.image.transform) to tfjs-node.
 *
 * The face mesh crops and rotates the face region with tf.image.transform.
 * tfjs-node 4.22.0 registers no `Transform` kernel for its 'tensorflow'
 * backend ("Kernel 'Transform' not registered for backend 'tensorflow'",
 * 30 Oct 2026), although the TensorFlow it wraps (libtensorflow 2.9.1) has the
 * op: ImageProjectiveTransformV3. This maps the TF.js kernel onto that op the
 * same way tfjs-node maps its own kernels (see its kernels/ResizeBilinear.js).
 *
 * TF.js's CPU Transform is a port of the same op, so results should agree;
 * the extractor's --backend=cpu parity check measures it (README.md).
 */
import type * as TfCore from '@tensorflow/tfjs-core';

interface TfeOpAttr {
  name: string;
  type: number;
  value: unknown;
}

interface NodeBackend {
  binding: { TF_ATTR_STRING: number };
  executeSingleOutput(name: string, attrs: TfeOpAttr[], inputs: TfCore.TensorInfo[]): TfCore.TensorInfo;
}

export async function registerTensorflowTransform(tf: typeof TfCore): Promise<void> {
  if (tf.getKernel('Transform', 'tensorflow')) return;
  // CommonJS internals of tfjs-node; typed by its own .d.ts.
  const kb = (await import('@tensorflow/tfjs-node/dist/nodejs_kernel_backend.js')) as {
    createTensorsTypeOpAttr(name: string, dtype: TfCore.DataType): TfeOpAttr;
  };
  tf.registerKernel({
    kernelName: 'Transform',
    backendName: 'tensorflow',
    kernelFunc: ({ inputs, attrs, backend }) => {
      const image = inputs.image as TfCore.TensorInfo;
      const transforms = inputs.transforms as TfCore.TensorInfo;
      const a = attrs as unknown as TfCore.TransformAttrs;
      const b = backend as NodeBackend;
      const [, height, width] = image.shape;
      const [outH, outW] = a.outputShape ?? [height ?? 0, width ?? 0];
      const outputShape = tf.tensor1d([outH, outW], 'int32');
      const fillValue = tf.scalar(a.fillValue, 'float32');
      try {
        return b.executeSingleOutput(
          'ImageProjectiveTransformV3',
          [
            kb.createTensorsTypeOpAttr('dtype', image.dtype),
            { name: 'interpolation', type: b.binding.TF_ATTR_STRING, value: a.interpolation.toUpperCase() },
            { name: 'fill_mode', type: b.binding.TF_ATTR_STRING, value: a.fillMode.toUpperCase() },
          ],
          [image, transforms, outputShape, fillValue],
        );
      } finally {
        outputShape.dispose();
        fillValue.dispose();
      }
    },
  });
}
