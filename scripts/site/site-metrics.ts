/** Every figure the public pages quote, counted off what it describes.
 *  `vite.env.ts` publishes these; README.md is where each comes from. */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { selectAll } from 'hast-util-select';

import { catalogChunkFilename, readCatalogHeader } from '../catalog/record/catalog-pure.ts';
import type { IndexEntry } from '../util/citation-index-pure.ts';
import { parseHtml } from '../util/parse-html.ts';
import { PACKAGE_JSON, REPO_ROOT } from '../util/paths.ts';
import { CITATION_INDEX } from './citation-index-source.ts';

const APP_DOC = 'src/client/app/index.html';

const COUNT_SNAPSHOT = 'scripts/catalog/build-catalog-expected.json';

function readIfPresent(path: string): Buffer | null {
  try {
    return readFileSync(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    return null;
  }
}

export function catalogueRecordCount(): number {
  return recordCountOf(
    readIfPresent(resolve(REPO_ROOT, 'public', catalogChunkFilename(0))),
    () => readFileSync(resolve(REPO_ROOT, COUNT_SNAPSHOT), 'utf8'),
  );
}

/** The first transport chunk's header, else the count snapshot when no chunk is built. */
export function recordCountOf(chunk: Buffer | null, snapshot: () => string): number {
  if (chunk === null) return snapshotRecordCount(snapshot());
  const bytes = chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength);
  return readCatalogHeader(bytes as ArrayBuffer).count;
}

function snapshotRecordCount(json: string): number {
  const { recordCount } = JSON.parse(json) as { recordCount?: unknown };
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

export function appVersion(): string {
  return versionOf(readFileSync(resolve(REPO_ROOT, PACKAGE_JSON), 'utf8'));
}

export function versionOf(manifestJson: string): string {
  const { version } = JSON.parse(manifestJson) as { version?: unknown };
  if (typeof version !== 'string' || version === '') {
    throw new Error('site metrics: package.json states no version');
  }
  return version;
}

export function citedReferenceCount(): number {
  return citationEntries().length;
}
