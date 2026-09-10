import { describe, it, expect } from 'vitest';
import {
  APP_PATH,
  buildSharePath,
  legacyShareRedirect,
  parseLegacySharePath,
  parseSharePath,
  pickShareBlob,
} from './share-path-pure';

describe('buildSharePath', () => {
  it('wraps the blob in /app/v/<blob>/ with a trailing slash', () => {
    expect(buildSharePath('AQAA')).toBe('/app/v/AQAA/');
  });

  it('builds under the app path rather than the site root', () => {
    expect(buildSharePath('AQAA').startsWith(`${APP_PATH}/`)).toBe(true);
  });
});

describe('parseSharePath', () => {
  it('parses the canonical trailing-slash form', () => {
    expect(parseSharePath('/app/v/AQAA/')).toBe('AQAA');
  });

  it('parses without a trailing slash', () => {
    expect(parseSharePath('/app/v/AQAA')).toBe('AQAA');
  });

  it('accepts the full base64url alphabet (- and _)', () => {
    expect(parseSharePath('/app/v/aZ0-_9/')).toBe('aZ0-_9');
  });

  it('round-trips buildSharePath output', () => {
    const blob = 'BAECaGVsbG8-_w';
    expect(parseSharePath(buildSharePath(blob))).toBe(blob);
  });

  it.each([
    ['/'],
    ['/app'],
    ['/foo'],
    ['/app/v/'],
    ['/app/v'],
    ['/app/v/bad!chars/'],
    ['/app/v/AQAA/extra'],
    ['/prefix/app/v/AQAA/'],
    // The root-relative form is legacy, not canonical — it must not parse
    // here, or nothing would trigger the rewrite to the canonical path.
    ['/v/AQAA/'],
  ])('returns null for non-canonical share path %s', (pathname) => {
    expect(parseSharePath(pathname)).toBeNull();
  });
});

describe('parseLegacySharePath', () => {
  it('parses the root-relative form the app used before it moved to /app', () => {
    expect(parseLegacySharePath('/v/AQAA/')).toBe('AQAA');
    expect(parseLegacySharePath('/v/AQAA')).toBe('AQAA');
  });

  it('does not also swallow the canonical form', () => {
    expect(parseLegacySharePath('/app/v/AQAA/')).toBeNull();
  });
});

describe('pickShareBlob', () => {
  it('reads the canonical path form and flags no legacy transport', () => {
    expect(pickShareBlob('/app/v/AQAA/', '')).toEqual({ blob: 'AQAA', legacyTransport: false });
  });

  it('reads the legacy root-relative path and flags it', () => {
    expect(pickShareBlob('/v/AQAA/', '')).toEqual({ blob: 'AQAA', legacyTransport: true });
  });

  it('reads the legacy ?v= query and flags it', () => {
    expect(pickShareBlob('/', '?v=AQAA')).toEqual({ blob: 'AQAA', legacyTransport: true });
  });

  it('prefers the canonical path over either legacy transport', () => {
    expect(pickShareBlob('/app/v/PATH/', '?v=QUERY')).toEqual({
      blob: 'PATH',
      legacyTransport: false,
    });
  });

  it('prefers the legacy path over the legacy query', () => {
    expect(pickShareBlob('/v/PATH/', '?v=QUERY')).toEqual({
      blob: 'PATH',
      legacyTransport: true,
    });
  });

  it('falls back to the query when the path carries no blob', () => {
    expect(pickShareBlob('/garbage', '?v=AQAA')).toEqual({
      blob: 'AQAA',
      legacyTransport: true,
    });
  });

  it('returns a null blob when nothing carries state', () => {
    expect(pickShareBlob('/garbage', '')).toEqual({ blob: null, legacyTransport: false });
    expect(pickShareBlob('/', '')).toEqual({ blob: null, legacyTransport: false });
    expect(pickShareBlob('/app', '')).toEqual({ blob: null, legacyTransport: false });
  });
});

describe('legacyShareRedirect', () => {
  it('moves a root-relative share path under the app path', () => {
    expect(legacyShareRedirect('/v/AQAA/', '')).toBe('/app/v/AQAA/');
    expect(legacyShareRedirect('/v/AQAA', '')).toBe('/app/v/AQAA');
  });

  it('carries the query along', () => {
    expect(legacyShareRedirect('/v/AQAA/', '?utm=x')).toBe('/app/v/AQAA/?utm=x');
  });

  // An undecodable blob still has to land on the app, which strips the bar
  // itself — the redirect does not parse the blob out.
  it('redirects a malformed blob rather than dropping it', () => {
    expect(legacyShareRedirect('/v/not!valid/', '')).toBe('/app/v/not!valid/');
    expect(legacyShareRedirect('/v', '')).toBe('/app/v');
  });

  it('moves a legacy ?v= query off the homepage and onto the app', () => {
    expect(legacyShareRedirect('/', '?v=AQAA')).toBe('/app/?v=AQAA');
  });

  it.each([
    ['/', ''],
    ['/', '?utm=x'],
    ['/app', ''],
    ['/app/v/AQAA/', ''],
    ['/science', ''],
    ['/vintage', ''],
    ['/og-image.jpg', ''],
  ])('leaves %s%s alone', (pathname, search) => {
    expect(legacyShareRedirect(pathname, search)).toBeNull();
  });
});
