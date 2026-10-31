/**
 * Landmark parity, browser vs offline extraction (TODO P1).
 *
 *   pnpm landmark-parity <dataset> [--n=20] [--backend=webgl|wasm] [--headless]
 *                        [--root=C:/datasets] [--out=C:/datasets/landmarks]
 *
 * The models in P3/P4 were trained on landmarks from `pnpm extract-landmarks`
 * (TF.js cpu backend in Node); the app runs the same face mesh on WebGL (or
 * WASM) in the browser. This checks the two agree on the same input.
 *
 * Both sides get identical pixels: Node prepares each item with the
 * extraction's own `prepareInput` (same JPEG decoder, crop and resample) and
 * hands the RGB floats to the browser page (scripts/landmark-parity/), so any
 * difference left comes from the backend, not from image decoding. The first
 * check on 30 Oct compared Chrome's decoder against jpeg-js and could not tell
 * the two apart.
 *
 * Writes docs/bench/landmark-parity-<dataset>-<backend>.json: per-image and
 * overall |Δ| in normalised units and in crop pixels. No landmarks or pixels
 * are written. Headed by default, because headless Chromium renders WebGL in
 * software (SwiftShader), which is not what a learner's browser runs.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { LANDMARK_COUNT, LANDMARK_STRIDE } from '../src/core/landmarks/types.js';
import {
  DATASETS,
  DEFAULT_CROP_MARGIN,
  listItems,
  prepareInput,
  readNpyF32,
  type DatasetName,
} from './extract-landmarks-lib.js';

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VALUES = LANDMARK_COUNT * LANDMARK_STRIDE;
const PORT = 5179;

interface Options {
  readonly dataset: DatasetName;
  readonly n: number;
  readonly backend: 'webgl' | 'wasm';
  readonly headless: boolean;
  readonly root: string;
  readonly out: string;
}

function parseArgs(argv: readonly string[]): Options {
  const flag = (name: string): string | undefined =>
    argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const dataset = argv.find((a) => !a.startsWith('--'));
  if (!dataset || !(DATASETS as readonly string[]).includes(dataset)) {
    throw new Error(
      `usage: landmark-parity <${DATASETS.join('|')}> [--n=20] [--backend=webgl|wasm]`,
    );
  }
  const backend = flag('backend') ?? 'webgl';
  if (backend !== 'webgl' && backend !== 'wasm') throw new Error('--backend must be webgl or wasm');
  return {
    dataset: dataset as DatasetName,
    n: Number(flag('n') ?? 20),
    backend,
    headless: argv.includes('--headless'),
    root: flag('root') ?? 'C:/datasets',
    out: flag('out') ?? 'C:/datasets/landmarks',
  };
}

interface CsvRow {
  readonly index: number;
  readonly id: string;
  readonly found: boolean;
  readonly cropX: number;
  readonly cropY: number;
  readonly cropSize: number;
}

/** The extraction CSV (written by extract-landmarks, ids may be quoted). */
function parseCsv(text: string): CsvRow[] {
  const lines = text.split('\n').filter((l) => l.trim() !== '');
  return lines.slice(1).map((line) => {
    const cells = line.match(/("([^"]|"")*"|[^,]*)(,|$)/g)?.map((c) => c.replace(/,$/, '')) ?? [];
    const cell = (i: number): string => (cells[i] ?? '').replace(/^"|"$/g, '').replace(/""/g, '"');
    return {
      index: Number(cell(0)),
      id: cell(1),
      found: cell(4) === '1' || cell(4) === 'true',
      cropX: Number(cell(5)),
      cropY: Number(cell(6)),
      cropSize: Number(cell(7)),
    };
  });
}

/** Evenly spaced picks, so the sample is not just the first few files. */
function spaced<T>(items: readonly T[], n: number): T[] {
  if (items.length <= n) return [...items];
  return Array.from({ length: n }, (_, i) => items[Math.floor((i * items.length) / n)] as T);
}

interface ImageResult {
  readonly id: string;
  readonly size: number;
  readonly foundInBrowser: boolean;
  readonly meanXy?: number;
  readonly maxXy?: number;
  readonly meanZ?: number;
  readonly maxZ?: number;
}

function compare(
  a: Float32Array,
  b: readonly number[],
): Omit<ImageResult, 'id' | 'size' | 'foundInBrowser'> {
  let sumXy = 0;
  let maxXy = 0;
  let sumZ = 0;
  let maxZ = 0;
  for (let i = 0; i < LANDMARK_COUNT; i += 1) {
    for (let k = 0; k < LANDMARK_STRIDE; k += 1) {
      const d = Math.abs((a[i * 3 + k] ?? NaN) - (b[i * 3 + k] ?? NaN));
      if (k < 2) {
        sumXy += d;
        maxXy = Math.max(maxXy, d);
      } else {
        sumZ += d;
        maxZ = Math.max(maxZ, d);
      }
    }
  }
  return {
    meanXy: sumXy / (LANDMARK_COUNT * 2),
    maxXy,
    meanZ: sumZ / LANDMARK_COUNT,
    maxZ,
  };
}

