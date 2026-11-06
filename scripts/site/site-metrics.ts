/** Every figure the public pages quote, counted off what it describes.
 *  `vite.env.ts` publishes these; README.md is where each comes from. */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { selectAll } from 'hast-util-select';

import { catalogChunkFilename, readCatalogHeader } from '../../src/catalog-format/record/catalog-pure.ts';
import { BUILD_COUNTS_EXPECTED_FILE as COUNT_SNAPSHOT } from '../catalog/build-counts.ts';
import type { IndexEntry } from '../util/citation-index-pure.ts';
import { flattenStages } from '../util/counts/count-stages-pure.ts';
import { parseHtml } from '../util/parse-html.ts';
import { REPO_ROOT, publicFile, publicRepoPath } from '../util/paths.ts';
import { CITATION_INDEX } from './citation-index-source.ts';

const APP_DOC = 'src/client/app/index.html';

function readIfPresent(path: string): Buffer | null {
  try {
    return readFileSync(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    return null;
  }
}

export type AbsentCatalogue = 'quote-snapshot' | 'refuse';

export function catalogueRecordCount(absent: AbsentCatalogue): number {
  return recordCountOf(
    readIfPresent(publicFile(catalogChunkFilename(0))),
    () => readFileSync(resolve(REPO_ROOT, COUNT_SNAPSHOT), 'utf8'),
    absent,
  );
}

/** The first transport chunk's header; with no chunk built, the count snapshot or a refusal, as `absent` says. */
export function recordCountOf(chunk: Buffer | null, snapshot: () => string, absent: AbsentCatalogue): number {
  if (chunk === null) {
    if (absent === 'refuse') {
      throw new Error(
        `site metrics: ${publicRepoPath(catalogChunkFilename(0))} is not built — run pnpm run build:catalog`,
      );
    }
    return snapshotRecordCount(snapshot());
  }
  const bytes = chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength);
  return readCatalogHeader(bytes as ArrayBuffer).count;
}

function snapshotRecordCount(json: string): number {
  const { recordCount } = flattenStages(JSON.parse(json)) as { recordCount?: unknown };
  if (!Number.isInteger(recordCount) || (recordCount as number) <= 0) {
    throw new Error(`site metrics: ${COUNT_SNAPSHOT} states no recordCount`);
  }
  return recordCount as number;
}

export function creditedSourceCount(): number {
  return creditCount(readFileSync(resolve(REPO_ROOT, APP_DOC), 'utf8'));
}

export function creditCount(appHtml: string): number {
  const credits = selectAll('.modal-credits > .credit-entry > div:not(.credit-label)', parseHtml(appHtml));
  if (credits.length === 0) {
    throw new Error(`site metrics: no credited sources found in ${APP_DOC}'s .modal-credits`);
  }
  return credits.length;
}

export function citationEntries(): IndexEntry[] {
  const entries = CITATION_INDEX.read();
  if (entries.length === 0) {
    throw new Error(`site metrics: no entries found in ${CITATION_INDEX.file}`);
  }
  return entries;
}

export function citedReferenceCount(): number {
  return citationEntries().length;
}
