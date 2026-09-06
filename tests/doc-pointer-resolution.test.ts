// Every `<file>.md § <Heading>` pointer in the tree resolves to a heading
// that exists, so a folder split or a heading rename fails CI instead of
// leaving a pointer that still reads as authoritative.

import { describe, expect, it } from 'vitest';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { walkFiles } from './walk-files';
import {
  citesSection,
  extractPointers,
  resolveDocPath,
  sectionTitles,
} from './doc-pointer-pure';

const ROOT = resolve(__dirname, '..');
const SCANNED_ROOTS = ['src', 'scripts', 'tests', 'docs', 'data', 'research'];
const SCANNED_EXT = /\.(ts|js|glsl|md|py)$/;
const SKIP_DIRS = new Set(['node_modules', 'public', 'dist', '.git', '.claude']);

// Bump deliberately, having read the diff: a drop means the extractor stopped
// seeing pointers, which passes the resolution check by finding nothing.
const POINTER_COUNT = 1872;

// Fixtures interpolate their § from here, so the `<path>.md §` a pointer
// needs never appears literally and this file stays out of its own scan.
const S = '§';

function scannedFiles(): string[] {
  const files = SCANNED_ROOTS.flatMap((root) => [
    ...walkFiles(join(ROOT, root), {
      include: (path) => SCANNED_EXT.test(path),
      skipDir: (name) => SKIP_DIRS.has(name),
    }),
  ]);
  // Repo-root docs too. CLAUDE.md is a symlink to AGENTS.md and would double
  // every finding in it.
  const rootDocs = readdirSync(ROOT)
    .filter((name) => name.endsWith('.md'))
    .map((name) => join(ROOT, name))
    .filter((path) => !lstatSync(path).isSymbolicLink());
  return [...files, ...rootDocs];
}

describe('doc pointers resolve', () => {
  const titles = new Map<string, string[][]>();
  const titlesOf = (path: string): string[][] => {
    const cached = titles.get(path);
    if (cached !== undefined) return cached;
    const parsed = sectionTitles(readFileSync(path, 'utf-8'));
    titles.set(path, parsed);
    return parsed;
  };

  const pointers = scannedFiles().flatMap((file) => {
    const text = readFileSync(file, 'utf-8');
    if (!text.includes('§')) return [];
    return extractPointers(text).map((pointer) => ({ file, pointer }));
  });

  it('every "<file>.md § <Heading>" names a heading that exists', () => {
    const failures: string[] = [];
    for (const { file, pointer } of pointers) {
      const doc = resolveDocPath(pointer.citedPath, dirname(file), ROOT);
      const where = `${relative(ROOT, file)}:${pointer.line}`;
      if (doc === null) {
        failures.push(`${where} — no such file: ${pointer.citedPath}`);
      } else if (!citesSection(pointer.section, titlesOf(doc))) {
        failures.push(
          `${where} — ${relative(ROOT, doc)} has no heading "${pointer.section}"`,
        );
      }
    }
    expect(failures, failures.join('\n')).toEqual([]);
  });

  it(`the tree carries ${POINTER_COUNT} pointers`, () => {
    expect(pointers.length).toBe(POINTER_COUNT);
  });
});

