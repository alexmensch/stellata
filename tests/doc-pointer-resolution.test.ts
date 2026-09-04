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
  it('every "<file>.md § <Heading>" names a heading that exists', () => {
    const titles = new Map<string, string[][]>();
    const titlesOf = (path: string): string[][] => {
      const cached = titles.get(path);
      if (cached !== undefined) return cached;
      const parsed = sectionTitles(readFileSync(path, 'utf-8'));
      titles.set(path, parsed);
      return parsed;
    };

    const failures: string[] = [];
    for (const file of scannedFiles()) {
      const text = readFileSync(file, 'utf-8');
      if (!text.includes('§')) continue;
      for (const pointer of extractPointers(text)) {
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
    }
    expect(failures, failures.join('\n')).toEqual([]);
  });

  it('reports a pointer whose heading does not exist', () => {
    const doc = sectionTitles('# Title\n\n## Grid orientation labels\n');
    // Escaped, so this file does not carry a pointer its own scan would read.
    const [pointer] = extractPointers('// See galactic/README.md \u00a7 Sphere gridlines.');
    expect(pointer.section).toBe('Sphere gridlines');
    expect(citesSection(pointer.section, doc)).toBe(false);
    expect(citesSection('Grid orientation labels', doc)).toBe(true);
    expect(citesSection('Grid orientation labels are Sol-centred', doc)).toBe(true);
  });

  it('does not resolve a citation that stops mid-word', () => {
    expect(citesSection('Time', sectionTitles('## Timescales\n'))).toBe(false);
    expect(citesSection('Time', sectionTitles('## Time and the clock\n'))).toBe(true);
  });

  // The guard's resolution, asserted so it is a known limit rather than a
  // surprise: two matching opening words read as a truncated citation.
  it('cannot see a rename that leaves the first two words alone', () => {
    expect(citesSection('Grid orientation gremlins', sectionTitles('## Grid orientation labels\n'))).toBe(
      true,
    );
  });
});
