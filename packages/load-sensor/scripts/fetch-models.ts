/**
 * Downloads the third-party model and runtime assets once, at setup time, so the
 * app never fetches them from a third party at runtime (CLAUDE.md invariant 3,
 * ARCHITECTURE.md §10).
 *
 *   pnpm fetch-models                # fetch what is missing, verify everything
 *   pnpm fetch-models --verify       # no network: check local files against the lock
 *   pnpm fetch-models --update-lock  # re-fetch and record new checksums (deliberate upgrade)
 *
 * `public/models/MANIFEST.json` is the lock file and is committed: it records
 * where each file came from and its SHA-256. A file whose checksum differs from
 * the lock is rejected and never written into public/, so a changed upstream
 * model cannot slip into the build unnoticed. The assets themselves are
 * gitignored (see .gitignore).
 *
 * Sources:
 *  - Face detector and attention mesh: the MediaPipe TF.js graph models that
 *    @tensorflow-models/face-landmarks-detection loads by default from tfhub.dev
 *    (now redirected to Kaggle). Apache-2.0.
 *  - TF.js WASM backend binaries: copied from the installed
 *    @tensorflow/tfjs-backend-wasm package, so they always match its JS glue.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = join(PACKAGE_ROOT, 'public');
const MANIFEST_PATH = join(PUBLIC_DIR, 'models', 'MANIFEST.json');
const MANIFEST_SCHEMA = 1;

const DOWNLOAD_TIMEOUT_MS = 120_000;
const DOWNLOAD_ATTEMPTS = 3;
/** Shard names come from a remote model.json; only plain file names are accepted (no paths). */
const SAFE_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

interface FileLock {
  sha256: string;
  bytes: number;
}

interface AssetLock {
  id: string;
  source: string;
  license: string;
  /** Directory relative to public/. */
  dest: string;
  files: Record<string, FileLock>;
}

interface Manifest {
  schema: typeof MANIFEST_SCHEMA;
  note: string;
  assets: AssetLock[];
}

interface AssetSpec {
  id: string;
  source: string;
  license: string;
  dest: string;
  /** Returns every file of the asset as name → bytes. */
  load(): Promise<Map<string, Uint8Array>>;
}

const require = createRequire(import.meta.url);

function tfhubGraphModel(id: string, source: string, dest: string): AssetSpec {
  return {
    id,
    source,
    license: 'Apache-2.0',
    dest,
    async load() {
      const files = new Map<string, Uint8Array>();
      const modelJson = await download(`${source}/model.json?tfjs-format=file`);
      files.set('model.json', modelJson);
      for (const shard of shardNames(modelJson, id)) {
        files.set(shard, await download(`${source}/${shard}?tfjs-format=file`));
      }
      return files;
    },
  };
}

function npmWasmBinaries(): AssetSpec {
  const pkgJsonPath = require.resolve('@tensorflow/tfjs-backend-wasm/package.json');
  const { version } = JSON.parse(readFileSync(pkgJsonPath, 'utf8')) as { version: string };
  const distDir = join(dirname(pkgJsonPath), 'dist');
  const names = [
    'tfjs-backend-wasm.wasm',
    'tfjs-backend-wasm-simd.wasm',
    'tfjs-backend-wasm-threaded-simd.wasm',
  ];
  return {
    id: 'tfjs-backend-wasm',
    source: `npm:@tensorflow/tfjs-backend-wasm@${version}`,
    license: 'Apache-2.0',
    dest: 'wasm',
    async load() {
      const files = new Map<string, Uint8Array>();
      for (const name of names) files.set(name, await readFile(join(distDir, name)));
      return files;
    },
  };
}

