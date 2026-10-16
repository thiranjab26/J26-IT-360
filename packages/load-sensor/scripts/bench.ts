/**
 * `pnpm bench`: latency and memory benchmark (TODO A7; NFR1, NFR6;
 * ARCHITECTURE.md §11). Builds the app, serves the production build, opens
 * bench.html in each requested browser, runs the measurement there, and writes
 * one JSON file per browser to docs/bench/.
 *
 *   pnpm bench                                  Chromium, fake camera, 30 s warm-up + 120 s
 *   pnpm bench --browser=chromium,msedge,firefox
 *   pnpm bench --camera=real                    your webcam, face in view (the real measurement)
 *   pnpm bench --seconds=60 --warmup=10 --headless
 *
 * Headed by default: headless Chromium renders WebGL in software
 * (SwiftShader), which does not represent a real laptop. A face clip for the
 * fake camera can be given with ADAPTLEARN_FAKE_VIDEO (tests/e2e/fake-camera.ts).
 *
 * Every number comes from the run; the page flags anything that makes a run
 * unrepresentative (no face, page hidden, software GPU) in `warnings`.
 */
import { execFileSync } from 'node:child_process';
import { closeSync, mkdirSync, openSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { arch, cpus, platform, release, tmpdir, totalmem } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, type Browser, type BrowserContextOptions } from '@playwright/test';
import { build, preview } from 'vite';
import { CAMERA_SOURCE, FACE_CLIP } from '../tests/e2e/fake-camera.js';

type BrowserName = 'chromium' | 'msedge' | 'firefox';
const BROWSERS: readonly BrowserName[] = ['chromium', 'msedge', 'firefox'];

interface Options {
  readonly browsers: readonly BrowserName[];
  readonly camera: 'fake' | 'real';
  readonly seconds: number;
  readonly warmup: number;
  readonly headless: boolean;
  /** Clip fed to Chromium/Edge's fake camera: the face clip, or a generated pattern. */
  readonly fakeClip: string | null;
}

const PACKAGE_ROOT = fileURLToPath(new URL('../', import.meta.url));
const OUT_DIR = fileURLToPath(new URL('../docs/bench/', import.meta.url));

function parseArgs(argv: readonly string[]): Options {
  const get = (name: string): string | undefined =>
    argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const browsers = (get('browser') ?? 'chromium').split(',').map((b) => b.trim());
  for (const b of browsers) {
    if (!BROWSERS.includes(b as BrowserName)) {
      throw new Error(`--browser must be one of ${BROWSERS.join(', ')}; got "${b}"`);
    }
  }
  const camera = get('camera') ?? 'fake';
  if (camera !== 'fake' && camera !== 'real') throw new Error('--camera must be fake or real');
  const int = (name: string, fallback: number): number => {
    const raw = get(name);
    const n = raw === undefined ? fallback : Number(raw);
    if (!Number.isInteger(n) || n < 0) throw new Error(`--${name} must be a whole number`);
    return n;
  };
  return {
    browsers: browsers as BrowserName[],
    camera,
    seconds: int('seconds', 120),
    warmup: int('warmup', 30),
    headless: argv.includes('--headless'),
    fakeClip: null,
  };
}

/**
 * Writes a synthetic test pattern (moving grey bars; no person, no camera
 * image) as a Y4M clip in the OS temp folder, for Chromium and Edge's fake
 * camera when no face clip is given. Two reasons: Chrome and Edge then see
 * identical input, and Edge's built-in fake device sometimes ends its track
 * about a second after starting (reproduced 2026-10-16 with a bare
 * getUserMedia() call, 2–3 of 3 headed launches), while the file-backed
 * device did not (0 of 4).
 */
