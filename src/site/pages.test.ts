import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { unstable_readConfig } from 'wrangler';

import {
  NOT_FOUND_SOURCE,
  SITE_PAGES,
  pageAt,
  pagePath,
  pageRenderedAt,
  renditionPath,
  servedPath,
} from './pages';

describe('a page answers at its folder', () => {
  it.each([
    ['index.html', '/'],
    ['science/index.html', '/science'],
  ])('%s serves at %s', (source, path) => {
    expect(pagePath({ source, hasRendition: false })).toBe(path);
  });

  // servedPath spells paths the way this setting serves them; under the
  // default, /science would be a redirect to /science/ and match no page.
  it('matches the html_handling the deploy configures', () => {
    const config = unstable_readConfig({ config: resolve(__dirname, '../../wrangler.toml') });
    expect(config.assets?.html_handling).toBe('drop-trailing-slash');
  });

  it('answers a non-index document at its name, without the extension', () => {
    expect(servedPath(NOT_FOUND_SOURCE)).toBe('/404');
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
