/** Every figure the public pages quote, counted off what it describes.
 *  `vite.env.ts` publishes these; README.md is where each comes from. */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { selectAll } from 'hast-util-select';

import { catalogChunkFilename, readCatalogHeader } from '../catalog/record/catalog-pure.ts';
import { type IndexEntry, parseIndex } from '../util/citation-index-pure.ts';
import { parseHtml } from './parse-html.ts';

const CITATION_INDEX = 'data/papers/index.md';
const APP_DOC = 'src/client/app/index.html';

const COUNT_SNAPSHOT = 'scripts/catalog/build-catalog-expected.json';

/**
 * Records in the shipped catalogue. Read from the built artifact's own
 * header, falling back to the build's committed count snapshot on a checkout
 * that has not run `build:catalog` — the two cannot disagree, because
 * `build-catalog` refuses to write an artifact whose counts drift from that
 * snapshot without `UPDATE_BUILD_COUNTS=1`.
 */
export function catalogueRecordCount(root: string): number {
  let buf: Buffer;
  try {
    buf = readFileSync(join(root, 'public', catalogChunkFilename(0)));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    return snapshotRecordCount(root);
  }
  const bytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return readCatalogHeader(bytes as ArrayBuffer).count;
}

function snapshotRecordCount(root: string): number {
  const { recordCount } = JSON.parse(readFileSync(join(root, COUNT_SNAPSHOT), 'utf8')) as { recordCount?: unknown };
  if (!Number.isInteger(recordCount) || (recordCount as number) <= 0) {
    throw new Error(`site metrics: ${COUNT_SNAPSHOT} states no recordCount`);
  }
  return recordCount as number;
}

/** Every credited source in the application's Credits tab is one `<div>`
 *  child of a `.credit-entry` that is not the entry's own label. */
export function creditedSourceCount(root: string): number {
  const app = parseHtml(readFileSync(join(root, APP_DOC), 'utf8'));
  const credits = selectAll('.modal-credits > .credit-entry > div:not(.credit-label)', app);
  if (credits.length === 0) {
    throw new Error(`site metrics: no credited sources found in ${APP_DOC}'s .modal-credits`);
  }
  return credits.length;
}

export function citationEntries(root: string): IndexEntry[] {
  const entries = parseIndex(readFileSync(join(root, CITATION_INDEX), 'utf8'));
  if (entries.length === 0) {
    throw new Error(`site metrics: no entries found in ${CITATION_INDEX}`);
  }
  return entries;
}

export function appVersion(root: string): string {
  const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version?: unknown };
  if (typeof version !== 'string' || version === '') {
    throw new Error('site metrics: package.json states no version');
  }
  return version;
}

/** Every cited work has one entry in the citation index. */
export function citedReferenceCount(root: string): number {
  return citationEntries(root).length;
}
