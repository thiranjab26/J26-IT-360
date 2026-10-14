import { describe, expect, it } from 'vitest';
import {
  CONSENT_KEY,
  CONSENT_VERSION,
  ConsentStore,
  parseConsent,
  type ConsentStorage,
} from '../../../src/demo/consent.js';

function memoryStorage(initial: Record<string, string> = {}): ConsentStorage & {
  data: Map<string, string>;
} {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      data.set(k, v);
    },
    removeItem: (k) => {
      data.delete(k);
    },
  };
}

const blocked: ConsentStorage = {
  getItem: () => {
    throw new DOMException('blocked', 'SecurityError');
  },
  setItem: () => {
    throw new DOMException('blocked', 'SecurityError');
  },
  removeItem: () => {
    throw new DOMException('blocked', 'SecurityError');
  },
};

describe('consent (A6, invariant 4)', () => {
  it('starts without consent: sensing must ask first', () => {
    expect(new ConsentStore(memoryStorage()).granted).toBe(false);
    expect(new ConsentStore(null).granted).toBe(false);
  });

  it('remembers consent on this device, with the notice version and time', () => {
    const storage = memoryStorage();
    const store = new ConsentStore(storage);
    store.grant(new Date('2026-10-14T09:30:00.000Z'));
    expect(store.granted).toBe(true);

    const again = new ConsentStore(storage);
    expect(again.granted).toBe(true);
    expect(again.record).toEqual({ version: CONSENT_VERSION, at: '2026-10-14T09:30:00.000Z' });
  });

  it('withdrawing deletes the record', () => {
    const storage = memoryStorage();
    const store = new ConsentStore(storage);
    store.grant();
    store.withdraw();
    expect(store.granted).toBe(false);
    expect(storage.data.has(CONSENT_KEY)).toBe(false);
    expect(new ConsentStore(storage).granted).toBe(false);
  });

  it('asks again after the notice changes version', () => {
    const old = JSON.stringify({ version: CONSENT_VERSION - 1, at: '2026-10-01T00:00:00.000Z' });
    expect(new ConsentStore(memoryStorage({ [CONSENT_KEY]: old })).granted).toBe(false);
  });

  it('treats malformed records as no consent', () => {
    for (const bad of ['', 'nope', '{}', 'null', '{"version":1}', '{"version":1,"at":"soon"}']) {
      expect(parseConsent(bad)).toBeNull();
    }
  });

  it('works for this visit when storage is blocked (private window)', () => {
    const store = new ConsentStore(blocked);
    expect(store.granted).toBe(false);
    store.grant();
    expect(store.granted).toBe(true);
    store.withdraw();
    expect(store.granted).toBe(false);
  });
});
