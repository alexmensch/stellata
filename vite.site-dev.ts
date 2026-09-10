/**
 * Dev-only document routing, so one `pnpm run dev` answers the same paths the
 * deploy does: the app at /app, the homepage at /, its markdown rendition to
 * a client that asks for one, the 404 page for the rest, and a 301 off either
 * legacy share transport.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
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
 * The four rules `src/worker.ts` answers in production, in its order. Both
 * read `legacyShareRedirect` rather than restating the share grammar: a dev
 * server that 404s a link the deploy redirects is a bug nobody sees until
 * someone pastes a real share URL.
 */
export function devRoute(pathname: string, search: string): DevRoute {
  const legacy = legacyShareRedirect(pathname, search);
  if (legacy !== null) return { kind: 'redirect', to: legacy };
  if (ownedByApp(pathname)) return { kind: 'document', doc: 'app' };
  if (pathname === '/') return { kind: 'document', doc: 'home' };
  return { kind: 'document', doc: 'notFound' };
}

/**
 * The app document's own `../main.ts` and `../styles.css`. The build rewrites
 * these to hashed absolute URLs; dev serves the file as authored, so the
 * browser resolves them against whatever URL it is on — and on a share link
 * (`/app/v/<blob>/`) that is three levels deep, where `../main.ts` is
 * nothing. Root-absolute is correct from every depth.
 */
const SIBLING_OF_ROOT = /(src|href)="\.\.\//g;

/**
 * Requires `appType: 'custom'` on the config that installs it. Vite's own
 * html fallback rewrites an unmatched path to `/index.html` *before* a
 * plugin's middleware runs, which made every wrong URL — and `/app` itself —
 * serve the homepage; `'custom'` is how Vite hands document routing over
 * rather than guessing.
 */
export function documentRoutingInDev(repoRoot: string): Plugin {
  const appDoc = resolve(repoRoot, 'src/client/app/index.html');
  const siteDir = resolve(repoRoot, 'src/site');
  // Each site page's stylesheet is its sibling, outside this server's root
  // (`src/client`), so it is reached through Vite's filesystem route instead.
  // `server.fs.allow` already covers the repo.
  const stylesheet = `/@fs${resolve(siteDir, 'site.css')}`;

  // `base` is the root-relative URL Vite resolves a document's own relative
  // imports against, so the app document's `../main.ts` lands on
  // `src/client/main.ts`.
  const documents = {
    app: { file: appDoc, base: '/app/index.html', status: 200 },
    home: { file: resolve(siteDir, 'index.html'), base: '/index.html', status: 200 },
    notFound: { file: resolve(siteDir, '404.html'), base: '/404.html', status: 404 },
  } as const;

  return {
    name: 'stellata:document-routing-in-dev',
    apply: 'serve',
    configureServer(server) {
      // Post-hook form: installed after Vite's own middlewares, so real files
      // — `public/` artifacts, `/@fs` and `/@vite` routes, source modules —
      // are served first and only documents reach this.
      return () => {
        server.middlewares.use(async (req, res, next) => {
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            next();
            return;
          }
          const [pathname, query] = (req.url ?? '/').split('?');
          const route = devRoute(pathname, query === undefined ? '' : `?${query}`);

          // A share link is answered whatever the client asked for, matching
          // the Worker.
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

            // The deploy serves the rendition out of `dist/index.md`, which
            // the build emits from this same module. Deriving it per request
            // keeps an edit to the page visible without a build, as the HTML
            // is.
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
