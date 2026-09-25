// See /data/papers/README.md#what-enforces-it.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { explicitAnchors, extractPointers, pointerCorpus, resolveDocPath } from './doc-pointer-pure';

const ROOT = resolve(__dirname, '..');
const PAPERS = join(ROOT, 'data/papers');
const INDEX = join(PAPERS, 'index.md');

const entryKeys = explicitAnchors(readFileSync(INDEX, 'utf-8'));
const manifestKeys = new Set(Object.keys(JSON.parse(readFileSync(join(PAPERS, 'manifest.json'), 'utf-8'))));

const citations = pointerCorpus(ROOT)
  .filter((file) => !file.startsWith(PAPERS + '/'))
  .flatMap((file) =>
    extractPointers(readFileSync(file, 'utf-8'))
      .filter((pointer) => resolveDocPath(pointer.citedPath, dirname(file), ROOT) === INDEX)
      .map((pointer) => ({ where: `${relative(ROOT, file)}:${pointer.line}`, key: pointer.slug })),
  );

describe('citation index', () => {
  it('every pointer into the index names an entry key, never a heading slug', () => {
    const strays = citations.filter(({ key }) => !entryKeys.has(key)).map(({ where, key }) => `${where} — #${key}`);
    expect(strays, strays.join('\n')).toEqual([]);
  });

  it('every entry is cited from outside data/papers/', () => {
    const cited = new Set(citations.map(({ key }) => key));
    const orphans = [...entryKeys].filter((key) => !cited.has(key));
    expect(orphans, `index entries no tree citation points at:\n${orphans.join('\n')}`).toEqual([]);
  });

  it('manifest.json keys exactly the works the index has entries for', () => {
    const noEntry = [...manifestKeys].filter((key) => !entryKeys.has(key)).map((key) => `manifest only: ${key}`);
    const noManifest = [...entryKeys].filter((key) => !manifestKeys.has(key)).map((key) => `index only: ${key}`);
    const drift = [...noEntry, ...noManifest];
    expect(drift, drift.join('\n')).toEqual([]);
  });
});
