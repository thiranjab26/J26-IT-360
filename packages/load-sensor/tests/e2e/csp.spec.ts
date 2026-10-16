import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { contentSecurityPolicy } from '../../security-headers.config.js';
import { turnSensingOn } from './helpers.js';

// TODO A7: the Content Security Policy is served, the browser enforces it, and
// the whole app (camera, TF.js on WebGL and on WASM, the mock consumer, cog
// admin) runs under it without a single violation (ARCHITECTURE.md §9; FR7,
// NFR2). "Enough when a deliberate test POST to another origin is blocked"
// (SKILLS.md §8).

const modelsPresent = existsSync(
  fileURLToPath(new URL('../../public/models/facemesh/landmarks/model.json', import.meta.url)),
);

const PAGES = ['/', '/consumer.html', '/cog-admin.html', '/bench.html'] as const;

/** A different origin that must never be reachable (port 9 is "discard"). */
const FOREIGN_ORIGIN = 'http://127.0.0.1:9';

interface Violation {
  readonly directive: string;
  readonly blockedURI: string;
  readonly sourceFile: string;
  readonly originalPolicy: string;
}

/**
 * Records every CSP violation on every page of the context. The init script is
 * injected by Playwright over the DevTools protocol, so the CSP does not block it.
 */
async function recordViolations(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const log: Violation[] = [];
    (window as unknown as { __cspViolations: Violation[] }).__cspViolations = log;
    document.addEventListener('securitypolicyviolation', (e) => {
      log.push({
        directive: e.effectiveDirective,
        blockedURI: e.blockedURI,
        sourceFile: e.sourceFile,
        originalPolicy: e.originalPolicy,
      });
    });
  });
}

function violations(page: Page): Promise<Violation[]> {
  return page.evaluate(
    () => (window as unknown as { __cspViolations: Violation[] }).__cspViolations,
  );
}

/**
 * Violations as sorted "directive via header|meta" labels. Both copies of the
 * policy are enforced, so a blocked action is reported once by each: seeing
 * both proves the header and the baked-in <meta> tag each work on their own.
 */
async function violationLabels(page: Page): Promise<string[]> {
  const header = contentSecurityPolicy('production', 'header');
  const meta = contentSecurityPolicy('production', 'meta');
  return (await violations(page))
    .map((v) => {
      const via =
        v.originalPolicy === header ? 'header' : v.originalPolicy === meta ? 'meta' : 'unknown';
      return `${v.directive} via ${via}`;
    })
    .sort();
}

