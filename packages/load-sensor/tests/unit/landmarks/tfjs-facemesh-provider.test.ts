import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LANDMARK_COUNT, TfjsFaceMeshProvider } from '../../../src/core/landmarks/index.js';
import { CrossOriginAssetError } from '../../../src/core/model-loader.js';

// The real libraries need WebGL; these doubles record how adapter A configures them.
const mocks = vi.hoisted(() => {
  const detector = {
    estimateFaces: vi.fn(),
    dispose: vi.fn(),
  };
  return {
    detector,
    createDetector: vi.fn(() => Promise.resolve(detector)),
    setWasmPaths: vi.fn(),
    setBackend: vi.fn((name: string) => Promise.resolve(name === 'webgl')),
    getBackend: vi.fn(() => 'webgl'),
  };
});

vi.mock('@tensorflow/tfjs-core', () => ({
  setBackend: mocks.setBackend,
  getBackend: mocks.getBackend,
  ready: () => Promise.resolve(),
  memory: () => ({ numTensors: 7 }),
}));
vi.mock('@tensorflow/tfjs-backend-webgl', () => ({}));
vi.mock('@tensorflow/tfjs-backend-wasm', () => ({ setWasmPaths: mocks.setWasmPaths }));
vi.mock('@tensorflow-models/face-landmarks-detection', () => ({
  SupportedModels: { MediaPipeFaceMesh: 'MediaPipeFaceMesh' },
  createDetector: mocks.createDetector,
}));

const video = { videoWidth: 640, videoHeight: 480 } as HTMLVideoElement;

beforeEach(() => {
  vi.stubGlobal('location', { href: 'http://localhost:5174/demo/' });
  mocks.detector.estimateFaces.mockReset();
  mocks.createDetector.mockClear();
  mocks.setWasmPaths.mockClear();
});

describe('TfjsFaceMeshProvider configuration (FR1, invariant 3)', () => {
  it('loads the tfjs runtime with iris refinement from same-origin URLs only', async () => {
    const provider = new TfjsFaceMeshProvider({ modelBaseUrl: '/models/', wasmBaseUrl: '/wasm/' });
    await provider.init();

    expect(mocks.createDetector).toHaveBeenCalledWith('MediaPipeFaceMesh', {
      runtime: 'tfjs',
      refineLandmarks: true,
      maxFaces: 1,
      detectorModelUrl: 'http://localhost:5174/models/facemesh/detector/model.json',
      landmarkModelUrl: 'http://localhost:5174/models/facemesh/landmarks/model.json',
    });
    expect(mocks.setWasmPaths).toHaveBeenCalledWith('http://localhost:5174/wasm/');
    expect(provider.backend).toBe('webgl');
    expect(provider.numTensors).toBe(7);
  });

  it('refuses a cross-origin model URL before loading anything', async () => {
    const provider = new TfjsFaceMeshProvider({ modelBaseUrl: 'https://tfhub.dev/mediapipe/' });
    await expect(provider.init()).rejects.toBeInstanceOf(CrossOriginAssetError);
    expect(mocks.createDetector).not.toHaveBeenCalled();
    expect(mocks.setWasmPaths).not.toHaveBeenCalled();
  });

  it('shares one load between concurrent init() calls', async () => {
    const provider = new TfjsFaceMeshProvider();
    await Promise.all([provider.init(), provider.init()]);
    expect(mocks.createDetector).toHaveBeenCalledTimes(1);
  });

  it('cannot be initialised after dispose()', async () => {
    const provider = new TfjsFaceMeshProvider();
    provider.dispose();
    await expect(provider.init()).rejects.toThrow(/disposed/);
  });
});

describe('TfjsFaceMeshProvider.estimate', () => {
  it('returns normalised 478×3 landmarks for the first face, with video tracking on', async () => {
    const provider = new TfjsFaceMeshProvider();
    await provider.init();
    const keypoints = Array.from({ length: LANDMARK_COUNT }, () => ({ x: 320, y: 120, z: 64 }));
    mocks.detector.estimateFaces.mockResolvedValue([{ keypoints, box: {} }]);

    const result = await provider.estimate(video);

    expect(mocks.detector.estimateFaces).toHaveBeenCalledWith(video, {
      flipHorizontal: false,
      staticImageMode: false,
    });
    expect(result?.score).toBeNull();
    expect(Array.from(result?.landmarks.slice(0, 3) ?? [])).toEqual([
      0.5, 0.25, 0.10000000149011612,
    ]);
  });

  it('returns null when no face is found', async () => {
    const provider = new TfjsFaceMeshProvider();
    await provider.init();
    mocks.detector.estimateFaces.mockResolvedValue([]);
    await expect(provider.estimate(video)).resolves.toBeNull();
  });

  it('returns null without inference while the video has no frame yet', async () => {
    const provider = new TfjsFaceMeshProvider();
    await provider.init();
    const empty = { videoWidth: 0, videoHeight: 0 } as HTMLVideoElement;
    await expect(provider.estimate(empty)).resolves.toBeNull();
    expect(mocks.detector.estimateFaces).not.toHaveBeenCalled();
  });

  it('throws if used before init()', async () => {
    await expect(new TfjsFaceMeshProvider().estimate(video)).rejects.toThrow(/before init/);
  });

  it('disposes the detector', async () => {
    const provider = new TfjsFaceMeshProvider();
    await provider.init();
    provider.dispose();
    expect(mocks.detector.dispose).toHaveBeenCalled();
  });
});