describe('heading matching', () => {
  it('reports a pointer whose heading does not exist', () => {
    const doc = sectionTitles('# Title\n\n## Grid orientation labels\n');
    const [pointer] = extractPointers(`// See galactic/README.md ${S} Sphere gridlines.`);
    expect(pointer.section).toBe('Sphere gridlines');
    expect(citesSection(pointer.section, doc)).toBe(false);
    expect(citesSection('Grid orientation labels', doc)).toBe(true);
    expect(citesSection('Grid orientation labels are Sol-centred', doc)).toBe(true);
  });

  it('does not resolve a citation that stops mid-word', () => {
    expect(citesSection('Time', sectionTitles('## Timescales\n'))).toBe(false);
    expect(citesSection('Time', sectionTitles('## Time and the clock\n'))).toBe(true);
  });

  it('matches a numbered section on its number, cited either way round', () => {
    const doc = sectionTitles('## 5. Per-field cascades\n### 6.2 DR2 dry run\n');
    expect(citesSection('5 routes the cohort here', doc)).toBe(true);
    expect(citesSection('5. Per-field cascades', doc)).toBe(true);
    expect(citesSection('DR2 dry run', doc)).toBe(true);
    expect(citesSection('9 nonexistent', doc)).toBe(false);
    // 6.1 is not 6.2, and a doc that stopped numbering subsections has neither.
    expect(citesSection('6.1 ledger', doc)).toBe(false);
  });

  it('a bare-numbered heading accepts its own number and nothing else', () => {
    // Number-stripping leaves this heading no title, and a shared-words rule
    // then accepted every pointer against it — inflating nothing and hiding
    // real breakage, because the reported count went DOWN.
    const doc = sectionTitles('## 5.\n');
    expect(citesSection('5 whatever follows', doc)).toBe(true);
    expect(citesSection('Totally unrelated heading', doc)).toBe(false);
    expect(citesSection('Depth encoding', doc)).toBe(false);
  });

  // Both limits are asserted so they are known rather than assumed —
  // tests/README.md § Doc-pointer resolution weighs what narrowing costs.
  it('cannot see a rename that leaves the first two words alone', () => {
    expect(citesSection('Grid orientation gremlins', sectionTitles('## Grid orientation labels\n'))).toBe(
      true,
    );
  });

  it('cannot see a rename that a bold sentence still answers for', () => {
    const renamed = sectionTitles(
      '## Exposure adaptation\n\n**Adaptation is deliberately absent from all three.** Prose.\n',
    );
    expect(citesSection('Adaptation', renamed)).toBe(true);
    // The leader support this rides on is what legitimate pointers use.
    expect(citesSection('Two disc means', sectionTitles('- **Two disc means** — one\n'))).toBe(true);
    expect(citesSection('picker', sectionTitles('- `picker.ts` — pure resolver\n'))).toBe(true);
  });
});

describe('path resolution', () => {
  it('tries the referring directory before the repo root', () => {
    expect(resolveDocPath('README.md', join(ROOT, 'tests'), ROOT)).toBe(
      join(ROOT, 'tests/README.md'),
    );
    expect(resolveDocPath('AGENTS.md', join(ROOT, 'src/client/hdr'), ROOT)).toBe(
      join(ROOT, 'AGENTS.md'),
    );
  });

  it('resolves the src/client shorthand docs/ uses for subsystem READMEs', () => {
    expect(resolveDocPath('hdr/README.md', join(ROOT, 'docs'), ROOT)).toBe(
      join(ROOT, 'src/client/hdr/README.md'),
    );
  });

  it('refuses a path that climbs out of the repo', () => {
    expect(resolveDocPath('../AGENTS.md', ROOT, ROOT)).toBeNull();
  });

  it('reports no such file rather than throwing', () => {
    expect(resolveDocPath('nope/README.md', join(ROOT, 'tests'), ROOT)).toBeNull();
  });
});

describe('extraction across wrapped comments', () => {
  it('sees a section name that wrapped, once, at the line it starts on', () => {
    const text = [
      'const x = 1;',
      `// derived where the parent orbit is levelled (../README.md ${S} Levelling on`,
      '// an orbit), not from the pole.',
    ].join('\n');
    expect(extractPointers(text)).toEqual([
      { citedPath: '../README.md', section: 'Levelling on an orbit', line: 2 },
    ]);
  });

  it('reports an unwrapped pointer at its own line', () => {
    const text = ['// Fetches the five probe JSONs.', `// See README.md ${S} Sampler.`].join('\n');
    expect(extractPointers(text)).toEqual([
      { citedPath: 'README.md', section: 'Sampler', line: 2 },
    ]);
  });

  it('sees a path that wrapped at one of its own slashes, without doubling it', () => {
    const text = [
      '// the same gain as the band (../../local-group/',
      `// emission/README.md ${S} Population tints).`,
    ].join('\n');
    expect(extractPointers(text)).toEqual([
      {
        citedPath: '../../local-group/emission/README.md',
        section: 'Population tints',
        line: 1,
      },
    ]);
  });

  it('skips a pointer that names the syntax instead of a section', () => {
    expect(extractPointers(`// AGENTS.md ${S} <named section> fires the rule.`)).toEqual([]);
  });

  it('keeps a stale pointer that another pointer elsewhere merely extends', () => {
    const text = [
      `// See README.md ${S} Files. Stale — that heading is gone.`,
      ...Array.from({ length: 40 }, () => '// filler.'),
      `// See README.md ${S} Files in this area.`,
    ].join('\n');
    expect(extractPointers(text).map((p) => p.section)).toEqual([
      'Files',
      'Files in this area',
    ]);
  });
});