test.describe('Content Security Policy (FR7, NFR2)', () => {
  test('every page is served with the policy as a header and as a <meta> tag', async ({ page }) => {
    for (const path of PAGES) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(200);
      const headers = response?.headers() ?? {};
      expect(headers['content-security-policy'], path).toBe(
        contentSecurityPolicy('production', 'header'),
      );
      expect(headers['permissions-policy'], path).toBe(
        'camera=(self), microphone=(), geolocation=()',
      );
      expect(headers['referrer-policy'], path).toBe('no-referrer');
      expect(headers['x-content-type-options'], path).toBe('nosniff');

      // The meta copy must be the first element in <head>, ahead of every
      // script and stylesheet, or those would load before the policy applies.
      const firstInHead = page.locator('head > :first-child');
      await expect(firstInHead, path).toHaveAttribute('http-equiv', 'Content-Security-Policy');
      await expect(firstInHead, path).toHaveAttribute(
        'content',
        contentSecurityPolicy('production', 'meta'),
      );
    }
  });

  test('a deliberate send to another origin is blocked by the browser', async ({
    context,
    page,
  }) => {
    await recordViolations(context);
    const foreignRequests: string[] = [];
    context.on('request', (r) => {
      if (r.url().startsWith(FOREIGN_ORIGIN)) foreignRequests.push(r.url());
    });
    await page.goto('/');

    const outcome = await page.evaluate(async (origin) => {
      const results: Record<string, string> = {};
      try {
        await fetch(`${origin}/upload`, { method: 'POST', body: 'frame' });
        results.fetch = 'sent';
      } catch {
        results.fetch = 'blocked';
      }
      results.beacon = navigator.sendBeacon(`${origin}/beacon`, 'frame') ? 'queued' : 'blocked';
      try {
        new WebSocket(`${origin.replace('http', 'ws')}/socket`).close();
        results.websocket = 'opened';
      } catch {
        results.websocket = 'blocked';
      }
      return results;
    }, FOREIGN_ORIGIN);

    expect(outcome.fetch).toBe('blocked');
    // sendBeacon and WebSocket report the block through the violation event
    // (the call itself may not throw), so the event log is the real check:
    // three attempts (fetch, beacon, WebSocket), each refused by both policies.
    await expect
      .poll(() => violationLabels(page))
      .toEqual([
        ...Array<string>(3).fill('connect-src via header'),
        ...Array<string>(3).fill('connect-src via meta'),
      ]);
    expect(foreignRequests).toEqual([]);
  });

  test('injected inline script and JavaScript eval are refused', async ({ context, page }) => {
    await recordViolations(context);
    // page.evaluate runs through DevTools, which Chrome exempts from the eval
    // check, so the eval probe must run as genuine page script: a same-origin
    // file (allowed by script-src 'self') that then tries eval.
    await page.route('**/__csp-probe.js', (route) =>
      route.fulfill({
        contentType: 'text/javascript',
        body: `try { eval('1'); window.__evalResult = 'ran'; } catch { window.__evalResult = 'blocked'; }`,
      }),
    );
    await page.goto('/');

    const result = await page.evaluate(async () => {
      const w = window as unknown as { __inlineRan?: boolean; __evalResult?: string };
      // What an HTML-injection bug would do: add an inline <script>.
      const inline = document.createElement('script');
      inline.textContent = 'window.__inlineRan = true;';
      document.head.append(inline);

      const probe = document.createElement('script');
      probe.src = '/__csp-probe.js';
      await new Promise((resolve, reject) => {
        probe.onload = resolve;
        probe.onerror = reject;
        document.head.append(probe);
      });
      return { inlineRan: w.__inlineRan ?? false, evalResult: w.__evalResult ?? 'missing' };
    });

    expect(result).toEqual({ inlineRan: false, evalResult: 'blocked' });
    await expect
      .poll(() => violationLabels(page))
      .toEqual([
        'script-src via header',
        'script-src via meta',
        'script-src-elem via header',
        'script-src-elem via meta',
      ]);
  });

  test('the self-hosted TF.js WASM binaries compile under the policy', async ({
    context,
    page,
  }) => {
    await recordViolations(context);
    await page.goto('/');
    const compiled = await page.evaluate(async () => {
      const names = ['tfjs-backend-wasm.wasm', 'tfjs-backend-wasm-simd.wasm'];
      const out: string[] = [];
      for (const name of names) {
        const bytes = await (await fetch(`/wasm/${name}`)).arrayBuffer();
        await WebAssembly.compile(bytes);
        out.push(name);
      }
      return out;
    });
    expect(compiled).toEqual(['tfjs-backend-wasm.wasm', 'tfjs-backend-wasm-simd.wasm']);
    expect(await violations(page)).toEqual([]);
  });

  test.describe('the app runs under the policy with zero violations', () => {
    test.skip(!modelsPresent, 'Face mesh assets missing: run `pnpm fetch-models` first.');

    test('sensor (default backend), mock consumer, cog admin and benchmark', async ({
      context,
    }) => {
      test.setTimeout(150_000);
      await recordViolations(context);

      const sensor = await context.newPage();
      await sensor.goto('/');
      await turnSensingOn(sensor);
      await expect(sensor.getByTestId('sensor-status')).toHaveText('Sensing is on.', {
        timeout: 60_000,
      });
      await expect(sensor.getByTestId('backend')).toHaveText(/^(webgl|wasm)$/);
      await expect
        .poll(async () => Number(await sensor.getByTestId('camera-frames').textContent()), {
          timeout: 30_000,
        })
        .toBeGreaterThan(30);

      const others: Page[] = [];
      for (const path of ['/consumer.html', '/cog-admin.html']) {
        const p = await context.newPage();
        await p.goto(path);
        await p.waitForLoadState('networkidle');
        others.push(p);
      }

      // The benchmark page runs the bare library (A7): a short run end to end.
      const bench = await context.newPage();
      await bench.goto('/bench.html?seconds=10&warmup=0');
      await bench.getByTestId('bench-start').click();
      await expect(bench.getByTestId('bench-status')).toHaveAttribute('data-state', 'done', {
        timeout: 60_000,
      });
      others.push(bench);

      for (const p of [sensor, ...others]) {
        expect(await violations(p), p.url()).toEqual([]);
      }
    });

    test('sensor on the WASM fallback backend (WebGL unavailable)', async ({ context, page }) => {
      test.setTimeout(120_000);
      // Make WebGL unavailable so backend selection must fall back to WASM:
      // proves 'wasm-unsafe-eval' is enough for the real backend, not just for
      // a bare WebAssembly.compile. (Headless Chromium ignores --disable-webgl,
      // so the context lookup is stubbed instead, as on a GPU-blocklisted laptop.)
      await context.addInitScript(() => {
        type GetContext = (this: unknown, ...args: unknown[]) => unknown;
        const prototypes = [HTMLCanvasElement.prototype, OffscreenCanvas.prototype] as unknown as {
          getContext: GetContext;
        }[];
        for (const proto of prototypes) {
          const original = proto.getContext;
          proto.getContext = function (this: unknown, ...args: unknown[]) {
            const kind = String(args[0]);
            if (kind.startsWith('webgl') || kind === 'experimental-webgl') return null;
            return Reflect.apply(original, this, args);
          };
        }
      });
      await recordViolations(context);

      await page.goto('/');
      await turnSensingOn(page);
      await expect(page.getByTestId('sensor-status')).toHaveText('Sensing is on.', {
        timeout: 90_000,
      });
      await expect(page.getByTestId('backend')).toHaveText('wasm');
      await expect
        .poll(async () => Number(await page.getByTestId('camera-frames').textContent()), {
          timeout: 30_000,
        })
        .toBeGreaterThan(10);
      expect(await violations(page)).toEqual([]);
    });
  });
});
