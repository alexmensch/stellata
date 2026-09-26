// See /data/papers/README.md#what-enforces-it.

import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import {
  citationsIn,
  citesByLabel,
  codebaseWording,
  type CopyText,
  holdsCopy,
  type IndexEntry,
  labelDefects,
  lineText,
  paginatedText,
  paginationOf,
  parseIndex,
  passageDefect,
  type PinnedCopy,
  STATUSES,
  uncitedIdentifiers,
  unpaginatedText,
} from '../scripts/util/citation-index-pure';
import { extractPointers, pointerCorpus, resolveDocPath } from './doc-pointer-pure';

const ROOT = resolve(__dirname, '..');
const PAPERS = join(ROOT, 'data/papers');
const INDEX = join(PAPERS, 'index.md');
const STORE = join(PAPERS, 'pdf');
const ROOTED_INDEX = '/data/papers/index.md';
const IN_CI = Boolean(process.env.CI);
const PUBLIC_COPY = ['public/', 'src/client/index.html', 'CITATION.cff'];
const DATA_TABLE = /^data\/.*\.(tsv|csv)$/;

const entries = parseIndex(readFileSync(INDEX, 'utf-8'));
const entryKeys = new Set(entries.map(({ key }) => key));
const manifest: Record<string, PinnedCopy[]> = JSON.parse(readFileSync(join(PAPERS, 'manifest.json'), 'utf-8'));

const citingFiles = pointerCorpus(ROOT)
  .filter((file) => !file.startsWith(PAPERS + '/'))
  .map((file) => ({ file, text: readFileSync(file, 'utf-8') }));
const citations = citingFiles.flatMap(({ file, text }) =>
    extractPointers(text)
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

  it('every entry is labelled "<first author> <year>", a letter added only where two would collide', () => {
    const defects = labelDefects(entries);
    expect(defects, defects.join('\n')).toEqual([]);
  });

  it('every citation names its entry by label: [Label](pointer), or Label (pointer) in code and data', () => {
    const labels = new Map(entries.map(({ key, label }) => [key, label]));
    const wrong = citingFiles.flatMap(({ file, text }) =>
      citationsIn(text)
        .filter((citation) => labels.has(citation.key) && !citesByLabel(citation, labels.get(citation.key)!))
        .map(({ key, line, text: cited, form }) =>
          `${relative(ROOT, file)}:${line} — ${labels.get(key)} — ${form === 'link' ? `[${cited}]` : `…${cited.slice(-60)}`}`,
        ),
    );
    expect(wrong, wrong.join('\n')).toEqual([]);
  });

  it('no DOI, arXiv ID or bibcode is cited outside the index; datasets, data values and public copy aside', () => {
    const stray = citingFiles
      .filter(({ file }) => !PUBLIC_COPY.some((path) => relative(ROOT, file).startsWith(path)) && !DATA_TABLE.test(relative(ROOT, file)))
      .flatMap(({ file, text }) =>
        uncitedIdentifiers(text).map(({ line, identifier }) => `${relative(ROOT, file)}:${line} — ${identifier}`),
      );
    expect(stray, stray.join('\n')).toEqual([]);
  });

  it('every row is verified or unverified', () => {
    const other = entries.flatMap(({ key, rows }) =>
      rows.filter(({ status }) => !STATUSES.includes(status)).map(({ line, status }) => `index.md:${line} ${key} — "${status}"`),
    );
    expect(other, other.join('\n')).toEqual([]);
  });

  it('no row or note describes the codebase, only what the paper says', () => {
    const wording = entries.flatMap(codebaseWording);
    expect(wording, wording.join('\n')).toEqual([]);
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
const TEXT_LAYERS = ['.txt', '.flow.txt'];
const PRINTED_PAGINATION = /^`(publishedVersion|ADS scan of published article)`/;
const IMAGE_ONLY = /image-only scan/;
const READ_ON_PAGE_IMAGE = /read on the page image/;

const textLayers = (pdf: string): string[] => TEXT_LAYERS.map((suffix) => join(STORE, pdf.replace(/\.pdf$/, suffix)));

function copyTexts(entry: IndexEntry): CopyText[] {
  return (manifest[entry.key] ?? []).flatMap(({ file }): CopyText[] => {
    if (file.endsWith('.readme.txt')) return [lineText(readFileSync(join(STORE, file), 'utf-8'))];
    if (file.endsWith('.page.txt')) return [unpaginatedText(readFileSync(join(STORE, file), 'utf-8'))];
    if (IMAGE_ONLY.test(entry.copy)) return [];
    const layers = textLayers(file).filter(existsSync);
    return layers.length
      ? [paginatedText(layers.map((layer) => readFileSync(layer, 'utf-8')), paginationOf(entry.copy, PRINTED_PAGINATION.test(entry.copy)))]
      : [];
  });
}

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

  it('every PDF copy has both text layers, unless its Copy says it is an image-only scan', () => {
    const missing = entries
      .filter((entry) => !IMAGE_ONLY.test(entry.copy))
      .flatMap((entry) => (manifest[entry.key] ?? []).filter(({ file }) => file.endsWith('.pdf')))
      .flatMap(({ file }) => textLayers(file).filter((layer) => !existsSync(layer)))
      .map((layer) => relative(STORE, layer));
    expect(missing, `regenerate (see /data/papers/README.md#the-pdfs-are-private):\n${missing.join('\n')}`).toEqual([]);
  });

  it('a row is unverified only where its entry has no readable copy', () => {
    const readable = entries.flatMap((entry) =>
      copyTexts(entry).length
        ? entry.rows.filter(({ status }) => status === 'unverified').map(({ line }) => `index.md:${line} ${entry.key}`)
        : [],
    );
    expect(readable, `check these against the copy:\n${readable.join('\n')}`).toEqual([]);
  });

  it('every verified row quotes a passage its copy carries, on the page or line it names', () => {
    const defects = entries.flatMap((entry) => {
      const texts = copyTexts(entry);
      if (!texts.length) return [];
      return entry.rows
        .filter(({ status, page }) => status === 'verified' && !READ_ON_PAGE_IMAGE.test(page))
        .flatMap((row) => {
          const found = texts.map((text) => passageDefect(row, text));
          return found.includes(null) ? [] : [`index.md:${row.line} ${entry.key} — ${found[0]}`];
        });
    });
    expect(defects, defects.join('\n')).toEqual([]);
  });
});
