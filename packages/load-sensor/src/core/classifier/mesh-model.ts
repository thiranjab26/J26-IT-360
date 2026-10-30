import type { FaceMesh } from '../features/geometry.js';
import { MESH_INPUT_LENGTH, meshInput, type MeshFrame } from '../features/mesh-input.js';
import { resolveSameOriginAsset } from '../model-loader.js';

/**
 * Self-hosted trained models over the face mesh (TODO P3/P4/P5), written by
 * research/c2-load/training/export.py. Paths are relative to `modelBaseUrl`.
 */
export const MESH_MODELS = {
  /** yaw, pitch, roll in degrees (app convention, as headPose()). */
  headPose: { path: 'head-pose/model.json', frame: 'camera', outputLength: 3 },
  /** Softmax over the 7 expression classes listed in the model's meta.json. */
  expression: { path: 'expression/model.json', frame: 'face', outputLength: 7 },
} as const satisfies Record<string, MeshModelSpec>;

export interface MeshModelSpec {
  readonly path: string;
  /** Which `meshInput` frame the model was trained on. */
  readonly frame: MeshFrame;
  readonly outputLength: number;
}

type TfCore = typeof import('@tensorflow/tfjs-core');
type GraphModel = import('@tensorflow/tfjs-converter').GraphModel;

/**
 * A trained model that maps one face mesh to a small output vector.
 *
 * - The input is built by the same `meshInput()` the training data came from
 *   (scripts/landmarks-to-features.ts), so there is no train/serve skew.
 * - It runs on whichever backend the landmark provider selected (shared TF.js).
 * - `predict()` disposes every tensor it makes; a long session stays flat (NFR6).
 * - The model URL is origin-checked before anything is fetched (invariant 3).
 */
export class MeshModel {
  readonly #tf: TfCore;
  readonly #model: GraphModel;
  readonly #spec: MeshModelSpec;

  private constructor(tf: TfCore, model: GraphModel, spec: MeshModelSpec) {
    this.#tf = tf;
    this.#model = model;
    this.#spec = spec;
  }

  /**
   * Loads and checks a model. Rejects if the URL is cross-origin or the
   * model's output length is not what `spec` says (a wrong file is refused,
   * never silently misread).
   */
  static async load(spec: MeshModelSpec, modelBaseUrl = '/models/'): Promise<MeshModel> {
    const url = resolveSameOriginAsset(modelBaseUrl, spec.path);
    const [tf, converter] = await Promise.all([
      import('@tensorflow/tfjs-core'),
      import('@tensorflow/tfjs-converter'),
    ]);
    const model = await converter.loadGraphModel(url);
    const instance = new MeshModel(tf, model, spec);
    const probe = instance.#run(new Float32Array(MESH_INPUT_LENGTH));
    if (probe.length !== spec.outputLength) {
      model.dispose();
      throw new Error(
        `${spec.path}: model gives ${String(probe.length)} outputs, expected ${String(spec.outputLength)}`,
      );
    }
    return instance;
  }

  /** Model output for one face, or null when the mesh is degenerate (treated as no face). */
  predict(mesh: FaceMesh): Float32Array | null {
    const input = meshInput(mesh, this.#spec.frame);
    return input ? this.#run(input) : null;
  }

  dispose(): void {
    this.#model.dispose();
  }

  #run(input: Float32Array): Float32Array {
    const tf = this.#tf;
    const output = tf.tidy(
      () =>
        this.#model.execute(
          tf.tensor2d(input, [1, MESH_INPUT_LENGTH]),
        ) as import('@tensorflow/tfjs-core').Tensor,
    );
    try {
      // A copy, so the caller never holds a view into backend memory.
      return Float32Array.from(output.dataSync());
    } finally {
      output.dispose();
    }
  }
}
