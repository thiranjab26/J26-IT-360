import { describe, expect, it, vi } from 'vitest';

describe('public API module', () => {
  it('has no side effects on import: no network call (FR7, NFR2)', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    await import('../../src/core/index.js');

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
