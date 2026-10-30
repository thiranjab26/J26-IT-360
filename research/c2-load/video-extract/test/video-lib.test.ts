import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { EXCLUDED_CLIPS, FrameSplitter, listClips, parseLabelIds } from '../src/video-lib.js';

test('FrameSplitter cuts an arbitrarily chunked stream into whole frames', () => {
  const s = new FrameSplitter(2, 1); // 6 bytes per frame
  const stream = Buffer.from([...Array(15).keys()]);
  const out = [
    ...s.push(stream.subarray(0, 4)),
    ...s.push(stream.subarray(4, 13)),
    ...s.push(stream.subarray(13)),
  ];
  assert.equal(out.length, 2);
  assert.deepEqual([...(out[0] ?? [])], [0, 1, 2, 3, 4, 5]);
  assert.deepEqual([...(out[1] ?? [])], [6, 7, 8, 9, 10, 11]);
  assert.equal(s.leftover, 3);
});

test('FrameSplitter frames are copies, not views into reused buffers', () => {
  const s = new FrameSplitter(1, 1);
  const chunk = Buffer.from([1, 2, 3]);
  const [frame] = s.push(chunk);
  chunk.fill(9);
  assert.deepEqual([...(frame ?? [])], [1, 2, 3]);
});

test('parseLabelIds reads ClipIDs with or without extension and CRLF', () => {
  const csv = 'ClipID,Boredom,Engagement,Confusion,Frustration \r\n1100011002.avi,0,2,0,0\r\n5000441001.mp4,1,2,0,0\r\n';
  assert.deepEqual(parseLabelIds(csv), ['1100011002', '5000441001']);
  assert.throws(() => parseLabelIds('Clip,Boredom\nx,0\n'), /unexpected DAiSEE label header/);
});

test('listClips lists labelled clips per split, skips the excluded one, and needs a file for each', async () => {
  const root = await mkdtemp(join(tmpdir(), 'daisee-'));
  const excluded = [...EXCLUDED_CLIPS][0] ?? '';
  const put = async (split: string, subject: string, id: string, ext: string): Promise<void> => {
    await mkdir(join(root, 'DataSet', split, subject, id), { recursive: true });
    await writeFile(join(root, 'DataSet', split, subject, id, `${id}${ext}`), '');
  };
  await mkdir(join(root, 'Labels'));
  await mkdir(join(root, 'DataSet', 'Test'), { recursive: true });
  const header = 'ClipID,Boredom,Engagement,Confusion,Frustration\n';
  await writeFile(join(root, 'Labels', 'TrainLabels.csv'), `${header}b.avi,0,2,0,0\na.avi,0,2,0,0\n${excluded}.avi,0,2,0,0\n`);
  await writeFile(join(root, 'Labels', 'ValidationLabels.csv'), `${header}v.mp4,1,2,0,0\n`);
  await writeFile(join(root, 'Labels', 'TestLabels.csv'), header);
  await put('Train', 's1', 'a', '.avi');
  await put('Train', 's2', 'b', '.avi');
  await put('Train', 's2', excluded, '.avi');
  await put('Train', 's2', 'unlabelled', '.avi');
  await put('Validation', 's3', 'v', '.mp4');

  const clips = await listClips(root);
  assert.deepEqual(
    clips.map((c) => [c.index, c.id, c.split, c.subject]),
    [
      [0, 'a', 'Train', 's1'],
      [1, 'b', 'Train', 's2'],
      [2, 'v', 'Validation', 's3'],
    ],
  );

  await writeFile(join(root, 'Labels', 'TestLabels.csv'), `${header}missing.avi,0,2,0,0\n`);
  await assert.rejects(listClips(root), /Test label missing has no video file/);
});
