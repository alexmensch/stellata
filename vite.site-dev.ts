/**
 * Dev-only document routing, so one `pnpm run dev` answers the same paths the
 * deploy does: the app at /app, the homepage at /, the 404 page for the rest.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

/** Mirrors `src/worker.ts`'s own rule for what the application owns. */
const APP_PATH = '/app';

function ownedByApp(pathname: string): boolean {
  return pathname === APP_PATH || pathname.startsWith(`${APP_PATH}/`);
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

  return {
    name: 'stellata:document-routing-in-dev',
    apply: 'serve',
    configureServer(server) {
      // Post-hook form: installed after Vite's own middlewares, so real files
      // — `public/` artifacts, `/@fs` and `/@vite` routes, source modules —
      // are served first and only documents reach this.
      return () => {
        server.middlewares.use(async (req, res, next) => {
          const url = (req.url ?? '/').split('?')[0];
          const wantsDocument = (req.headers.accept ?? '').includes('text/html');
          if (req.method !== 'GET' || !wantsDocument) {
            next();
            return;
          }

          // `file` is read from disk; `base` is the root-relative URL Vite
          // resolves the document's own relative imports against, so the app
          // document's `../main.ts` lands on `src/client/main.ts`.
          const [file, base, status] = ownedByApp(url)
            ? [appDoc, '/app/index.html', 200]
            : url === '/'
              ? [resolve(siteDir, 'index.html'), '/index.html', 200]
              : [resolve(siteDir, '404.html'), '/404.html', 404];

          try {
            const raw = await readFile(file, 'utf8');
            const html = await server.transformIndexHtml(
              base,
              raw.replaceAll('./site.css', stylesheet).replace(SIBLING_OF_ROOT, '$1="/'),
              req.originalUrl,
            );
            res.statusCode = status;
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.end(html);
          } catch (err) {
            next(err);
          }
        });
      };
    },
  };
}
