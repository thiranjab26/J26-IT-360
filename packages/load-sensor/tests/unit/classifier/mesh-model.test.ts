import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EXPRESSION_CLASSES,
  MESH_MODELS,
  MeshModel,
} from '../../../src/core/classifier/mesh-model.js';
import { MESH_INPUT_LENGTH } from '../../../src/core/features/mesh-input.js';
import { CrossOriginAssetError } from '../../../src/core/model-loader.js';

// Doubles for TF.js: record what the wrapper feeds the model and that every tensor is freed.
const mocks = vi.hoisted(() => {
  const live = new Set<object>();
  const tensor = (values: Float32Array) => {
    const t = { values, dispose: vi.fn(() => live.delete(t)), dataSync: () => values };
    live.add(t);
    return t;
  };
  let outputLength = 3;
  const inputs: Float32Array[] = [];
  const model = {
    execute: vi.fn((x: { values: Float32Array }) => {
      inputs.push(x.values);
      return tensor(Float32Array.from({ length: outputLength }, (_, i) => i + 0.5));
    }),
    dispose: vi.fn(),
  };
  return {
    live,
    inputs,
    model,
    setOutputLength: (n: number) => (outputLength = n),
    loadGraphModel: vi.fn(() => Promise.resolve(model)),
    tensor2d: vi.fn((values: Float32Array) => tensor(values)),
  };
});

vi.mock('@tensorflow/tfjs-core', () => ({
  tensor2d: mocks.tensor2d,
  // Like tf.tidy: everything made inside except the result is freed.
  tidy: (fn: () => { dispose: () => void }) => {
    const before = new Set(mocks.live);
    const result = fn();
    for (const t of [...mocks.live]) {
      if (!before.has(t) && t !== result) (t as { dispose: () => void }).dispose();
    }
    return result;
  },
}));
vi.mock('@tensorflow/tfjs-converter', () => ({ loadGraphModel: mocks.loadGraphModel }));

/** A face whose eye corners are apart, so meshInput() is not degenerate. */
function mesh(): { landmarks: Float32Array; aspect: number } {
  const landmarks = new Float32Array(MESH_INPUT_LENGTH).fill(0.5);
  for (const [i, x] of [
    [33, 0.4],
    [133, 0.45],
    [362, 0.55],
    [263, 0.6],
  ] as const) {
    landmarks[i * 3] = x;
  }
  landmarks[10 * 3 + 1] = 0.3; // forehead
  landmarks[152 * 3 + 1] = 0.8; // chin
  return { landmarks, aspect: 4 / 3 };
}

beforeEach(() => {
  vi.stubGlobal('location', { href: 'http://localhost:5174/demo/' });
  mocks.setOutputLength(3);
  mocks.inputs.length = 0;
  mocks.live.clear();
  mocks.loadGraphModel.mockClear();
  mocks.model.dispose.mockClear();
});

describe('MeshModel (TODO P5: trained mesh models in the browser)', () => {
  it('loads from a same-origin URL and predicts from the mesh input, freeing every tensor', async () => {
    const model = await MeshModel.load(MESH_MODELS.headPose);
    expect(mocks.loadGraphModel).toHaveBeenCalledWith(
      'http://localhost:5174/models/head-pose/model.json',
    );
    const out = model.predict(mesh());
    expect(Array.from(out ?? [])).toEqual([0.5, 1.5, 2.5]);
    // Load-time probe plus one prediction, each a [1, 1434] input.
    expect(mocks.inputs).toHaveLength(2);
    expect(mocks.inputs[1]).toHaveLength(MESH_INPUT_LENGTH);
    expect(mocks.live.size).toBe(0);
  });

  it('refuses a cross-origin model URL before loading anything', async () => {
    await expect(
      MeshModel.load(MESH_MODELS.expression, 'https://cdn.example.com/models/'),
    ).rejects.toBeInstanceOf(CrossOriginAssetError);
    expect(mocks.loadGraphModel).not.toHaveBeenCalled();
  });

  it('refuses a model whose output length does not match its spec', async () => {
    mocks.setOutputLength(5);
    await expect(MeshModel.load(MESH_MODELS.expression)).rejects.toThrow(/5 outputs, expected 7/);
    expect(mocks.model.dispose).toHaveBeenCalled();
  });

  it('expression classes are in the same order as the Python training code', async () => {
    const { readFile } = await import('node:fs/promises');
    const py = await readFile(
      new URL('../../../../../research/c2-load/training/expression.py', import.meta.url),
      'utf8',
    );
    const tuple = /^CLASSES = \(([^)]*)\)/m.exec(py)?.[1] ?? '';
    const names = [...tuple.matchAll(/"([a-z]+)"/g)].map((m) => m[1]);
    expect(names).toEqual([...EXPRESSION_CLASSES]);
  });

  it('returns null for a degenerate mesh without running the model', async () => {
    const model = await MeshModel.load(MESH_MODELS.headPose);
    const runs = mocks.inputs.length;
    expect(model.predict({ landmarks: new Float32Array(MESH_INPUT_LENGTH), aspect: 1 })).toBeNull();
    expect(mocks.inputs).toHaveLength(runs);
  });
});
