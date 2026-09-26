import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  NOT_FOUND_SOURCE,
  SITE_PAGES,
  pageAt,
  pagePath,
  pageRenderedAt,
  renditionPath,
} from './pages';

describe('a page answers at its folder', () => {
  it.each([
    ['index.html', '/'],
    ['science/index.html', '/science'],
  ])('%s serves at %s', (source, path) => {
    expect(pagePath({ source, hasRendition: false })).toBe(path);
  });

  it('puts a rendition beside the document it renders', () => {
    expect(renditionPath({ source: 'index.html', hasRendition: true })).toBe('/index.md');
    expect(renditionPath({ source: 'science/index.html', hasRendition: true })).toBe(
      '/science/index.md',
    );
    expect(renditionPath({ source: 'index.html', hasRendition: false })).toBeNull();
  });
});

describe('the roster', () => {
  it.each([...SITE_PAGES.map((page) => page.source), NOT_FOUND_SOURCE])(
    'names a page that exists: %s',
    (source) => {
      expect(existsSync(resolve(__dirname, source))).toBe(true);
    },
  );

  it('finds the homepage by its URL and by its rendition’s', () => {
    expect(pageAt('/')?.source).toBe('index.html');
    expect(pageRenderedAt('/index.md')?.source).toBe('index.html');
  });

  it.each(['/app', '/index.html', '/404.html', '/science'])('has no page at %s', (pathname) => {
    expect(pageAt(pathname)).toBeNull();
  });
});
