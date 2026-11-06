/** What both Vite configs share: the build target and the figures they publish, so app and site read one set. */

import type { ConfigEnv, Plugin } from 'vite';
import { type Figures, substituteFigures } from './scripts/site/figures-pure.ts';
import { releaseAt } from './scripts/util/release-version.ts';
import {
  type AbsentCatalogue,
  catalogueRecordCount,
  citedReferenceCount,
  creditedSourceCount,
} from './scripts/site/site-metrics.ts';

export const BUILD_TARGET = 'es2022';

export function absentCatalogueFor(env: Pick<ConfigEnv, 'mode'>): AbsentCatalogue {
  return env.mode === 'production' ? 'refuse' : 'quote-snapshot';
}

export function buildFigures(absent: AbsentCatalogue): Figures {
  return {
    VITE_APP_VERSION: releaseAt(),
    VITE_STAR_COUNT: catalogueRecordCount(absent).toLocaleString('en-US'),
    VITE_SOURCE_COUNT: String(creditedSourceCount()),
    VITE_REFERENCE_COUNT: String(citedReferenceCount()),
  };
}

/**
 * The VITE_ prefix, rather than `define`, because only it behaves the same
 * in dev and prod. src/site/README.md#numbers-in-copy.
 */
export function publishBuildEnv(figures: Figures): void {
  Object.assign(process.env, figures);
}

/** Ordered ahead of Vite's own `%ENV%` pass, which leaves an unknown token in the page with only a warning. */
export function figureSubstitution(figures: Figures): Plugin {
  return {
    name: 'stellata:figures',
    transformIndexHtml: {
      order: 'pre',
      handler: (html, ctx) => substituteFigures(html, figures, ctx.filename),
    },
  };
}
