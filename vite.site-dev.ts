/** Dev-only document routing: one `pnpm run dev` answers every path the deploy does. */

import { readFile } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import { dirname, resolve, sep } from 'node:path';
import type { Plugin } from 'vite';

import { markdownRendition as renderMarkdown } from './scripts/site/markdown-rendition.ts';
import { legacyShareRedirect, ownedByApp } from './src/client/util/url-state/share-path-pure.ts';
import {
  MARKDOWN_TYPE,
  alternateLink,
  markdownRendition,
  prefersMarkdown,
  varyWithAccept,
  wantsDocument,
} from './src/negotiation-pure.ts';
import { NOT_FOUND_SOURCE, pageAt, pageRenderedAt, type SitePage } from './src/site/pages.ts';

function varyOnAccept(res: ServerResponse): void {
  const current = res.getHeader('Vary');
  res.setHeader('Vary', varyWithAccept(current === undefined ? null : [current].flat().join(', ')));
}

export type DevRoute =
  | { kind: 'redirect'; to: string }
  | { kind: 'app' }
  | { kind: 'page'; page: SitePage }
  | { kind: 'rendition'; page: SitePage }
  | { kind: 'notFound' };

/**
 * The rules `src/worker.ts` answers in production, in its order, plus the
 * rendition files the deploy serves as plain assets.
 */
export function devRoute(pathname: string, search: string): DevRoute {
  const legacy = legacyShareRedirect(pathname, search);
  if (legacy !== null) return { kind: 'redirect', to: legacy };
  if (ownedByApp(pathname)) return { kind: 'app' };
  const page = pageAt(pathname);
  if (page !== null) return { kind: 'page', page };
  const rendered = pageRenderedAt(pathname);
  if (rendered !== null) return { kind: 'rendition', page: rendered };
  return { kind: 'notFound' };
}

interface Document {
  file: string;
  /** What Vite resolves the document's own relative imports against. */
  base: string;
  status: number;
  site: boolean;
}

/** A third relative reference needs the same treatment — `src/client/app/README.md`. */
const SIBLING_OF_ROOT = /(src|href)="\.\.\//g;
const SIBLING_OF_PAGE = /(src|href)="\.\//g;

/** Requires `appType: 'custom'`. src/site/README.md#reading-it-in-dev. */
export function documentRoutingInDev(repoRoot: string): Plugin {
  const siteDir = resolve(repoRoot, 'src/site');
  const appDocument: Document = {
    file: resolve(repoRoot, 'src/client/app/index.html'),
    base: '/app/index.html',
    status: 200,
    site: false,
  };
  const siteDocument = (source: string, status: number): Document => ({
    file: resolve(siteDir, source),
    base: `/${source}`,
    status,
    site: true,
  });
  const documentFor = (route: Exclude<DevRoute, { kind: 'redirect' }>): Document => {
    switch (route.kind) {
      case 'app':
        return appDocument;
      case 'page':
      case 'rendition':
        return siteDocument(route.page.source, 200);
      case 'notFound':
        return siteDocument(NOT_FOUND_SOURCE, 404);
    }
  };

  return {
    name: 'stellata:document-routing-in-dev',
    apply: 'serve',
    configureServer(server) {
      // Not Vite's own html reload: src/site/README.md#reading-it-in-dev.
      server.watcher.add(siteDir);
      server.watcher.on('change', (file) => {
        if (file.startsWith(siteDir + sep) && file.endsWith('.html')) {
          server.hot.send({ type: 'full-reload', path: '*' });
        }
      });

      // Post-hook: runs after Vite's own middlewares, so only documents reach it.
      return () => {
        server.middlewares.use(async (req, res, next) => {
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            next();
            return;
          }
          const [pathname, query] = (req.url ?? '/').split('?');
          const route = devRoute(pathname, query === undefined ? '' : `?${query}`);

          // Answered ahead of the Accept gate, matching the Worker.
          if (route.kind === 'redirect') {
            res.statusCode = 301;
            res.setHeader('Location', route.to);
            res.end();
            return;
          }
          const accept = req.headers.accept ?? null;
          if (!wantsDocument(accept)) {
            next();
            return;
          }

          const { file, base, status, site } = documentFor(route);
          const rendition = markdownRendition(pathname);

          try {
            const raw = await readFile(file, 'utf8');

            // The derivation the build uses, so an edit shows without one.
            if (route.kind === 'rendition' || (rendition !== null && prefersMarkdown(accept))) {
              res.statusCode = status;
              res.setHeader('Content-Type', MARKDOWN_TYPE);
              if (rendition !== null) varyOnAccept(res);
              res.end(renderMarkdown(raw));
              return;
            }

            const html = await server.transformIndexHtml(
              base,
              // Outside this server's root, so the filesystem route is the only way in.
              (site ? raw.replace(SIBLING_OF_PAGE, `$1="/@fs${dirname(file)}/`) : raw).replace(
                SIBLING_OF_ROOT,
                '$1="/',
              ),
              req.originalUrl,
            );
            res.statusCode = status;
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            if (rendition !== null) {
              res.setHeader('Link', alternateLink(rendition));
              varyOnAccept(res);
            }
            res.end(html);
          } catch (err) {
            next(err);
          }
        });
      };
    },
  };
}
