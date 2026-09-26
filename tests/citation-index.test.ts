// See /data/papers/README.md#what-enforces-it.

import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { holdsCopy, parseIndex, type PinnedCopy } from './citation-index-pure';
import { extractPointers, pointerCorpus, resolveDocPath } from './doc-pointer-pure';

const ROOT = resolve(__dirname, '..');
const PAPERS = join(ROOT, 'data/papers');
const INDEX = join(PAPERS, 'index.md');
const STORE = join(PAPERS, 'pdf');
const ROOTED_INDEX = '/data/papers/index.md';
const IN_CI = Boolean(process.env.CI);

const entries = parseIndex(readFileSync(INDEX, 'utf-8'));
const entryKeys = new Set(entries.map(({ key }) => key));
const manifest: Record<string, PinnedCopy[]> = JSON.parse(readFileSync(join(PAPERS, 'manifest.json'), 'utf-8'));

const citations = pointerCorpus(ROOT)
  .filter((file) => !file.startsWith(PAPERS + '/'))
  .flatMap((file) =>
    extractPointers(readFileSync(file, 'utf-8'))
      .filter((pointer) => resolveDocPath(pointer.citedPath, dirname(file), ROOT) === INDEX)
      .map((pointer) => ({ where: `${relative(ROOT, file)}:${pointer.line}`, key: pointer.slug, path: pointer.citedPath })),
  );

describe('citation index', () => {
  it('every entry key is unique', () => {
    expect(entries.length).toBe(entryKeys.size);
  });

  it('every pointer into the index is rooted and names an entry key, never a heading slug', () => {
    const strays = citations
      .filter(({ key, path }) => path !== ROOTED_INDEX || !entryKeys.has(key))
      .map(({ where, key, path }) => `${where} — ${path}#${key}`);
    expect(strays, strays.join('\n')).toEqual([]);
  });

  it('every entry is cited from outside data/papers/', () => {
    const cited = new Set(citations.map(({ key }) => key));
    const orphans = [...entryKeys].filter((key) => !cited.has(key));
    expect(orphans, `index entries no tree citation points at:\n${orphans.join('\n')}`).toEqual([]);
  });

  it('manifest.json pins exactly the entries whose Copy is held', () => {
    const held = entries.filter(holdsCopy).map(({ key }) => key);
    expect(Object.keys(manifest).sort()).toEqual(held.sort());
  });

  it('every pinned copy is named for its entry', () => {
    const misnamed = Object.entries(manifest).flatMap(([key, copies]) =>
      copies.filter(({ file }) => !COPY_NAMES.some((suffix) => file === key + suffix)).map(({ file }) => `${key}: ${file}`),
    );
    expect(misnamed, misnamed.join('\n')).toEqual([]);
  });
});

const COPY_NAMES = ['.pdf', '.readme.txt', '.page.txt'];

describe.skipIf(IN_CI)('private paper store', () => {
  it('data/papers/pdf is a link to the store, not missing and not a copy', () => {
    const state = !existsSync(STORE) ? 'missing' : lstatSync(STORE).isSymbolicLink() ? 'link' : 'copied folder';
    expect(state, 'link it: ln -s "<paper store>" data/papers/pdf (see /data/papers/README.md#the-pdfs-are-private)').toBe(
      'link',
    );
  });

  it('every pinned copy is in the store with its pinned bytes', () => {
    const drift = Object.values(manifest)
      .flat()
      .filter(({ file, sha256, bytes }) => {
        const path = join(STORE, file);
        if (!existsSync(path)) return true;
        const data = readFileSync(path);
        return data.length !== bytes || createHash('sha256').update(data).digest('hex') !== sha256;
      })
      .map(({ file }) => file);
    expect(drift, `missing or changed since pinned:\n${drift.join('\n')}`).toEqual([]);
  });
});
