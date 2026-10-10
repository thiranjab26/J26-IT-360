import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
import { BANNED_HOSTS, MODEL_LOADER, privacyConfig } from '../../eslint/privacy.js';

// Proves the privacy guards (FR7, NFR2; ARCHITECTURE.md §9 layers 1–2) actually fire.
// The rules are linted in isolation (no type-aware rules), so snippets need not exist on disk.

const packageRoot = fileURLToPath(new URL('../..', import.meta.url));

const isolated = new ESLint({
  cwd: packageRoot,
  overrideConfigFile: true,
  overrideConfig: [
    { files: ['**/*.ts'], languageOptions: { parser: tseslint.parser } },
    ...privacyConfig,
  ],
});

async function violations(code: string, filePath: string): Promise<(string | null)[]> {
  const [result] = await isolated.lintText(code, { filePath });
  if (!result) throw new Error('ESLint returned no result');
  const fatal = result.messages.find((m) => m.fatal);
  if (fatal) throw new Error(`Parse error in snippet: ${fatal.message}`);
  return result.messages.map((m) => m.ruleId);
}

describe('privacy lint: no network APIs in src/core', () => {
  it.each([
    ['fetch call', "fetch('/x');", 'no-restricted-globals'],
    ['XMLHttpRequest', 'new XMLHttpRequest();', 'no-restricted-globals'],
    ['WebSocket', "new WebSocket('wss://example.org');", 'no-restricted-globals'],
    ['RTCPeerConnection', 'new RTCPeerConnection();', 'no-restricted-globals'],
    ['MediaRecorder', 'new MediaRecorder(stream);', 'no-restricted-globals'],
    ['navigator.sendBeacon', "navigator.sendBeacon('/x', '1');", 'no-restricted-syntax'],
    ['window.fetch', "window.fetch('/x');", 'no-restricted-syntax'],
    ['globalThis.fetch', "globalThis.fetch('/x');", 'no-restricted-syntax'],
  ])('flags %s', async (_label, code, rule) => {
    expect(await violations(code, 'src/core/features/x.ts')).toContain(rule);
  });

  it('allows the model loader to fetch', async () => {
    expect(await violations("fetch('/models/facemesh/model.json');", MODEL_LOADER)).toEqual([]);
  });

  it('does not restrict network APIs in the demo app', async () => {
    expect(await violations("fetch('/api/health');", 'src/demo/main.ts')).toEqual([]);
  });
});

describe('privacy lint: no frame export anywhere in src/', () => {
  it.each([
    ['canvas.toDataURL', "canvas.toDataURL('image/png');"],
    ['canvas.toBlob', 'canvas.toBlob(cb);'],
    ['OffscreenCanvas.convertToBlob', 'void offscreen.convertToBlob();'],
    ['video.captureStream', 'video.captureStream();'],
  ])('flags %s in core and demo', async (_label, code) => {
    expect(await violations(code, 'src/core/camera/x.ts')).toContain('no-restricted-syntax');
    expect(await violations(code, 'src/demo/x.ts')).toContain('no-restricted-syntax');
  });

  it('still flags frame export inside the model loader', async () => {
    expect(await violations('canvas.toDataURL();', MODEL_LOADER)).toContain('no-restricted-syntax');
  });
});

describe('privacy lint: no third-party hosts anywhere in src/', () => {
  it.each(BANNED_HOSTS)('flags %s in a string literal', async (host) => {
    const code = `export const url = 'https://${host}/some/model.json';`;
    expect(await violations(code, 'src/demo/x.ts')).toContain('no-restricted-syntax');
  });

  it('flags a host in a template literal', async () => {
    const code = 'export const url = `https://cdn.jsdelivr.net/npm/${name}`;';
    expect(await violations(code, 'src/core/landmarks/x.ts')).toContain('no-restricted-syntax');
  });

  it('flags a host in an import specifier', async () => {
    const code = "import x from 'https://unpkg.com/x';\nexport { x };";
    expect(await violations(code, 'src/demo/x.ts')).toContain('no-restricted-syntax');
  });

  it('allows same-origin paths', async () => {
    const code = "export const url = '/models/facemesh/model.json';";
    expect(await violations(code, 'src/core/landmarks/x.ts')).toEqual([]);
  });
});

describe('privacy lint: events/ and recorder/ receive numbers only', () => {
  it.each([
    ['src/core/events/x.ts', "import { start } from '../camera/stream.js';"],
    ['src/core/recorder/x.ts', "import { start } from '../camera/index.js';"],
    ['src/core/recorder/x.ts', "import type { FaceResult } from '../landmarks/types.js';"],
    ['src/core/events/x.ts', "import { cam } from '../camera';"],
  ])('flags %s importing frame-holding code', async (filePath, imp) => {
    expect(await violations(`${imp}\nexport {};`, filePath)).toContain('no-restricted-imports');
  });

  it('allows features/ to import landmarks/', async () => {
    const code = "import type { FaceResult } from '../landmarks/types.js';\nexport {};";
    expect(await violations(code, 'src/core/features/x.ts')).toEqual([]);
  });
});

describe('privacy lint is wired into the real config', () => {
  const real = new ESLint({ cwd: packageRoot });

  it('applies the network ban to core files', async () => {
    const config = (await real.calculateConfigForFile('src/core/features/x.ts')) as {
      rules: Record<string, unknown>;
    };
    expect(config.rules['no-restricted-globals']).toBeDefined();
    expect(config.rules['no-restricted-syntax']).toBeDefined();
  });

  it('applies the import ban to events/', async () => {
    const config = (await real.calculateConfigForFile('src/core/events/x.ts')) as {
      rules: Record<string, unknown>;
    };
    expect(config.rules['no-restricted-imports']).toBeDefined();
  });
});

describe('no third-party hosts in the HTML entry points', () => {
  it.each(['index.html', 'cog-admin.html', 'consumer.html'])(
    '%s references same-origin assets only',
    (page) => {
      const html = readFileSync(new URL(`../../${page}`, import.meta.url), 'utf8');
      for (const host of BANNED_HOSTS) expect(html).not.toContain(host);
    },
  );
});
