/**
 * Study-session exports → per-second features for training (TODO C1).
 *
 *   pnpm session-to-features <export.json>… [--out=data/study-features]
 *
 * For each `c2-study-P0x-….json` from the study page, writes into `--out`:
 *
 *   <name>.raw.npy        [S, F] raw per-second features (FEATURES order)
 *   <name>.z.npy          [S, F] baseline z-scores, NaN while calibrating
 *   <name>.seconds.csv    second, start_ms, block, kind, pure, valid, valid_ratio
 *   <name>.meta.json      participant, block order, NASA-TLX and extra answers,
 *                         SUS, feature names, code hashes
 *
 * `research/c2-load/training/sessions.py` turns these into 30 s windows.
 * Participant data: `--out` defaults to the gitignored `data/` (invariant 7).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { FEATURE_COUNT, FEATURE_NAMES } from '../src/core/features/spec.js';
import type { SessionExport } from '../src/core/recorder/index.js';
import { npyHeader } from './extract-landmarks-lib.js';
import { buildFeatureSpec } from './feature-spec-lib.js';
import { featureMatrix, replaySession } from './session-to-features-lib.js';

function npy(data: Float32Array, shape: readonly number[]): Buffer {
  return Buffer.concat([
    Buffer.from(npyHeader(shape)),
    Buffer.from(data.buffer, data.byteOffset, data.byteLength),
  ]);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const files = argv.filter((a) => !a.startsWith('--'));
  if (files.length === 0) throw new Error('usage: session-to-features <export.json>… [--out=…]');
  const out =
    argv.find((a) => a.startsWith('--out='))?.slice('--out='.length) ?? 'data/study-features';
  await mkdir(out, { recursive: true });
  const spec = JSON.parse(await buildFeatureSpec()) as { code_hash: string };

  for (const file of files) {
    const session = JSON.parse(await readFile(file, 'utf8')) as SessionExport;
    if (session.featureCodeHash !== spec.code_hash) {
      // Not an error: replaying with today's feature code is the point of
      // keeping per-frame signals. Recorded so the report can say which code ran.
      console.warn(
        `${file}: recorded with feature code ${session.featureCodeHash.slice(0, 12)}…, replayed with ${spec.code_hash.slice(0, 12)}…`,
      );
    }
    const rows = replaySession(session);
    const name = basename(file).replace(/\.json$/, '');
    const s = rows.length;
    await writeFile(
      join(out, `${name}.raw.npy`),
      npy(featureMatrix(rows, 'raw'), [s, FEATURE_COUNT]),
    );
    await writeFile(join(out, `${name}.z.npy`), npy(featureMatrix(rows, 'z'), [s, FEATURE_COUNT]));
    const csv = [
      'second,start_ms,block,kind,pure,valid,valid_ratio',
      ...rows.map((r) =>
        [
          r.second,
          r.startMs.toFixed(1),
          r.block,
          r.kind ?? '',
          r.pure ? 1 : 0,
          r.valid ? 1 : 0,
          r.validRatio.toFixed(3),
        ].join(','),
      ),
    ];
    await writeFile(join(out, `${name}.seconds.csv`), `${csv.join('\n')}\n`);
    const meta = {
      source: basename(file),
      participant: session.participant,
      latin_row: session.latinRow,
      order: session.order,
      blocks: session.blocks.map((b) => ({
        index: b.index,
        kind: b.kind,
        planned_s: b.plannedS,
        started_at: b.startedAt,
        ended_at: b.endedAt,
        tlx: b.tlx,
        raw_tlx: b.rawTlx,
        extra: b.extra,
      })),
      sus: session.sus,
      finished: session.finishedAt !== null,
      features: FEATURE_NAMES,
      recorded_code_hash: session.featureCodeHash,
      replayed_code_hash: spec.code_hash,
      seconds: s,
    };
    await writeFile(join(out, `${name}.meta.json`), `${JSON.stringify(meta, null, 2)}\n`);
    const valid = rows.filter((r) => r.valid && r.z !== null).length;
    console.log(`${name}: ${String(s)} seconds, ${String(valid)} valid after calibration → ${out}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
