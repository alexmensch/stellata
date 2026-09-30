import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { docFiles, loadSnapshots } from './doc-figures';

describe('loadSnapshots + docFiles', () => {
  let root: string;
  const write = (path: string, text: string) => {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), text);
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'doc-figures-'));
    execFileSync('git', ['init', '-q'], { cwd: root });
    write('a/tracked-expected.json', '{"rows": 1}');
    execFileSync('git', ['add', '.'], { cwd: root });
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('reads a snapshot written but not yet added, keyed by stem', () => {
    write('b/fresh-expected.json', '{"rows": 2}');
    expect([...loadSnapshots(root)].sort()).toEqual([
      ['fresh', { rows: 2 }],
      ['tracked', { rows: 1 }],
    ]);
  });

  it('refuses two snapshots sharing a stem', () => {
    write('b/tracked-expected.json', '{}');
    expect(() => loadSnapshots(root)).toThrow('two snapshots share the stem tracked');
  });

  it('lists markdown, a symlink excluded', () => {
    write('README.md', 'x');
    symlinkSync('README.md', join(root, 'LINK.md'));
    expect(docFiles(root)).toEqual(['README.md']);
  });
});
