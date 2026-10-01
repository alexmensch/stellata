/** Every page the site builds, and the URLs each one answers at. README.md#a-pages-path-is-its-folder-and-that-is-what-serves-the-url. */

export interface SitePage {
  /** Relative to `src/site/`; its folder is its URL. */
  readonly source: string;
  readonly hasRendition: boolean;
}

export const SITE_PAGES: readonly SitePage[] = [{ source: 'index.html', hasRendition: true }];

/** Served with a 404 status for every unmatched path, and at its own path too. */
export const NOT_FOUND_SOURCE = '404.html';

/** The template `/llms.txt` is built from; its summary is the homepage's meta description. */
export const LLMS_TXT_SOURCE = 'llms.txt';

/** Where a built HTML file answers under `html_handling = "drop-trailing-slash"`. */
export function servedPath(source: string): string {
  return `/${source.replace(/(^|\/)index\.html$/, '').replace(/\.html$/, '')}`;
}

export function pagePath(page: SitePage): string {
  return servedPath(page.source);
}

/** Beside the document it renders, so the built tree still mirrors the URL space. */
export function renditionPath(page: SitePage): string | null {
  return page.hasRendition ? `/${page.source.replace(/\.html$/, '.md')}` : null;
}

export function pageAt(pathname: string): SitePage | null {
  return SITE_PAGES.find((page) => pagePath(page) === pathname) ?? null;
}

export function pageRenderedAt(pathname: string): SitePage | null {
  return SITE_PAGES.find((page) => renditionPath(page) === pathname) ?? null;
}
