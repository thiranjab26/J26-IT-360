import { describe, expect, it } from 'vitest';
import { CrossOriginAssetError, resolveSameOriginAsset } from '../../src/core/model-loader.js';

const PAGE = 'https://adaptlearn.example/app/lesson/3';

describe('resolveSameOriginAsset (invariant 3, NFR2)', () => {
  it.each([
    [
      '/models/',
      'facemesh/landmarks/model.json',
      'https://adaptlearn.example/models/facemesh/landmarks/model.json',
    ],
    [
      '/models',
      'facemesh/landmarks/model.json',
      'https://adaptlearn.example/models/facemesh/landmarks/model.json',
    ],
    ['models/', 'a.json', 'https://adaptlearn.example/app/lesson/models/a.json'],
    [
      'https://adaptlearn.example/static/m/',
      'a.json',
      'https://adaptlearn.example/static/m/a.json',
    ],
    ['/wasm/', './', 'https://adaptlearn.example/wasm/'],
  ])('base %s + %s → %s', (base, path, expected) => {
    expect(resolveSameOriginAsset(base, path, PAGE)).toBe(expected);
  });

  it.each([
    ['https://tfhub.dev/mediapipe/', 'model.json'],
    ['//cdn.jsdelivr.net/npm/x/', 'model.json'],
    ['/models/', 'https://storage.googleapis.com/x/model.json'],
    ['/models/', '//evil.example/model.json'],
    ['http://adaptlearn.example/models/', 'a.json'],
  ])('refuses %s + %s', (base, path) => {
    expect(() => resolveSameOriginAsset(base, path, PAGE)).toThrow(CrossOriginAssetError);
  });
});
