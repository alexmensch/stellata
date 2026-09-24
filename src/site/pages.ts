/** Every page the site builds, and the URLs each one answers at. README.md § A page's path is its folder. */

export interface SitePage {
  /** Relative to `src/site/`; its folder is its URL. */
  readonly source: string;
  readonly hasRendition: boolean;
}

export const SITE_PAGES: readonly SitePage[] = [{ source: 'index.html', hasRendition: true }];

/** Served with a 404 status for every unmatched path; answers at no URL of its own. */
export const NOT_FOUND_SOURCE = '404.html';

export function pagePath(page: SitePage): string {
  const folder = page.source.replace(/(^|\/)index\.html$/, '');
  return `/${folder}`;
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