const mean = (xs: readonly number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length;

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const base = join(opts.out, opts.dataset);
  const csv = parseCsv(await readFile(`${base}.csv`, 'utf8'));
  const npy = readNpyF32(new Uint8Array(await readFile(`${base}.npy`)));
  if (npy.shape[1] !== LANDMARK_COUNT || npy.shape[2] !== LANDMARK_STRIDE) {
    throw new Error(`unexpected .npy shape ${npy.shape.join('×')}`);
  }

  const picks = spaced(
    csv.filter((r) => r.found),
    opts.n,
  );
  const wanted = new Set(picks.map((p) => p.index));
  const items = new Map(
    (await listItems(opts.dataset, opts.root, (i) => wanted.has(i))).map((it) => [it.index, it]),
  );

  const server = await createServer({
    root: PACKAGE_ROOT,
    configFile: join(PACKAGE_ROOT, 'vite.config.ts'),
    server: { port: PORT, strictPort: true },
    logLevel: 'warn',
  });
  await server.listen();
  const browser = await chromium.launch({ headless: opts.headless });
  const results: ImageResult[] = [];
  let gpu: string;
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => {
      console.error('page error:', e.message);
    });
    await page.goto(`http://localhost:${String(PORT)}/scripts/landmark-parity/index.html`);
    await page.waitForFunction(() => 'parity' in window, null, { timeout: 60_000 });
    const backend = await page.evaluate((b) => window.parity.init(b), opts.backend);
    if (backend !== opts.backend) throw new Error(`asked for ${opts.backend}, got ${backend}`);
    gpu = await page.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl');
      const ext = gl?.getExtension('WEBGL_debug_renderer_info');
      return ext && gl ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown';
    });

    for (const pick of picks) {
      const item = items.get(pick.index);
      if (!item) throw new Error(`item ${String(pick.index)} not in the dataset listing`);
      const input = await prepareInput(item, DEFAULT_CROP_MARGIN);
      // The crop must be the one the extraction used, or the comparison is meaningless.
      if (
        Math.abs(input.crop.size - pick.cropSize) > 0.01 ||
        Math.abs(input.crop.x - pick.cropX) > 0.01
      ) {
        throw new Error(`${pick.id}: crop differs from the extraction CSV (other --margin?)`);
      }
      const b64 = Buffer.from(
        input.rgb.buffer,
        input.rgb.byteOffset,
        input.rgb.byteLength,
      ).toString('base64');
      const got = await page.evaluate(([data, size]) => window.parity.run(data, size), [
        b64,
        input.size,
      ] as const);
      const offline = npy.data.subarray(pick.index * VALUES, (pick.index + 1) * VALUES);
      results.push(
        got
          ? { id: pick.id, size: input.size, foundInBrowser: true, ...compare(offline, got) }
          : { id: pick.id, size: input.size, foundInBrowser: false },
      );
      const last = results[results.length - 1];
      console.log(
        `${pick.id}: ${last?.foundInBrowser ? `max |Δxy| ${((last.maxXy ?? 0) * input.size).toFixed(3)} px` : 'no face in browser'}`,
      );
    }
  } finally {
    await browser.close();
    await server.close();
  }

  const found = results.filter((r) => r.foundInBrowser);
  const px = (r: ImageResult, v: number | undefined): number => (v ?? 0) * r.size;
  const summary = {
    generated: new Date().toISOString(),
    dataset: opts.dataset,
    backend: opts.backend,
    browser: `chromium ${browser.version()}`,
    headless: opts.headless,
    renderer: gpu,
    images: results.length,
    found_in_browser: found.length,
    units:
      'normalised: x, y as a fraction of the square crop, z in x units (FaceResult); px = normalised × crop side',
    mean_abs_xy: found.length ? mean(found.map((r) => r.meanXy ?? 0)) : null,
    max_abs_xy: found.length ? Math.max(...found.map((r) => r.maxXy ?? 0)) : null,
    mean_abs_xy_px: found.length ? mean(found.map((r) => px(r, r.meanXy))) : null,
    max_abs_xy_px: found.length ? Math.max(...found.map((r) => px(r, r.maxXy))) : null,
    mean_abs_z: found.length ? mean(found.map((r) => r.meanZ ?? 0)) : null,
    max_abs_z: found.length ? Math.max(...found.map((r) => r.maxZ ?? 0)) : null,
    per_image: results,
  };
  const outDir = join(PACKAGE_ROOT, 'docs', 'bench');
  await mkdir(outDir, { recursive: true });
  const outPath = join(outDir, `landmark-parity-${opts.dataset}-${opts.backend}.json`);
  await writeFile(outPath, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify({ ...summary, per_image: undefined }, null, 2));
  console.log(`wrote ${outPath}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
