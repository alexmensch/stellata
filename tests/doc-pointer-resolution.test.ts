// Every `<path>.md#<slug>` pointer in the tree names a heading or anchor that
// exists, so a folder split or a heading rename fails CI instead of leaving a
// pointer that still reads as authoritative.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import {
  SCANNED_KINDS,
  docAnchors,
  explicitAnchors,
  extractPointers,
  extractSameFileLinks,
  kindOf,
  pointerCorpus,
  resolveDocPath,
  strayedSectionSigns,
} from './doc-pointer-pure';
import { lfsTracked } from './walk-files';

const ROOT = resolve(__dirname, '..');

// Fixtures interpolate their `#` and section sign from here, so no literal
// pointer or sign appears in this file and it stays out of its own scan.
const H = '#';
const S = '\u00a7';

describe('doc pointers resolve', () => {
  const anchors = new Map<string, Set<string>>();
  const anchorsOf = (path: string): Set<string> => {
    const cached = anchors.get(path);
    if (cached !== undefined) return cached;
    const parsed = docAnchors(readFileSync(path, 'utf-8'));
    anchors.set(path, parsed);
    return parsed;
  };

  const texts = pointerCorpus(ROOT).map((file) => ({ file, text: readFileSync(file, 'utf-8') }));
  const pointers = texts.flatMap(({ file, text }) => extractPointers(text).map((pointer) => ({ file, pointer })));

  it(`no ${S} appears outside "[${S} N](…)" link text in markdown, or anywhere in code`, () => {
    const strays = texts.flatMap(({ file, text }) =>
      strayedSectionSigns(text, extname(file) === '.md').map((line) => `${relative(ROOT, file)}:${line}`),
    );
    expect(strays, strays.join('\n')).toEqual([]);
  });

  it('every "<path>.md#<slug>" names a heading or anchor that exists', () => {
    const failures: string[] = [];
    for (const { file, pointer } of pointers) {
      const doc = resolveDocPath(pointer.citedPath, dirname(file), ROOT);
      const where = `${relative(ROOT, file)}:${pointer.line}`;
      if (doc === null) {
        failures.push(`${where} — no such file: ${pointer.citedPath}`);
      } else if (!anchorsOf(doc).has(pointer.slug)) {
        failures.push(`${where} — ${relative(ROOT, doc)} has no #${pointer.slug}`);
      }
    }
    expect(failures, failures.join('\n')).toEqual([]);
  });

  it('every same-file "[…](#<slug>)" link in markdown names a heading or anchor of that file', () => {
    const failures = texts
      .filter(({ file }) => extname(file) === '.md')
      .flatMap(({ file, text }) =>
        extractSameFileLinks(text)
          .filter((link) => !anchorsOf(file).has(link.slug))
          .map((link) => `${relative(ROOT, file)}:${link.line} — no #${link.slug} in this file`),
      );
    expect(failures, failures.join('\n')).toEqual([]);
  });

  it('leaves the files Git LFS stores out of the scan', () => {
    const lfsTable = 'data/classic-ids/cross_index.tsv';
    expect(lfsTracked(ROOT, [lfsTable, 'data/local-group/aliases.tsv'])).toEqual(new Set([lfsTable]));
  });

  it.each(SCANNED_KINDS)('the scan finds pointers in %s files', (kind) => {
    expect(pointers.some(({ file }) => kindOf(file) === kind)).toBe(true);
  });
});

