/** Every figure the public pages quote, counted off what it describes.
 *  `vite.env.ts` publishes these; README.md is where each comes from. */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { selectAll } from 'hast-util-select';

import { catalogChunkFilename, readCatalogHeader } from '../catalog/record/catalog-pure.ts';
import { type IndexEntry, parseIndex } from '../util/citation-index-pure.ts';
import { parseHtml } from '../util/parse-html.ts';

const CITATION_INDEX = 'data/papers/index.md';
const APP_DOC = 'src/client/app/index.html';

const COUNT_SNAPSHOT = 'scripts/catalog/build-catalog-expected.json';

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

export function citedReferenceCount(root: string): number {
  return citationEntries(root).length;
}
