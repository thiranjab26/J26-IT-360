// Browser half of scripts/landmark-parity.ts (TODO P1 parity). Served by the
// Vite dev server only; not a build input, so it never ships.
//
// Runs the face mesh with the same createDetector settings as
// TfjsFaceMeshProvider, on the backend the app uses (WebGL, or WASM), on the
// exact RGB floats the offline extraction fed the cpu backend. Pixels arrive
// from the local Node script through Playwright; nothing leaves the machine.
import * as tf from '@tensorflow/tfjs-core';
import '@tensorflow/tfjs-backend-webgl';
import * as wasm from '@tensorflow/tfjs-backend-wasm';
import * as fld from '@tensorflow-models/face-landmarks-detection';
import { keypointsToLandmarks } from '../../src/core/landmarks/keypoints.js';
import { FACEMESH_ASSET_PATHS } from '../../src/core/landmarks/tfjs-facemesh-provider.js';
import { patchWasmIntBatchMatMul } from '../../src/core/landmarks/wasm-int-matmul.js';

type Detector = Awaited<ReturnType<typeof fld.createDetector>>;

let detector: Detector | null = null;

declare global {
  interface Window {
    parity: {
      init(backend: 'webgl' | 'wasm'): Promise<string>;
      run(rgbBase64: string, size: number): Promise<number[] | null>;
    };
  }
}

window.parity = {
  async init(backend) {
    wasm.setWasmPaths('/wasm/');
    patchWasmIntBatchMatMul(tf);
    await tf.setBackend(backend);
    await tf.ready();
    detector = await fld.createDetector(fld.SupportedModels.MediaPipeFaceMesh, {
      runtime: 'tfjs',
      refineLandmarks: true,
      maxFaces: 1,
      detectorModelUrl: `/models/${FACEMESH_ASSET_PATHS.detector}`,
      landmarkModelUrl: `/models/${FACEMESH_ASSET_PATHS.landmarks}`,
    });
    return tf.getBackend();
  },

  async run(rgbBase64, size) {
    if (!detector) throw new Error('init() first');
    const bytes = Uint8Array.from(atob(rgbBase64), (c) => c.charCodeAt(0));
    const rgb = new Float32Array(bytes.buffer);
    const pixels = tf.tensor3d(rgb, [size, size, 3], 'float32');
    try {
      // staticImageMode alone is not stateless in face-landmarks-detection
      // 1.0.6: estimateFaces still merges the new detection with the face box
      // from the previous image's landmarks (dist/tfjs/detector.js,
      // calculateAssociationNormRect), so a result depends on the image before
      // it. reset() clears that box: every image is truly independent.
      detector.reset();
      const faces = await detector.estimateFaces(pixels, { staticImageMode: true });
      const face = faces[0];
      if (!face) return null;
      const landmarks = keypointsToLandmarks(face.keypoints, size, size);
      return landmarks ? Array.from(landmarks) : null;
    } finally {
      pixels.dispose();
    }
  },
};