function writePatternClip(): string {
  const width = 640;
  const height = 480;
  const frames = 30;
  const path = join(tmpdir(), `adaptlearn-bench-pattern-${String(process.pid)}.y4m`);
  const fd = openSync(path, 'w');
  try {
    writeSync(fd, `YUV4MPEG2 W${String(width)} H${String(height)} F30:1 Ip A1:1 C420jpeg\n`);
    const luma = Buffer.alloc(width * height);
    const chroma = Buffer.alloc((width * height) / 2, 128);
    for (let f = 0; f < frames; f += 1) {
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          luma[y * width + x] = ((x + f * 8) >> 5) % 2 ? 200 : 60;
        }
      }
      writeSync(fd, 'FRAME\n');
      writeSync(fd, luma);
      writeSync(fd, chroma);
    }
  } finally {
    closeSync(fd);
  }
  return path;
}

async function launch(name: BrowserName, opts: Options): Promise<Browser> {
  if (name === 'firefox') {
    return firefox.launch({
      headless: opts.headless,
      firefoxUserPrefs: {
        // Grant the camera without a prompt; with --camera=fake, use Firefox's
        // own synthetic stream (Firefox cannot play a custom clip).
        'media.navigator.permission.disabled': true,
        ...(opts.camera === 'fake' ? { 'media.navigator.streams.fake': true } : {}),
      },
    });
  }
  const args = ['--use-fake-ui-for-media-stream'];
  if (opts.camera === 'fake' && opts.fakeClip) {
    args.push(
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-video-capture=${opts.fakeClip}`,
    );
  }
  return chromium.launch({
    ...(name === 'msedge' ? { channel: 'msedge' } : {}),
    headless: opts.headless,
    args,
  });
}

function git(args: readonly string[]): string | null {
  try {
    return execFileSync('git', args, { cwd: PACKAGE_ROOT, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function hostInfo(): Record<string, unknown> {
  const cpu = cpus()[0];
  return {
    cpu: cpu?.model.trim() ?? null,
    logical_cores: cpus().length,
    memory_gb: Math.round((totalmem() / 1024 ** 3) * 10) / 10,
    os: `${platform()} ${release()} ${arch()}`,
  };
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/\(r\)|\(tm\)|cpu|processor|@.*$/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

async function runOne(
  name: BrowserName,
  opts: Options,
  baseURL: string,
): Promise<Record<string, unknown>> {
  const browser = await launch(name, opts);
  try {
    const contextOptions: BrowserContextOptions = {
      baseURL,
      viewport: { width: 1100, height: 800 },
      // Firefox grants through the pref above; Playwright's 'camera' is Chromium-only.
      ...(name === 'firefox' ? {} : { permissions: ['camera'] }),
    };
    const context = await browser.newContext(contextOptions);
    const page = await context.newPage();
    page.on('pageerror', (e) => {
      console.error(`[${name}] page error:`, e.message);
    });
    await page.goto(`/bench.html?seconds=${String(opts.seconds)}&warmup=${String(opts.warmup)}`);
    await page.getByTestId('bench-start').click();
    const status = page.getByTestId('bench-status');
    await status
      .and(page.locator('[data-state]'))
      .waitFor({ timeout: (opts.seconds + opts.warmup + 180) * 1000 });
    if ((await status.getAttribute('data-state')) !== 'done') {
      throw new Error((await status.textContent()) ?? 'benchmark failed');
    }
    const report = JSON.parse(
      (await page.getByTestId('bench-report').textContent()) ?? 'null',
    ) as Record<string, unknown>;
    const commit = git(['rev-parse', '--short', 'HEAD']);
    const dirty = (git(['status', '--porcelain']) ?? '').length > 0;
    return {
      ...report,
      run_info: {
        browser: name,
        browser_version: browser.version(),
        headless: opts.headless,
        camera_source: opts.camera === 'real' ? 'real-camera' : CAMERA_SOURCE,
        commit: commit ? `${commit}${dirty ? '-dirty' : ''}` : null,
        host: hostInfo(),
        command: `pnpm bench ${process.argv.slice(2).join(' ')}`.trim(),
      },
    };
  } finally {
    await browser.close();
  }
}

/**
 * A browser's fake capture device can end its track right after starting (see
 * writePatternClip); the sensor then correctly reports `no_camera`. A
 * fake-camera run is retried a few times for that. A real-camera failure is
 * never retried, so it always shows.
 */
const FAKE_CAMERA_ATTEMPTS = 3;

async function runWithRetry(
  name: BrowserName,
  opts: Options,
  baseURL: string,
): Promise<Record<string, unknown>> {
  const attempts = opts.camera === 'fake' ? FAKE_CAMERA_ATTEMPTS : 1;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await runOne(name, opts, baseURL);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt >= attempts || !message.includes('status: no_camera')) throw error;
      console.log(
        `bench: ${name}: the fake camera ended its track (browser quirk); retrying (${String(attempt + 1)}/${String(attempts)})…`,
      );
    }
  }
}

function printSummary(name: string, r: Record<string, unknown>, file: string): void {
  const m = r.metrics_ms as Record<string, { p50: number | null; p95: number | null }>;
  const run = r.run as { landmark_fps: number; face_ratio: number | null };
  const warnings = r.warnings as string[];
  const f = (x: number | null | undefined): string => (x == null ? '–' : x.toFixed(1));
  console.log(`\n${name}: ${file}`);
  console.log(
    `  frame latency p50/p95 ${f(m.frame_latency?.p50)}/${f(m.frame_latency?.p95)} ms · event latency p95 ${f(m.event_latency?.p95)} ms · inference p95 ${f(m.face_mesh_inference?.p95)} ms · classifier p95 ${f(m.classifier?.p95)} ms`,
  );
  console.log(
    `  ${String(run.landmark_fps)} landmark fps, face in ${run.face_ratio == null ? '–' : `${String(Math.round(run.face_ratio * 100))} %`} of frames`,
  );
  for (const w of warnings) console.log(`  ! ${w}`);
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  const generated =
    parsed.camera === 'fake' && !FACE_CLIP && parsed.browsers.some((b) => b !== 'firefox')
      ? writePatternClip()
      : null;
  const opts: Options = { ...parsed, fakeClip: FACE_CLIP ?? generated };
  console.log('bench: building the production app…');
  await build({ root: PACKAGE_ROOT, logLevel: 'warn' });
  const server = await preview({
    root: PACKAGE_ROOT,
    logLevel: 'warn',
    preview: { port: 4175, strictPort: false, open: false },
  });
  const baseURL = server.resolvedUrls?.local[0];
  if (!baseURL) throw new Error('vite preview did not report a URL');

  mkdirSync(OUT_DIR, { recursive: true });
  let failed = 0;
  try {
    for (const name of opts.browsers) {
      console.log(
        `bench: ${name}, ${opts.camera} camera, ${String(opts.warmup)} s warm-up + ${String(opts.seconds)} s…`,
      );
      try {
        const report = await runWithRetry(name, opts, baseURL);
        const day = new Date().toISOString().slice(0, 10);
        const time = new Date().toISOString().slice(11, 16).replace(':', '');
        const cpu = slug(
          (report.run_info as { host: { cpu: string | null } }).host.cpu ?? 'unknown-cpu',
        );
        const camera = (report.run_info as { camera_source: string }).camera_source;
        const file = `${OUT_DIR}${day}_${time}_${cpu}_${name}_${camera}.json`;
        writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
        printSummary(name, report, file.slice(PACKAGE_ROOT.length));
      } catch (error) {
        failed += 1;
        const message = error instanceof Error ? error.message : String(error);
        console.error(`bench: ${name} failed: ${message}`);
        if (
          /Executable doesn't exist|is not found at|distribution .* is not found/i.test(message)
        ) {
          console.error(
            name === 'msedge'
              ? '  Microsoft Edge is not installed on this machine.'
              : `  Install it with: pnpm exec playwright install ${name}`,
          );
        }
      }
    }
  } finally {
    await server.close();
    if (generated) rmSync(generated, { force: true });
  }
  if (failed > 0) process.exit(1);
}

main().catch((error: unknown) => {
  console.error('bench:', error instanceof Error ? error.message : error);
  process.exit(1);
});