describe('extraction', () => {
  const cited = (text: string): [string, string][] =>
    extractPointers(text).map((p) => [p.citedPath, p.slug]);

  it('reads a bare token in a comment, at its own line', () => {
    const text = ['// first', `// See README.md${H}sampler.`].join('\n');
    expect(extractPointers(text)).toEqual([{ citedPath: 'README.md', slug: 'sampler', line: 2 }]);
  });

  it('reads the target of a markdown link, relative or rooted', () => {
    expect(cited(`see [Sampler](../probe/README.md${H}sampler) and [x](/docs/sid.md${H}44-allocation)`)).toEqual([
      ['../probe/README.md', 'sampler'],
      ['/docs/sid.md', '44-allocation'],
    ]);
  });

  it('ends the slug at the first character a slug cannot hold', () => {
    expect(cited(`(\`a/README.md${H}one-two_3\`), b.md${H}x; c.md${H}y. d.md${H}z'`)).toEqual([
      ['a/README.md', 'one-two_3'],
      ['b.md', 'x'],
      ['c.md', 'y'],
      ['d.md', 'z'],
    ]);
  });

  it('keeps an uppercase slug whole, so it fails resolution rather than truncating', () => {
    expect(cited(`README.md${H}Sampler`)).toEqual([['README.md', 'Sampler']]);
  });

  it('skips paths outside the repo, URLs and the syntax placeholder', () => {
    expect(cited(`~/.claude/CLAUDE.md${H}dry`)).toEqual([]);
    expect(cited(`https://github.com/o/r/blob/main/README.md${H}usage`)).toEqual([]);
    expect(cited(`\`<path>.md${H}<slug>\``)).toEqual([]);
  });

  it('reads a same-file markdown link target, and nothing that merely starts with #', () => {
    const text = [`see [${S} 3.5](${H}35-lateness) and`, `[Unit](${H}unit--what-an-emitting-layer-writes) but not (${H}624) or [x](${H})`].join('\n');
    expect(extractSameFileLinks(text)).toEqual([
      { slug: '35-lateness', line: 1 },
      { slug: 'unit--what-an-emitting-layer-writes', line: 2 },
    ]);
  });

  it(`allows ${S} in markdown only where it opens numbered link text`, () => {
    const markdown = [
      `[${S} 3.5](${H}35-lateness) and [${S} 6.1](/docs/catalog-driver.md${H}61-record-parity)`,
      `but not ${S} 5, ${S} Heading, [${S} Heading](${H}heading) or docs/sid.md ${S} 4.5`,
      `nor ${S}${S} 4.1, 4.4`,
    ].join('\n');
    expect(strayedSectionSigns(markdown, true)).toEqual([2, 2, 2, 2, 3, 3]);
  });

  it(`allows no ${S} at all in code, link-shaped or not`, () => {
    expect(strayedSectionSigns(`// [${S} 3.5](${H}35-lateness), ${S} Unit`, false)).toEqual([1, 1]);
  });
});

describe('anchors', () => {
  it('slugs headings the way GitHub does, numbering repeats', () => {
    const doc = [
      '# Validation harness',
      '## 4.4 Allocation',
      '## `gpu.frame` is the only row',
      '## Stage 6 — multiples.tsv emit',
      '## Validation harness',
    ].join('\n');
    expect([...docAnchors(doc)]).toEqual([
      'validation-harness',
      '44-allocation',
      'gpuframe-is-the-only-row',
      'stage-6--multiplestsv-emit',
      'validation-harness-1',
    ]);
  });

  it('adds explicit anchors, and never a comment line inside a code block', () => {
    const doc = ['- <a id="two-disc-means"></a>**Two disc means** — one', '', '```bash', '# not a heading', '```'].join('\n');
    expect([...docAnchors(doc)]).toEqual(['two-disc-means']);
  });

  it('collects explicit anchors alone when asked, leaving heading slugs out', () => {
    const doc = ['<a id="french1988"></a>', '### French et al. 1988 — Uranian ring orbits'].join('\n');
    expect([...explicitAnchors(doc)]).toEqual(['french1988']);
  });
});

describe('path resolution', () => {
  it('reads a leading / as the repo root and anything else as file-relative', () => {
    expect(resolveDocPath('/AGENTS.md', join(ROOT, 'src/client/hdr'), ROOT)).toBe(join(ROOT, 'AGENTS.md'));
    expect(resolveDocPath('README.md', join(ROOT, 'tests'), ROOT)).toBe(join(ROOT, 'tests/README.md'));
    expect(resolveDocPath('AGENTS.md', join(ROOT, 'src/client/hdr'), ROOT)).toBeNull();
  });

  it('refuses a path that climbs out of the repo', () => {
    expect(resolveDocPath('../AGENTS.md', ROOT, ROOT)).toBeNull();
  });

  it('reports no such file rather than throwing', () => {
    expect(resolveDocPath('nope/README.md', join(ROOT, 'tests'), ROOT)).toBeNull();
  });
});