const ASSETS: AssetSpec[] = [
  tfhubGraphModel(
    'mediapipe-face-detection-short',
    'https://tfhub.dev/mediapipe/tfjs-model/face_detection/short/1',
    'models/facemesh/detector',
  ),
  tfhubGraphModel(
    'mediapipe-attention-mesh',
    'https://tfhub.dev/mediapipe/tfjs-model/face_landmarks_detection/attention_mesh/1',
    'models/facemesh/landmarks',
  ),
  npmWasmBinaries(),
];

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const verifyOnly = args.has('--verify');
  const updateLock = args.has('--update-lock');
  const unknown = [...args].filter((a) => a !== '--verify' && a !== '--update-lock');
  if (unknown.length > 0 || (verifyOnly && updateLock)) {
    throw new Error(`Usage: fetch-models [--verify | --update-lock] (got ${[...args].join(' ')})`);
  }

  const manifest = await readManifest();
  const problems: string[] = [];
  let lockChanged = false;

  for (const spec of ASSETS) {
    const locked = manifest.assets.find((a) => a.id === spec.id);
    const destDir = join(PUBLIC_DIR, ...spec.dest.split('/'));

    if (!updateLock && locked && (await localFilesMatch(destDir, locked))) {
      console.log(
        `ok       ${spec.id} (${String(Object.keys(locked.files).length)} files, checksums match)`,
      );
      continue;
    }
    if (verifyOnly) {
      problems.push(
        locked
          ? `${spec.id}: local files missing or do not match MANIFEST.json`
          : `${spec.id}: not in MANIFEST.json`,
      );
      continue;
    }

    console.log(`fetch    ${spec.id} from ${spec.source}`);
    const files = await spec.load();
    const fileLocks = Object.fromEntries(
      [...files].map(([name, bytes]) => [name, { sha256: sha256(bytes), bytes: bytes.length }]),
    );

    if (locked && !updateLock) {
      const mismatch = compareLocks(locked.files, fileLocks);
      if (mismatch) {
        problems.push(
          `${spec.id}: ${mismatch}. Upstream changed or the download is corrupt; nothing was written. ` +
            'If the change is intended, rerun with --update-lock and review the diff.',
        );
        continue;
      }
    }

    await writeAtomically(destDir, files);
    const entry: AssetLock = {
      id: spec.id,
      source: spec.source,
      license: spec.license,
      dest: spec.dest,
      files: fileLocks,
    };
    if (!locked || compareLocks(locked.files, fileLocks) || locked.source !== spec.source) {
      manifest.assets = [...manifest.assets.filter((a) => a.id !== spec.id), entry];
      lockChanged = true;
      console.log(`locked   ${spec.id} (${String(Object.keys(fileLocks).length)} files)`);
    } else {
      console.log(`ok       ${spec.id} (fetched, checksums match)`);
    }
  }

  if (lockChanged) {
    manifest.assets.sort(
      (a, b) => ASSETS.findIndex((s) => s.id === a.id) - ASSETS.findIndex((s) => s.id === b.id),
    );
    await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`wrote    ${MANIFEST_PATH}`);
  }

  if (problems.length > 0) {
    for (const p of problems) console.error(`FAIL     ${p}`);
    process.exitCode = 1;
  }
}

async function readManifest(): Promise<Manifest> {
  try {
    const parsed = JSON.parse(await readFile(MANIFEST_PATH, 'utf8')) as { schema?: unknown };
    if (parsed.schema !== MANIFEST_SCHEMA) {
      throw new Error(`Unsupported MANIFEST.json schema ${String(parsed.schema)}`);
    }
    return parsed as Manifest;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return {
      schema: MANIFEST_SCHEMA,
      note: 'Lock file for third-party assets in public/. Written by `pnpm fetch-models`; do not edit by hand.',
      assets: [],
    };
  }
}

async function localFilesMatch(destDir: string, locked: AssetLock): Promise<boolean> {
  for (const [name, lock] of Object.entries(locked.files)) {
    let bytes: Uint8Array;
    try {
      bytes = await readFile(join(destDir, name));
    } catch {
      return false;
    }
    if (bytes.length !== lock.bytes || sha256(bytes) !== lock.sha256) return false;
  }
  return true;
}

/** Describes the first difference between two file locks, or null when identical. */
function compareLocks(
  expected: Record<string, FileLock>,
  actual: Record<string, FileLock>,
): string | null {
  const names = new Set([...Object.keys(expected), ...Object.keys(actual)]);
  for (const name of names) {
    const e = expected[name];
    const a = actual[name];
    if (!e) return `unexpected new file ${name}`;
    if (!a) return `file ${name} is missing upstream`;
    if (e.sha256 !== a.sha256) return `checksum mismatch for ${name}`;
  }
  return null;
}

/** Writes all files into a sibling temp directory, then swaps it in, so a failure never leaves a half-written asset. */
async function writeAtomically(destDir: string, files: Map<string, Uint8Array>): Promise<void> {
  const tmpDir = `${destDir}.tmp-${String(process.pid)}`;
  await rm(tmpDir, { recursive: true, force: true });
  await mkdir(tmpDir, { recursive: true });
  for (const [name, bytes] of files) {
    if (!SAFE_FILE_NAME.test(name)) throw new Error(`Refusing unsafe file name ${name}`);
    await writeFile(join(tmpDir, name), bytes);
  }
  await rm(destDir, { recursive: true, force: true });
  await mkdir(dirname(destDir), { recursive: true });
  await rename(tmpDir, destDir);
}

function shardNames(modelJson: Uint8Array, id: string): string[] {
  const parsed = JSON.parse(new TextDecoder().decode(modelJson)) as {
    format?: string;
    weightsManifest?: { paths?: string[] }[];
  };
  if (parsed.format !== 'graph-model' || !Array.isArray(parsed.weightsManifest)) {
    throw new Error(`${id}: model.json is not a TF.js graph model`);
  }
  const names = parsed.weightsManifest.flatMap((group) => group.paths ?? []);
  for (const name of names) {
    if (!SAFE_FILE_NAME.test(name)) throw new Error(`${id}: unsafe shard path ${name}`);
  }
  return names;
}

async function download(url: string): Promise<Uint8Array> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`HTTP ${String(response.status)} for ${url}`);
      return new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
      if (attempt < DOWNLOAD_ATTEMPTS) console.warn(`retry    ${url} (${String(error)})`);
    }
  }
  throw lastError;
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
