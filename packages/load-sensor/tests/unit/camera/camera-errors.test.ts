import { describe, expect, it } from 'vitest';
import { classifyCameraError } from '../../../src/core/camera/index.js';
import { domException } from '../helpers/fake-media.js';

describe('classifyCameraError', () => {
  it.each([
    ['NotAllowedError', 'permission_denied'],
    ['PermissionDeniedError', 'permission_denied'],
    ['SecurityError', 'permission_denied'],
    ['NotFoundError', 'no_camera'],
    ['DevicesNotFoundError', 'no_camera'],
    ['OverconstrainedError', 'no_camera'],
    ['NotReadableError', 'camera_in_use'],
    ['TrackStartError', 'camera_in_use'],
    ['AbortError', 'camera_in_use'],
    ['UnknownThing', 'error'],
  ] as const)('%s → %s', (name, status) => {
    expect(classifyCameraError(domException(name, 'msg'))).toEqual({
      status,
      name,
      message: 'msg',
    });
  });

  it('maps a TypeError to unsupported', () => {
    expect(classifyCameraError(new TypeError('bad constraints')).status).toBe('unsupported');
  });

  it('handles non-Error values', () => {
    expect(classifyCameraError('nope')).toEqual({
      status: 'error',
      name: 'UnknownError',
      message: 'nope',
    });
    expect(classifyCameraError({ name: 'NotAllowedError' }).status).toBe('permission_denied');
  });
});
