import { describe, expect, it } from 'vitest';
import {
  csvField,
  npyHeader,
  parseExpwLine,
  parseRafBox,
  resampleCrop,
  squareCrop,
} from '../../../scripts/extract-landmarks-lib.js';

describe('extract-landmarks-lib (TODO P1)', () => {
  it('squareCrop centres a square on the box, longer side plus the margin on each side', () => {
    expect(squareCrop({ x1: 100, y1: 50, x2: 200, y2: 250 }, 0.25)).toEqual({
      x: 0,
      y: 0,
      size: 300,
    });
    expect(squareCrop({ x1: 10, y1: 10, x2: 30, y2: 20 }, 0)).toEqual({ x: 10, y: 5, size: 20 });
  });

  it('resampleCrop at scale 1 copies RGB exactly and drops alpha', () => {
    const data = Uint8Array.from([10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255, 1, 2, 3, 255]);
    const out = resampleCrop(
      { data, width: 2, height: 2, channels: 4 },
      { x: 0, y: 0, size: 2 },
      2,
    );
    expect(Array.from(out)).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90, 1, 2, 3]);
  });

  it('resampleCrop pads with black outside the image instead of shifting the crop', () => {
    const data = new Uint8Array(4).fill(200);
    const out = resampleCrop(
      { data, width: 2, height: 2, channels: 1 },
      { x: -2, y: 0, size: 4 },
      4,
    );
    // Columns 0–1 lie left of the image, 2–3 inside; rows 2–3 lie below it.
    const row0 = Array.from(out.subarray(0, 12)).filter((_, i) => i % 3 === 0);
    expect(row0).toEqual([0, 0, 200, 200]);
    expect(Array.from(out.subarray(3 * 12, 4 * 12)).every((v) => v === 0)).toBe(true);
  });

  it('resampleCrop upscales grayscale to RGB with bilinear values between the neighbours', () => {
    const data = Uint8Array.from([0, 100, 0, 100]);
    const out = resampleCrop(
      { data, width: 2, height: 2, channels: 1 },
      { x: 0, y: 0, size: 2 },
      4,
    );
    // Output row 1 lies between the two (identical) source rows, so only x blends.
    const row1 = out.subarray(12, 24);
    const red = Array.from(row1).filter((_, i) => i % 3 === 0);
    expect(red[1]).toBeCloseTo(25);
    expect(red[2]).toBeCloseTo(75);
    // The outer columns blend with the black padding.
    expect(red[3]).toBeCloseTo(75);
    expect(row1[3]).toBe(row1[4]);
  });

  it('npyHeader writes a valid v1.0 header padded to 64 bytes', () => {
    const h = npyHeader([2, 478, 3]);
    expect(h.length % 64).toBe(0);
    expect(Array.from(h.subarray(0, 8))).toEqual([0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59, 1, 0]);
    expect(new DataView(h.buffer).getUint16(8, true)).toBe(h.length - 10);
    const dict = new TextDecoder().decode(h.subarray(10));
    expect(dict).toMatch(
      /^\{'descr': '<f4', 'fortran_order': False, 'shape': \(2, 478, 3\), \} *\n$/,
    );
    expect(new TextDecoder().decode(npyHeader([5]).subarray(10))).toContain("'shape': (5,)");
  });

  it('parses ExpW label lines (top left right bottom order) and RAF-DB boxes', () => {
    expect(parseExpwLine('angry_actor_104.jpg 0 28 113 226 141 22.9362 0')).toEqual({
      name: 'angry_actor_104.jpg',
      face: '0',
      box: { x1: 113, y1: 28, x2: 226, y2: 141 },
      label: '0',
    });
    expect(parseRafBox('153.841080 130.382935 327.412231 355.140106 \n')).toEqual({
      x1: 153.84108,
      y1: 130.382935,
      x2: 327.412231,
      y2: 355.140106,
    });
    expect(() => parseExpwLine('broken line')).toThrow();
  });

  it('csvField quotes only fields that need it', () => {
    expect(csvField('a.jpg')).toBe('a.jpg');
    expect(csvField(3)).toBe('3');
    expect(csvField('a,b "c"')).toBe('"a,b ""c"""');
  });
});
