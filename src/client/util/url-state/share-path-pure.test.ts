import { describe, it, expect } from 'vitest';
import { buildSharePath, parseSharePath } from './share-path-pure';

describe('buildSharePath', () => {
  it('wraps the blob in /v/<blob>/ with a trailing slash', () => {
    expect(buildSharePath('AQAA')).toBe('/v/AQAA/');
  });
});

describe('parseSharePath', () => {
  it('parses the canonical trailing-slash form', () => {
    expect(parseSharePath('/v/AQAA/')).toBe('AQAA');
  });

  it('parses without a trailing slash', () => {
    expect(parseSharePath('/v/AQAA')).toBe('AQAA');
  });

  it('accepts the full base64url alphabet (- and _)', () => {
    expect(parseSharePath('/v/aZ0-_9/')).toBe('aZ0-_9');
  });

  it('round-trips buildSharePath output', () => {
    const blob = 'BAECaGVsbG8-_w';
    expect(parseSharePath(buildSharePath(blob))).toBe(blob);
  });

  it.each([
    ['/'],
    ['/foo'],
    ['/v/'],
    ['/v'],
    ['/v/bad!chars/'],
    ['/v/AQAA/extra'],
    ['/prefix/v/AQAA/'],
  ])('returns null for non-share path %s', (pathname) => {
    expect(parseSharePath(pathname)).toBeNull();
  });
});
