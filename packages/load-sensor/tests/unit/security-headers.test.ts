import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy, securityHeaders } from '../../security-headers.config.js';

// The CSP is the browser-enforced layer of the privacy architecture
// (ARCHITECTURE.md §9; FR7, NFR2, CLAUDE.md invariants 1 and 3). These tests
// pin the properties that make it worth having, so a later "quick fix" that
// loosens it fails here first. The e2e suite (tests/e2e/csp.spec.ts) proves the
// browser actually enforces it and that the app runs under it.

/** Parses "a x y; b z" into { a: ['x', 'y'], b: ['z'] }. */
function parse(policy: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const part of policy.split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (!name) continue;
    expect(out.has(name), `directive ${name} appears twice`).toBe(false);
    out.set(name, sources);
  }
  return out;
}

const production = parse(contentSecurityPolicy('production', 'header'));
const productionMeta = parse(contentSecurityPolicy('production', 'meta'));
const development = parse(contentSecurityPolicy('development', 'header'));

describe('Content Security Policy (FR7, NFR2)', () => {
  it('denies by default and only ever allows this origin', () => {
    expect(production.get('default-src')).toEqual(["'none'"]);
    expect(production.get('connect-src')).toEqual(["'self'"]);
    for (const [name, sources] of production) {
      for (const source of sources) {
        // No host, scheme or wildcard source: nothing outside this origin.
        expect(["'self'", "'none'", "'wasm-unsafe-eval'"], `${name} allows ${source}`).toContain(
          source,
        );
      }
    }
  });

  it('blocks JavaScript eval and inline script/style in production', () => {
    const all = [...production.values()].flat();
    expect(all).not.toContain("'unsafe-eval'");
    expect(all).not.toContain("'unsafe-inline'");
    expect(all).not.toContain("'unsafe-hashes'");
    expect(production.get('script-src')).toEqual(["'self'", "'wasm-unsafe-eval'"]);
  });

  it('blocks plugins, frames, <base> hijacking and framing by other sites', () => {
    expect(production.get('object-src')).toEqual(["'none'"]);
    expect(production.get('frame-src')).toEqual(["'none'"]);
    expect(production.get('base-uri')).toEqual(["'none'"]);
    expect(production.get('frame-ancestors')).toEqual(["'none'"]);
  });

  it('allows the service worker but not blob: workers', () => {
    expect(production.get('worker-src')).toEqual(["'self'"]);
  });

  it('meta delivery is the header policy minus the header-only directives', () => {
    const expected = new Map(production);
    expected.delete('frame-ancestors');
    expect(productionMeta).toEqual(expected);
  });

  it('development differs from production only by inline styles for hot reload', () => {
    const differing = [...production.keys()].filter(
      (name) => JSON.stringify(production.get(name)) !== JSON.stringify(development.get(name)),
    );
    expect(differing).toEqual(['style-src']);
    expect(development.get('style-src')).toEqual(["'self'", "'unsafe-inline'"]);
    expect([...development.keys()]).toEqual([...production.keys()]);
  });
});

describe('security headers', () => {
  it('limits the camera to this origin and sends no referrer', () => {
    const headers = securityHeaders('production');
    expect(headers['Content-Security-Policy']).toBe(contentSecurityPolicy('production', 'header'));
    expect(headers['Permissions-Policy']).toBe('camera=(self), microphone=(), geolocation=()');
    expect(headers['Referrer-Policy']).toBe('no-referrer');
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
  });
});
