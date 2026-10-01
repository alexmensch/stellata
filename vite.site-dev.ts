/** Dev-only document routing: one `pnpm run dev` answers every path the deploy does. */

import { readFile } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import { dirname, resolve, sep } from 'node:path';
import type { Plugin } from 'vite';

import { LLMS_TXT_PATH, builtLlmsTxt } from './scripts/site/llms-txt.ts';
import { markdownRendition } from './scripts/site/markdown-rendition.ts';
import { fillPageMeta } from './scripts/site/page-meta-pure.ts';
import { MARKDOWN_TYPE, alternateLink, varyWithAccept, wantsDocument } from './src/negotiation-pure.ts';
import { canonicalLink, negotiatedRendition, route as decide, type Route } from './src/routing-pure.ts';
import { NOT_FOUND_SOURCE } from './src/site/pages.ts';
import type { Figures } from './scripts/site/figures-pure.ts';

function varyOnAccept(res: ServerResponse): void {
  const current = res.getHeader('Vary');
  res.setHeader('Vary', varyWithAccept(current === undefined ? null : [current].flat().join(', ')));
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
export function documentRoutingInDev(repoRoot: string, figures: Figures): Plugin {
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
  const documentFor = (route: Exclude<Route, { kind: 'redirect' }>): Document => {
    switch (route.kind) {
      case 'app':
        return appDocument;
      case 'page':
      case 'rendition':
        return siteDocument(route.page.source, 200);
      case 'notFoundPage':
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

      server.middlewares.use((req, res, next) => {
        if ((req.method !== 'GET' && req.method !== 'HEAD') || new URL(req.url ?? '/', 'http://dev').pathname !== LLMS_TXT_PATH) {
          next();
          return;
        }
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end(builtLlmsTxt(siteDir));
      });

      // Post-hook: runs after Vite's own middlewares, so only documents reach it.
      return () => {
        server.middlewares.use(async (req, res, next) => {
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            next();
            return;
          }
          const { pathname, search } = new URL(req.url ?? '/', 'http://dev');
          const route = decide(pathname, search);

          // Answered ahead of the Accept gate, matching the Worker.
          if (route.kind === 'redirect') {
            res.statusCode = route.status;
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
          const advertised = route.kind === 'page' ? route.rendition : null;

          try {
            const source = await readFile(file, 'utf8');
            const raw = route.kind === 'page' ? fillPageMeta(source, file) : source;

            // The derivation the build uses, so an edit shows without one.
            if (route.kind === 'rendition' || negotiatedRendition(route, accept) !== null) {
              res.statusCode = status;
              res.setHeader('Content-Type', MARKDOWN_TYPE);
              if (route.kind === 'page' || route.kind === 'rendition') {
                res.setHeader('Link', canonicalLink(route.page));
              }
              if (advertised !== null) varyOnAccept(res);
              res.end(markdownRendition(raw, figures));
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
            if (advertised !== null) {
              res.setHeader('Link', alternateLink(advertised));
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
