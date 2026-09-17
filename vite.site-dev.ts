/** Dev-only document routing: one `pnpm run dev` answers every path the deploy does. */

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { Plugin } from 'vite';

import { markdownRendition as renderMarkdown } from './scripts/site/markdown-rendition.ts';
import { APP_PATH, legacyShareRedirect } from './src/client/util/url-state/share-path-pure.ts';
import {
  MARKDOWN_TYPE,
  markdownRendition,
  prefersMarkdown,
  wantsDocument,
} from './src/negotiation-pure.ts';

function ownedByApp(pathname: string): boolean {
  return pathname === APP_PATH || pathname.startsWith(`${APP_PATH}/`);
}

export type DevRoute =
  | { kind: 'redirect'; to: string }
  | { kind: 'document'; doc: 'app' | 'home' | 'notFound' };

/**
 * The rules `src/worker.ts` answers in production, in its order. Reads
 * `legacyShareRedirect` rather than restating the share grammar.
 */
export function devRoute(pathname: string, search: string): DevRoute {
  const legacy = legacyShareRedirect(pathname, search);
  if (legacy !== null) return { kind: 'redirect', to: legacy };
  if (ownedByApp(pathname)) return { kind: 'document', doc: 'app' };
  if (pathname === '/') return { kind: 'document', doc: 'home' };
  return { kind: 'document', doc: 'notFound' };
}

/** A third relative reference needs the same treatment — `src/client/app/README.md`. */
const SIBLING_OF_ROOT = /(src|href)="\.\.\//g;

/** Requires `appType: 'custom'`. `src/site/README.md` § Reading it in dev. */
export function documentRoutingInDev(repoRoot: string): Plugin {
  const appDoc = resolve(repoRoot, 'src/client/app/index.html');
  const siteDir = resolve(repoRoot, 'src/site');
  // Outside this server's root, so the filesystem route is the only way in.
  const stylesheet = `/@fs${resolve(siteDir, 'site.css')}`;

  // `base` is what Vite resolves a document's own relative imports against.
  const documents = {
    app: { file: appDoc, base: '/app/index.html', status: 200 },
    home: { file: resolve(siteDir, 'index.html'), base: '/index.html', status: 200 },
    notFound: { file: resolve(siteDir, '404.html'), base: '/404.html', status: 404 },
  } as const;

  return {
    name: 'stellata:document-routing-in-dev',
    apply: 'serve',
    configureServer(server) {
      // Not Vite's own html reload: src/site/README.md § Reading it in dev.
      server.watcher.add(siteDir);
      server.watcher.on('change', (file) => {
        if (dirname(file) === siteDir && file.endsWith('.html')) {
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

          const { file, base, status } = documents[route.doc];
          const rendition = markdownRendition(pathname);

          try {
            const raw = await readFile(file, 'utf8');

            // The derivation the build uses, so an edit shows without one.
            if (rendition !== null && prefersMarkdown(accept)) {
              res.statusCode = status;
              res.setHeader('Content-Type', MARKDOWN_TYPE);
              res.setHeader('Vary', 'Accept');
              res.end(renderMarkdown(raw));
              return;
            }

            const html = await server.transformIndexHtml(
              base,
              raw.replaceAll('./site.css', stylesheet).replace(SIBLING_OF_ROOT, '$1="/'),
              req.originalUrl,
            );
            res.statusCode = status;
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            if (rendition !== null) {
              res.setHeader('Link', `<${rendition}>; rel="alternate"; type="text/markdown"`);
              res.setHeader('Vary', 'Accept');
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
