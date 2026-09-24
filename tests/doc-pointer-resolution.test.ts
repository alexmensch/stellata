// Every `<path>.md#<slug>` pointer in the tree names a heading or anchor that
// exists, so a folder split or a heading rename fails CI instead of leaving a
// pointer that still reads as authoritative.

import { describe, expect, it } from 'vitest';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { docAnchors, extractPointers, resolveDocPath } from './doc-pointer-pure';
import { gitFiles } from './walk-files';

const ROOT = resolve(__dirname, '..');
const SCANNED_EXTS = ['.ts', '.md', '.py', '.sh'];

// Fixtures interpolate their `#` from here, so no literal pointer appears in
// this file and it stays out of its own scan.
const H = '#';

function scannedFiles(): string[] {
  return gitFiles(ROOT, [], { untracked: true })
    .filter((name) => SCANNED_EXTS.includes(extname(name)))
    .map((name) => join(ROOT, name))
    .filter((path) => existsSync(path) && !lstatSync(path).isSymbolicLink());
}

describe('doc pointers resolve', () => {
  const anchors = new Map<string, Set<string>>();
  const anchorsOf = (path: string): Set<string> => {
    const cached = anchors.get(path);
    if (cached !== undefined) return cached;
    const parsed = docAnchors(readFileSync(path, 'utf-8'));
    anchors.set(path, parsed);
    return parsed;
  };

  const pointers = scannedFiles().flatMap((file) =>
    extractPointers(readFileSync(file, 'utf-8')).map((pointer) => ({ file, pointer })),
  );

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

  it.each(SCANNED_EXTS)('the scan finds pointers in %s files', (ext) => {
    expect(pointers.some(({ file }) => extname(file) === ext)).toBe(true);
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
